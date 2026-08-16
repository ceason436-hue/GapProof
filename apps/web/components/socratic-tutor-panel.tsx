"use client";

import { TUTOR_SESSION_HISTORY_LIMIT, type GuidedInterventionTaskView, type TutorNextAction, type TutorSessionView, type TutorTurnView } from "@gapproof/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiClientError } from "@/lib/api-client";
import { createBrowserUuidV7 } from "@/lib/browser-uuidv7";
import { getTutorSession, submitTutorTurn } from "@/lib/socratic-tutor";

type PanelState = "restoring" | "idle" | "sending" | "waiting" | "ready" | "error" | "limit";

export type TutorPanelError = { code: string; message: string; retryable: boolean; unknownWriteResult: boolean };

export function tutorRecoveryLocked(error: TutorPanelError | null): boolean {
  return error?.unknownWriteResult === true || error?.code === "TURN_ALREADY_PENDING" || error?.code === "POLL_TIMEOUT";
}

export function toTutorPanelError(error: unknown): TutorPanelError {
  if (error instanceof ApiClientError) {
    const code = error.response.error.code;
    if (code === "TASK_LIMIT_REACHED" || code === "DAILY_LIMIT_REACHED") return { code, message: "今天的引导次数已经用完，先完成当前步骤，之后再继续。", retryable: false, unknownWriteResult: false };
    if (code === "TURN_ALREADY_PENDING") return { code, message: "上一条引导还在准备，请读取最新状态。", retryable: false, unknownWriteResult: false };
    if (code === "VERSION_CONFLICT" || code === "TASK_NOT_READY") return { code, message: "任务内容已经更新，请返回今日查看最新安排。", retryable: false, unknownWriteResult: false };
    if (code === "INVALID_INPUT" || code === "SCHEMA_INVALID") return { code, message: "这段思路暂时无法提交，请检查内容后再试。", retryable: false, unknownWriteResult: false };
    if (code === "RESOURCE_NOT_FOUND") return { code, message: "没有找到这次引导，请返回今日查看最新任务。", retryable: false, unknownWriteResult: false };
    return { code, message: "这次没有收到引导。任务进度没有改变，可以重新提问。", retryable: error.response.error.retryable, unknownWriteResult: false };
  }
  return { code: "NETWORK_UNKNOWN", message: "暂时无法确认是否已经收到这次提问。为避免重复提问，请先读取最新状态。", retryable: false, unknownWriteResult: true };
}

export function tutorActionLabel(action: TutorNextAction) {
  if (action === "retry_step") return "按提示再试这一步";
  if (action === "ask_for_help") return "再说说我卡在哪里";
  return "回答这个问题";
}

export function mergeTutorTurn(session: TutorSessionView | null, turn: TutorTurnView): TutorSessionView {
  const turns = [...(session?.turns.filter(candidate => candidate.turnId !== turn.turnId) ?? []), turn]
    .slice(-TUTOR_SESSION_HISTORY_LIMIT);
  return { taskId: turn.taskId, turns };
}

export type TutorUnknownRecoveryMarker = { baselineTurnId: string | null; learnerText: string };

export function sessionContainsRecoveredSubmission(session: TutorSessionView, marker: TutorUnknownRecoveryMarker): boolean {
  const latest = session.turns.at(-1);
  return latest !== undefined && latest.turnId !== marker.baselineTurnId && latest.learnerText === marker.learnerText;
}

