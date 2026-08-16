"use client";

import type { GuidedInterventionTaskView, TutorNextAction, TutorTurnView } from "@gapproof/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiClientError } from "@/lib/api-client";
import { createBrowserUuidV7 } from "@/lib/browser-uuidv7";
import { getTutorSession, submitTutorTurn } from "@/lib/socratic-tutor";

type PanelState = "restoring" | "idle" | "sending" | "waiting" | "ready" | "error" | "limit";

export type TutorPanelError = { code: string; message: string; retryable: boolean; unknownWriteResult: boolean };

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

export function SocraticTutorPanel({ task, expectedVersion }: { task: GuidedInterventionTaskView; expectedVersion: number | null }) {
  const firstStep = task.steps[0];
  const [stepId, setStepId] = useState(firstStep?.id ?? "");
  const [learnerText, setLearnerText] = useState("");
  const [state, setState] = useState<PanelState>("restoring");
  const [turn, setTurn] = useState<TutorTurnView | null>(null);
  const [panelError, setPanelError] = useState<TutorPanelError | null>(null);
  const [hintVisible, setHintVisible] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedStep = useMemo(() => task.steps.find(step => step.id === stepId) ?? firstStep, [firstStep, stepId, task.steps]);

  const clearPoll = useCallback(() => {
    if (pollTimer.current !== undefined) clearTimeout(pollTimer.current);
    pollTimer.current = undefined;
  }, []);

  const applyTurn = useCallback((nextTurn: TutorTurnView, attempt: number) => {
    setTurn(nextTurn);
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
      setHintVisible(false);
      setState("ready");
      return false;
    }
    setPanelError({ code: "TURN_FAILED", message: nextTurn.retryable ? "这次引导没有准备好，可以重新提问。" : "这次引导没有准备好，请继续完成当前步骤。", retryable: nextTurn.retryable, unknownWriteResult: false });
    setState("error");
    return false;
  }, []);

  const readSession = useCallback(async (attempt = 0, initialRestore = false, unknownWriteRecovery = false) => {
    clearPoll();
    try {
      const response = await getTutorSession(task.id);
      if (applyTurn(response.data, attempt)) pollTimer.current = setTimeout(() => { void readSession(attempt + 1, false, unknownWriteRecovery); }, 900);
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
  }, [applyTurn, clearPoll, task.id]);

  useEffect(() => {
    setStepId(task.steps[0]?.id ?? "");
    setTurn(null);
    setPanelError(null);
    setState("restoring");
    void readSession(0, true, false);
    return clearPoll;
  }, [clearPoll, readSession, task.id, task.steps]);

  async function submit() {
    if (!selectedStep || expectedVersion === null || learnerText.trim().length === 0 || state === "sending" || state === "waiting" || panelError?.unknownWriteResult) return;
    clearPoll();
    setState("sending");
    setPanelError(null);
    setHintVisible(false);
    try {
      const response = await submitTutorTurn(task.id, { expectedVersion, stepId: selectedStep.id, learnerText: learnerText.trim() }, createBrowserUuidV7());
      if (applyTurn(response.data, 0)) pollTimer.current = setTimeout(() => { void readSession(); }, 700);
    } catch (error) {
      const nextError = toTutorPanelError(error);
      setPanelError(nextError);
      setState(nextError.code === "TASK_LIMIT_REACHED" || nextError.code === "DAILY_LIMIT_REACHED" ? "limit" : "error");
    }
  }

  function continueFromResponse() {
    setTurn(null);
    setPanelError(null);
    setHintVisible(false);
    setState("idle");
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  const busy = state === "restoring" || state === "sending" || state === "waiting";
  const inputLocked = busy || state === "ready" || panelError?.unknownWriteResult === true;

  return <section className="socratic-tutor" aria-labelledby={`tutor-${task.id}`} aria-busy={busy}>
    <div className="socratic-tutor-heading"><div><span className="task-kind">想一想</span><h3 id={`tutor-${task.id}`}>把你的思路说出来</h3></div><span className="socratic-tutor-count">每次只问一个问题</span></div>
    <p className="socratic-tutor-note">导师会用问题帮你找到下一步，不会代写答案，也不会改变任务完成状态。</p>
    <label className="socratic-tutor-step">正在思考： <select value={stepId} onChange={event => setStepId(event.target.value)} disabled={inputLocked}>{task.steps.map(step => <option key={step.id} value={step.id}>{step.title}</option>)}</select></label>
    <textarea ref={textareaRef} value={learnerText} onChange={event => setLearnerText(event.target.value.slice(0, 800))} maxLength={800} placeholder="例如：我先看到了哪个线索？" disabled={inputLocked} aria-label="写下你对当前步骤的思路" aria-describedby={`tutor-note-${task.id}`} />
    <span id={`tutor-note-${task.id}`} className="visually-hidden">不要填写姓名、联系方式或其他个人信息。</span>
    <div className="socratic-tutor-actions"><button type="button" className="secondary-button" onClick={() => void submit()} disabled={expectedVersion === null || learnerText.trim().length === 0 || busy || panelError?.unknownWriteResult === true}>{state === "restoring" ? "正在恢复" : state === "sending" ? "正在发送" : state === "waiting" ? "正在准备引导" : "请导师引导我"}</button><span aria-live="polite">{learnerText.length}/800</span></div>
    {state === "ready" && turn?.response ? <div className="socratic-tutor-response" role="status" aria-live="polite">
      <strong>{turn.response.question}</strong>
      {turn.response.hint ? hintVisible ? <div className="socratic-tutor-hint"><span>提示</span><p>{turn.response.hint}</p></div> : <button type="button" className="ghost-link" onClick={() => setHintVisible(true)}>我需要一点提示</button> : null}
      <button type="button" className="secondary-button socratic-tutor-continue" onClick={continueFromResponse}>{tutorActionLabel(turn.response.nextAction)}</button>
    </div> : null}
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