export function TutorConversationHistory({
  turns,
  activeTurnId,
  visibleHintTurnIds,
  onRevealHint,
  onContinue,
}: {
  turns: TutorTurnView[];
  activeTurnId: string | null;
  visibleHintTurnIds: ReadonlySet<string>;
  onRevealHint: (turnId: string) => void;
  onContinue: () => void;
}) {
  if (turns.length === 0) return null;
  return <div className="socratic-tutor-history" aria-label="导师对话记录">
    <div className="socratic-tutor-history-heading"><strong>对话记录</strong><span>{turns.length}/{TUTOR_SESSION_HISTORY_LIMIT} 轮</span></div>
    <ol>{turns.map(turn => <li key={turn.turnId}>
      <div className="socratic-tutor-message student-message"><span>你</span><p>{turn.learnerText}</p></div>
      {turn.response ? <div className="socratic-tutor-message tutor-message">
        <span>导师</span>{turn.status === "fallback" ? <small className="socratic-tutor-source-note">本轮使用备用引导</small> : null}<strong>{turn.response.question}</strong>
        {turn.response.hint ? visibleHintTurnIds.has(turn.turnId)
          ? <div className="socratic-tutor-hint"><span>提示</span><p>{turn.response.hint}</p></div>
          : <button type="button" className="ghost-link" onClick={() => onRevealHint(turn.turnId)}>我需要一点提示</button>
          : null}
        {activeTurnId === turn.turnId ? <button type="button" className="secondary-button socratic-tutor-continue" onClick={onContinue}>{tutorActionLabel(turn.response.nextAction)}</button> : null}
      </div> : turn.status === "failed" ? <p className="socratic-tutor-turn-failed">这次没有生成引导，你的任务进度没有改变。</p> : null}
    </li>)}</ol>
  </div>;
}

export function ReadOnlyTutorHistory({ taskId }: { taskId: string }) {
  const [session, setSession] = useState<TutorSessionView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [visibleHintTurnIds, setVisibleHintTurnIds] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    const controller = new AbortController();
    void getTutorSession(taskId).then(response => {
      if (controller.signal.aborted) return;
      setSession(response.data);
      setState("ready");
    }).catch(error => {
      if (controller.signal.aborted) return;
      setState(error instanceof ApiClientError && error.response.error.code === "RESOURCE_NOT_FOUND" ? "empty" : "error");
    });
    return () => controller.abort();
  }, [taskId]);

  if (state === "empty") return <p className="mistake-truth-note">这项任务没有保存的导师对话。</p>;
  if (state === "loading") return <p className="socratic-tutor-status" role="status">正在读取当时的导师对话。</p>;
  if (state === "error" || session === null) return <p className="guided-task-feedback error" role="alert">暂时没能读取导师对话，任务完成记录不会受到影响。</p>;
  return <section className="socratic-tutor read-only-tutor-history" aria-label="已完成任务的导师对话">
    <div className="socratic-tutor-heading"><div><span className="task-kind">导师回顾</span><h3>当时的引导对话</h3></div><span className="socratic-tutor-count">只读记录</span></div>
    <p className="socratic-tutor-note">这里只回顾当时保存的对话，不会继续提问或改变任务状态。</p>
    <TutorConversationHistory
      turns={session.turns}
      activeTurnId={null}
      visibleHintTurnIds={visibleHintTurnIds}
      onRevealHint={turnId => setVisibleHintTurnIds(current => new Set([...current, turnId]))}
      onContinue={() => undefined}
    />
  </section>;
}

export function SocraticTutorPanel({ task, expectedVersion }: { task: GuidedInterventionTaskView; expectedVersion: number | null }) {
  const firstStep = task.steps[0];
  const [stepId, setStepId] = useState(firstStep?.id ?? "");
  const [learnerText, setLearnerText] = useState("");
  const [state, setState] = useState<PanelState>("restoring");
  const [session, setSession] = useState<TutorSessionView | null>(null);
  const [panelError, setPanelError] = useState<TutorPanelError | null>(null);
  const [visibleHintTurnIds, setVisibleHintTurnIds] = useState<ReadonlySet<string>>(() => new Set());
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const unknownRecoveryMarker = useRef<TutorUnknownRecoveryMarker | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedStep = useMemo(() => task.steps.find(step => step.id === stepId) ?? firstStep, [firstStep, stepId, task.steps]);
  const latestTurn = session?.turns.at(-1) ?? null;

  const clearPoll = useCallback(() => {
    if (pollTimer.current !== undefined) clearTimeout(pollTimer.current);
    pollTimer.current = undefined;
  }, []);

  const applyTurn = useCallback((nextTurn: TutorTurnView, attempt: number) => {
    setSession(current => mergeTutorTurn(current, nextTurn));
    setPanelError(null);
    if (nextTurn.status === "queued" || nextTurn.status === "running") {
      if (attempt < 20) setState("waiting");
      else {
        setPanelError({ code: "POLL_TIMEOUT", message: "引导仍在准备中，请稍后读取最新状态。", retryable: false, unknownWriteResult: false });
        setState("error");
      }
      return attempt < 20;
    }
    if (nextTurn.status === "succeeded" || nextTurn.status === "fallback") {
      setLearnerText("");
      setState("ready");
      return false;
    }
    setPanelError({ code: "TURN_FAILED", message: nextTurn.retryable ? "这次引导没有准备好，可以重新提问。" : "这次引导没有准备好，请继续完成当前步骤。", retryable: nextTurn.retryable, unknownWriteResult: false });
    setState("error");
    return false;
  }, []);

  const applySession = useCallback((nextSession: TutorSessionView, attempt: number) => {
    setSession(nextSession);
    const nextTurn = nextSession.turns.at(-1);
    if (nextTurn === undefined) {
      setPanelError(null);
      setState("idle");
      return false;
    }
    return applyTurn(nextTurn, attempt);
  }, [applyTurn]);

  const readSession = useCallback(async (attempt = 0, initialRestore = false, unknownWriteRecovery = false) => {
    clearPoll();
    try {
      const response = await getTutorSession(task.id);
      if (unknownWriteRecovery && unknownRecoveryMarker.current !== null && !sessionContainsRecoveredSubmission(response.data, unknownRecoveryMarker.current)) {
        setSession(response.data);
        setPanelError({
          code: "NETWORK_UNKNOWN",
          message: "最新记录里还没有看到这次提问。请稍后再读取；为避免重复提问，当前内容保持锁定。",
          retryable: false,
          unknownWriteResult: true,
        });
        setState("error");
        return;
      }
      if (unknownWriteRecovery) unknownRecoveryMarker.current = null;
      if (applySession(response.data, attempt)) pollTimer.current = setTimeout(() => { void readSession(attempt + 1, false, unknownWriteRecovery); }, 900);
    } catch (error) {
      if (initialRestore && error instanceof ApiClientError && error.response.error.code === "RESOURCE_NOT_FOUND") {
        setState("idle");
        setPanelError(null);
        return;
      }
      if (unknownWriteRecovery && error instanceof ApiClientError && error.response.error.code === "RESOURCE_NOT_FOUND") {
        setState("error");
        return;
      }
      const nextError = toTutorPanelError(error);
      setPanelError(nextError);
      setState(nextError.code === "TASK_LIMIT_REACHED" || nextError.code === "DAILY_LIMIT_REACHED" ? "limit" : "error");
    }
  }, [applySession, clearPoll, task.id]);

  useEffect(() => {
    setStepId(task.steps[0]?.id ?? "");
    setSession(null);
    unknownRecoveryMarker.current = null;
    setPanelError(null);
    setState("restoring");
    void readSession(0, true, false);
    return clearPoll;
  }, [clearPoll, readSession, task.id, task.steps]);

  async function submit() {
    if (!selectedStep || expectedVersion === null || learnerText.trim().length === 0 || state === "sending" || state === "waiting" || tutorRecoveryLocked(panelError)) return;
    clearPoll();
    setState("sending");
    setPanelError(null);
    const submittedLearnerText = learnerText.trim();
    unknownRecoveryMarker.current = { baselineTurnId: latestTurn?.turnId ?? null, learnerText: submittedLearnerText };
    try {
      const response = await submitTutorTurn(task.id, { expectedVersion, stepId: selectedStep.id, learnerText: submittedLearnerText }, createBrowserUuidV7());
      unknownRecoveryMarker.current = null;
      if (applyTurn(response.data, 0)) pollTimer.current = setTimeout(() => { void readSession(); }, 700);
    } catch (error) {
      const nextError = toTutorPanelError(error);
      if (!nextError.unknownWriteResult) unknownRecoveryMarker.current = null;
      setPanelError(nextError);
      setState(nextError.code === "TASK_LIMIT_REACHED" || nextError.code === "DAILY_LIMIT_REACHED" ? "limit" : "error");
    }
  }

  function continueFromResponse() {
    setPanelError(null);
    setState("idle");
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  const busy = state === "restoring" || state === "sending" || state === "waiting";
  const inputLocked = busy || state === "ready" || tutorRecoveryLocked(panelError);

  return <section className="socratic-tutor" aria-labelledby={`tutor-${task.id}`} aria-busy={busy}>
    <div className="socratic-tutor-heading"><div><span className="task-kind">想一想</span><h3 id={`tutor-${task.id}`}>把你的思路说出来</h3></div><span className="socratic-tutor-count">每次只问一个问题</span></div>
    <p className="socratic-tutor-note">导师会用问题帮你找到下一步，不会代写答案，也不会改变任务完成状态。</p>
    <fieldset className="socratic-tutor-steps" disabled={inputLocked}>
      <legend>你想问哪一步？</legend>
      <div>{task.steps.map((step, index) => <label key={step.id}>
        <input type="radio" name={`tutor-step-${task.id}`} value={step.id} checked={stepId === step.id} onChange={() => setStepId(step.id)}/>
        <span><small>第 {index + 1} 步</small>{step.title}</span>
      </label>)}</div>
    </fieldset>
    <div className="socratic-tutor-prompt">
      <strong>{selectedStep?.title ?? "当前步骤"}</strong>
      {selectedStep?.content ? <p>{selectedStep.content}</p> : null}
    </div>
    <label className="socratic-tutor-input-label" htmlFor={`tutor-input-${task.id}`}>告诉导师你做到哪里、哪里不明白</label>
    <textarea id={`tutor-input-${task.id}`} ref={textareaRef} value={learnerText} onChange={event => setLearnerText(event.target.value.slice(0, 800))} maxLength={800} placeholder="例如：我找到了 yesterday，但不知道动词该怎么变。" disabled={inputLocked} aria-label="写下你对当前步骤的思路" aria-describedby={`tutor-note-${task.id}`} />
    <span id={`tutor-note-${task.id}`} className="visually-hidden">不要填写姓名、联系方式或其他个人信息。</span>
    <div className="socratic-tutor-actions"><button type="button" className="secondary-button" onClick={() => void submit()} disabled={expectedVersion === null || learnerText.trim().length === 0 || busy || tutorRecoveryLocked(panelError)}>{state === "restoring" ? "正在恢复" : state === "sending" ? "正在发送" : state === "waiting" ? "正在准备引导" : "请导师引导我"}</button><span aria-live="polite">{learnerText.length}/800</span></div>
    <TutorConversationHistory
      turns={session?.turns ?? []}
      activeTurnId={state === "ready" ? latestTurn?.turnId ?? null : null}
      visibleHintTurnIds={visibleHintTurnIds}
      onRevealHint={turnId => setVisibleHintTurnIds(current => new Set([...current, turnId]))}
      onContinue={continueFromResponse}
    />
    {state === "restoring" ? <p className="socratic-tutor-status" role="status">正在读取上次的引导。</p> : null}
    {state === "waiting" ? <p className="socratic-tutor-status" role="status">正在准备一道只针对这一步的问题。</p> : null}
    {state === "limit" ? <p className="socratic-tutor-status" role="alert">{panelError?.message}</p> : null}
    {state === "error" && panelError ? <div className="socratic-tutor-error" role="alert"><p>{panelError.message}</p><div className="socratic-tutor-error-actions">
      {panelError.code === "VERSION_CONFLICT" || panelError.code === "TASK_NOT_READY" || panelError.code === "RESOURCE_NOT_FOUND" ? <a className="ghost-link" href="/student/today">返回今日</a> : null}
      {panelError.unknownWriteResult || panelError.code === "TURN_ALREADY_PENDING" || panelError.code === "POLL_TIMEOUT" ? <button type="button" className="ghost-link" onClick={() => void readSession(0, false, panelError.unknownWriteResult)}>读取最新状态</button> : null}
      {panelError.retryable && !panelError.unknownWriteResult ? <button type="button" className="ghost-link" onClick={continueFromResponse}>重新提问</button> : null}
    </div></div> : null}
  </section>;
}
