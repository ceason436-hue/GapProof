"use client";

import {
  type AttemptView,
  type HypothesesView,
  type SyntheticExtractionView,
} from "@gapproof/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  REVIEW_POLL_DELAYS_MS,
  REVIEW_POLL_MAX_WAIT_MS,
  apiErrorCode,
  confirmExtraction,
  createConfirmExtractionIntent,
  createProbeIntent,
  createRunNextIntent,
  getCase,
  getExtraction,
  getHypotheses,
  isUnknownAfterRetry,
  queueRunNext,
  reviewErrorMessage,
  reviewSuccessIsInterventionReady,
  submitProbe,
} from "@/lib/case-review";
import { AppShell } from "./app-shell";

export type ReviewState =
  | "loading"
  | "not_ready"
  | "empty"
  | "ready"
  | "confirming"
  | "confirm_conflict"
  | "confirm_error"
  | "confirm_unknown"
  | "confirmed"
  | "run_next"
  | "hypotheses_loading"
  | "hypotheses"
  | "run_next_error"
  | "run_next_unknown"
  | "probe_submitting"
  | "probe_conflict"
  | "probe_error"
  | "probe_unknown"
  | "probe_success"
  | "intervention_error"
  | "intervention_unknown"
  | "intervention_accepted"
  | "error";

const initialMessage = "正在准备识别内容。";

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

function isAbort(signal: AbortSignal, error: unknown) {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

export function reviewStateMessage(state: ReviewState): string {
  switch (state) {
    case "loading": return initialMessage;
    case "not_ready": return "识别内容尚未准备好；可以稍后重新加载。";
    case "empty": return "暂时没有可确认的识别内容，请稍后再试。";
    case "ready": return "请逐项确认识别内容；你可以先修正题干，再明确确认。";
    case "confirming": return "正在保存你的确认；不会显示答案或评分。";
    case "confirm_conflict": return "内容已更新，请重新确认后提交。";
    case "confirm_error": return "识别内容确认没有完成；请重新明确确认后再试。";
    case "confirm_unknown": return "暂时无法确认是否保存成功。为避免重复操作，请返回今日页稍后查看。";
    case "confirmed": return "识别内容已由你确认。";
    case "run_next": return "正在准备找原因的小题。";
    case "hypotheses_loading": return "正在读取找原因的候选内容。";
    case "hypotheses": return "请选择最符合你情况的确认小题选项。";
    case "run_next_error": return "找原因内容没有准备好；请稍后重新明确开始。";
    case "run_next_unknown": return "下一步是否准备完成暂时无法确认，请返回今日页稍后查看。";
    case "probe_submitting": return "正在收到你的确认小题答案。";
    case "probe_conflict": return "找原因内容已更新；请重新确认小题后提交。";
    case "probe_error": return "确认小题没有完成；你的选择已保留，请重新提交。";
    case "probe_unknown": return "暂时无法确认是否提交成功，请返回今日页稍后查看。";
    case "probe_success": return "已收到，正在准备下一步。";
    case "intervention_error": return "引导任务准备没有完成；请重新明确开始。";
    case "intervention_unknown": return "下一步是否准备完成暂时无法确认，请返回今日页稍后查看。";
    case "intervention_accepted": return "下一步已接受；可以返回今日继续任务。";
    case "error": return "识别内容暂时无法读取，请稍后再试。";
  }
}

function isAlertState(state: ReviewState) {
  return ["confirm_error", "confirm_unknown", "run_next_error", "run_next_unknown", "probe_error", "probe_unknown", "intervention_error", "intervention_unknown", "error"].includes(state);
}

export function CaseRecognitionReview({ caseId }: { caseId: string }) {
  const mountedRef = useRef(true);
  const activeAbortRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<ReviewState>("loading");
  const [message, setMessage] = useState(initialMessage);
  const [extraction, setExtraction] = useState<SyntheticExtractionView | null>(null);
  const [promptValues, setPromptValues] = useState<Record<string, string>>({});
  const [confirmedItemIds, setConfirmedItemIds] = useState<string[]>([]);
  const [hypotheses, setHypotheses] = useState<HypothesesView | null>(null);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<AttemptView | null>(null);

  const safeState = (next: ReviewState, nextMessage = reviewStateMessage(next)) => {
    if (!mountedRef.current) return;
    setState(next);
    setMessage(nextMessage);
  };

  const withController = async <T,>(run: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    activeAbortRef.current?.abort("REPLACED");
    const controller = new AbortController();
    activeAbortRef.current = controller;
    try {
      return await run(controller.signal);
    } finally {
      if (activeAbortRef.current === controller) activeAbortRef.current = null;
    }
  };

  const readExtraction = async (preserveForConflict = false) => {
    safeState("loading");
    await withController(async signal => {
      let elapsed = 0;
      let delayIndex = 0;
      while (elapsed <= REVIEW_POLL_MAX_WAIT_MS) {
        try {
          const response = await getExtraction(caseId, signal);
          if (response.data.caseId !== caseId || response.data.items.length === 0) {
            safeState("empty");
            return;
          }
          setExtraction(response.data);
          setPromptValues(previous => {
            const next = { ...previous };
            for (const item of response.data.items) next[item.itemId] ??= item.prompt;
            return next;
          });
          if (!preserveForConflict) setConfirmedItemIds([]);
          safeState(preserveForConflict ? "confirm_conflict" : "ready");
          return;
        } catch (error) {
          if (isAbort(signal, error)) return;
          if (apiErrorCode(error) !== "EXTRACTION_NOT_READY") {
            safeState(apiErrorCode(error) === "RESOURCE_NOT_FOUND" ? "error" : "error", reviewErrorMessage(error, "识别内容暂时无法读取，请稍后再试。"));
            return;
          }
          const delay = REVIEW_POLL_DELAYS_MS[Math.min(delayIndex, REVIEW_POLL_DELAYS_MS.length - 1)] ?? 3_000;
          delayIndex += 1;
          if (elapsed + delay > REVIEW_POLL_MAX_WAIT_MS) {
            safeState("not_ready");
            return;
          }
          await wait(delay, signal);
          elapsed += delay;
        }
      }
      safeState("not_ready");
    });
  };

  const readHypotheses = async (preserveChoice = false) => {
    safeState("hypotheses_loading");
    await withController(async signal => {
      let elapsed = 0;
      let delayIndex = 0;
      while (elapsed <= REVIEW_POLL_MAX_WAIT_MS) {
        try {
          const response = await getHypotheses(caseId, signal);
          if (response.data.caseId !== caseId) throw new Error("CASE_REVIEW_CASE_MISMATCH");
          setHypotheses(response.data);
          if (!preserveChoice) setSelectedChoiceId(null);
          safeState("hypotheses");
          return;
        } catch (error) {
          if (isAbort(signal, error)) return;
          if (apiErrorCode(error) !== "RESOURCE_NOT_FOUND") {
            safeState("run_next_error", reviewErrorMessage(error, "找原因内容没有准备好；请稍后重新明确开始。"));
            return;
          }
          const delay = REVIEW_POLL_DELAYS_MS[Math.min(delayIndex, REVIEW_POLL_DELAYS_MS.length - 1)] ?? 3_000;
          delayIndex += 1;
          if (elapsed + delay > REVIEW_POLL_MAX_WAIT_MS) {
            safeState("run_next_error", "找原因内容仍未准备好；可以稍后重新开始。 ");
            return;
          }
          await wait(delay, signal);
          elapsed += delay;
        }
      }
      safeState("run_next_error");
    });
  };

  useEffect(() => {
    mountedRef.current = true;
    const stopWhenHidden = () => {
      if (document.visibilityState === "hidden") activeAbortRef.current?.abort("PAGE_HIDDEN");
    };
    document.addEventListener("visibilitychange", stopWhenHidden);
    void readExtraction();
    return () => {
      mountedRef.current = false;
      activeAbortRef.current?.abort("PAGE_LEFT");
      document.removeEventListener("visibilitychange", stopWhenHidden);
    };
  }, [caseId]);

  const corrections = useMemo(() => extraction?.items
    .filter(item => promptValues[item.itemId] !== item.prompt)
    .map(item => ({ itemId: item.itemId, field: "prompt" as const, value: promptValues[item.itemId] ?? item.prompt })) ?? [], [extraction, promptValues]);
  const allConfirmed = Boolean(extraction?.items.length) && extraction?.items.every(item => confirmedItemIds.includes(item.itemId));
  const promptsValid = Boolean(extraction?.items.length) && extraction?.items.every(item => (promptValues[item.itemId] ?? item.prompt).trim().length > 0);
  const controlsLocked = ["confirming", "confirm_unknown", "run_next", "run_next_unknown", "probe_submitting", "probe_unknown", "intervention_unknown", "intervention_accepted"].includes(state);

  const submitExtraction = async () => {
    if (!extraction || !allConfirmed || controlsLocked) return;
    const intent = createConfirmExtractionIntent(extraction.stateVersion, confirmedItemIds, corrections);
    safeState("confirming");
    await withController(async signal => {
      try {
        const response = await confirmExtraction(caseId, intent, signal);
        setExtraction(current => current ? { ...current, stateVersion: response.data.stateVersion } : current);
        safeState("confirmed", "识别内容已由你确认。");
      } catch (error) {
        if (isAbort(signal, error)) return;
        if (apiErrorCode(error) === "VERSION_CONFLICT") {
          setConfirmedItemIds([]);
          await readExtraction(true);
          return;
        }
        safeState(isUnknownAfterRetry(error) ? "confirm_unknown" : "confirm_error", isUnknownAfterRetry(error) ? reviewStateMessage("confirm_unknown") : reviewErrorMessage(error, reviewStateMessage("confirm_error")));
      }
    });
  };

  const startHypotheses = async () => {
    if (!extraction || (state !== "confirmed" && state !== "run_next_error")) return;
    const intent = createRunNextIntent(extraction.stateVersion);
    safeState("run_next");
    await withController(async signal => {
      try {
        await queueRunNext(caseId, intent, signal);
        await readHypotheses();
      } catch (error) {
        if (isAbort(signal, error)) return;
        if (apiErrorCode(error) === "VERSION_CONFLICT") {
          try {
            const latest = await getCase(caseId, signal);
            setExtraction(current => current ? { ...current, stateVersion: latest.data.stateVersion } : current);
            safeState("confirmed", "内容已更新，请重新确认后开始找原因。");
          } catch (refreshError) {
            safeState("run_next_error", reviewErrorMessage(refreshError, reviewStateMessage("run_next_error")));
          }
          return;
        }
        safeState(isUnknownAfterRetry(error) ? "run_next_unknown" : "run_next_error", isUnknownAfterRetry(error) ? reviewStateMessage("run_next_unknown") : reviewErrorMessage(error, reviewStateMessage("run_next_error")));
      }
    });
  };

  const submitProbeAnswer = async () => {
    if (!hypotheses || !selectedChoiceId || controlsLocked) return;
    const intent = createProbeIntent(hypotheses.stateVersion, hypotheses.probe.id, selectedChoiceId);
    safeState("probe_submitting");
    await withController(async signal => {
      try {
        const response = await submitProbe(caseId, intent, signal);
        setAttempt(response.data);
        safeState("probe_success");
      } catch (error) {
        if (isAbort(signal, error)) return;
        if (apiErrorCode(error) === "VERSION_CONFLICT") {
          await readHypotheses(true);
          safeState("probe_conflict", reviewStateMessage("probe_conflict"));
          return;
        }
        safeState(isUnknownAfterRetry(error) ? "probe_unknown" : "probe_error", isUnknownAfterRetry(error) ? reviewStateMessage("probe_unknown") : reviewErrorMessage(error, reviewStateMessage("probe_error")));
      }
    });
  };

  const acceptIntervention = async () => {
    if (!attempt || !reviewSuccessIsInterventionReady(attempt.state) || (state !== "probe_success" && state !== "intervention_error")) return;
    const intent = createRunNextIntent(attempt.stateVersion);
    safeState("run_next");
    await withController(async signal => {
      try {
        await queueRunNext(caseId, intent, signal);
        safeState("intervention_accepted");
      } catch (error) {
        if (isAbort(signal, error)) return;
        if (apiErrorCode(error) === "VERSION_CONFLICT") {
          try {
            const latest = await getCase(caseId, signal);
            setAttempt(current => current ? { ...current, stateVersion: latest.data.stateVersion } : current);
            safeState("probe_success", "内容已更新，请重新确认后开始准备引导练习。");
          } catch (refreshError) {
            safeState("run_next_error", reviewErrorMessage(refreshError, reviewStateMessage("run_next_error")));
          }
          return;
        }
        safeState(isUnknownAfterRetry(error) ? "intervention_unknown" : "intervention_error", isUnknownAfterRetry(error) ? reviewStateMessage("intervention_unknown") : reviewErrorMessage(error, reviewStateMessage("intervention_error")));
      }
    });
  };

  return <AppShell actionHref="/student/today" actionLabel="返回今日">
    <section className="case-review-page" data-review-state={state} aria-labelledby="case-review-title">
      <div className="case-review-boundary" role="note">
        <strong>体验识别内容</strong>
        <span>本次不会读取上传图片中的文字，也不会保存为正式学习记录</span>
      </div>
      <header className="case-review-heading">
        <h1 id="case-review-title">查看并确认识别内容</h1>
        <p>请逐项核对题干，发现不准确的地方可以直接修改。这里不会显示答案或评分。</p>
      </header>
      <p className={`case-review-live ${isAlertState(state) ? "error" : ""}`} aria-live={isAlertState(state) ? "assertive" : "polite"} role={isAlertState(state) ? "alert" : undefined}>{message}</p>
      {state === "loading" || state === "not_ready"
        ? <section className="case-review-state"><h2>{state === "loading" ? "正在读取识别内容" : "识别内容尚未准备好"}</h2><p>{message}</p><button type="button" className="primary-blue" onClick={() => void readExtraction()}>重新加载</button></section>
        : null}
      {state === "empty" || state === "error"
        ? <section className="case-review-state case-review-state-error" data-review-state="error"><h2>{state === "empty" ? "没有可确认内容" : "暂时无法读取"}</h2><p>{message}</p><button type="button" className="primary-blue" onClick={() => void readExtraction()}>重新加载</button></section>
        : null}
      {extraction && ["ready", "confirming", "confirm_conflict", "confirm_error", "confirm_unknown"].includes(state)
        ? <section className="case-review-panel" aria-labelledby="extraction-title">
          <div className="case-review-panel-heading"><div><span>待确认内容</span><h2 id="extraction-title">逐项确认题干</h2></div><span className="case-review-tag">体验内容</span></div>
          <div className="case-review-items">
            {extraction.items.map(item => {
              const checked = confirmedItemIds.includes(item.itemId);
              return <article className="case-review-item" key={item.itemId}>
                <label htmlFor={`prompt-${item.itemId}`}>题干</label>
                <textarea id={`prompt-${item.itemId}`} value={promptValues[item.itemId] ?? item.prompt} onChange={event => setPromptValues(previous => ({ ...previous, [item.itemId]: event.currentTarget.value }))} disabled={controlsLocked} rows={3}/>
                <label className="case-review-confirm-item"><input type="checkbox" checked={checked} onChange={event => { const nextChecked = event.currentTarget.checked; setConfirmedItemIds(previous => nextChecked ? [...previous, item.itemId] : previous.filter(id => id !== item.itemId)); }} disabled={controlsLocked}/><span>我确认这一项题干</span></label>
              </article>;
            })}
          </div>
          <button type="button" className="primary-blue" onClick={() => void submitExtraction()} disabled={!allConfirmed || !promptsValid || controlsLocked}>{state === "confirming" ? "正在保存" : state === "confirm_conflict" ? "确认后重新提交" : "确认识别内容"}</button>
          {state === "confirm_unknown" ? <p className="case-review-feedback error" role="alert">暂时无法确认是否保存成功，请返回今日页稍后查看。</p> : null}
        </section>
        : null}
      {state === "confirmed"
        ? <section className="case-review-state" data-review-confirmed><h2>识别内容已由你确认</h2><p>下一步会准备找原因的确认小题，不代表识别正确或产生学习结论。</p><button type="button" className="primary-blue" onClick={() => void startHypotheses()}>开始找原因</button></section>
        : null}
      {state === "run_next" || state === "hypotheses_loading" || state === "run_next_error"
        ? <section className="case-review-state"><h2>{state === "run_next_error" ? "找原因没有准备好" : "正在准备找原因"}</h2><p>{message}</p>{state === "run_next_error" ? <button type="button" className="primary-blue" onClick={() => void startHypotheses()}>重新开始找原因</button> : null}</section>
        : null}
      {hypotheses && ["hypotheses", "probe_submitting", "probe_conflict", "probe_error", "probe_unknown"].includes(state)
        ? <section className="case-review-panel" aria-labelledby="hypotheses-title">
          <div className="case-review-panel-heading"><div><span>根据本次作答整理</span><h2 id="hypotheses-title">可能卡住的地方</h2></div><span className="case-review-tag">仅供本次参考</span></div>
          <div className="case-review-candidates">{hypotheses.candidates.map(candidate => <article key={candidate.id}><h3>{candidate.title}</h3><p>{candidate.explanation}</p></article>)}</div>
          <div className="case-review-probe"><h3>确认小题</h3><p>{hypotheses.probe.prompt}</p><fieldset disabled={controlsLocked}><legend>选择一个最符合的选项</legend>{hypotheses.probe.choices.map(choice => <label key={choice.id}><input type="radio" name="case-review-probe" value={choice.id} checked={selectedChoiceId === choice.id} onChange={() => setSelectedChoiceId(choice.id)}/><span>{choice.label}</span></label>)}</fieldset></div>
          <button type="button" className="primary-blue" onClick={() => void submitProbeAnswer()} disabled={!selectedChoiceId || controlsLocked}>{state === "probe_submitting" ? "正在提交" : state === "probe_conflict" ? "确认后重新提交" : "提交确认小题"}</button>
        </section>
        : null}
      {state === "probe_success"
        ? <section className="case-review-state" data-probe-result><h2>已收到，正在准备下一步</h2><p>本次选择已保存。这里只给出下一步提示，不会显示答案或分数。</p>{attempt && reviewSuccessIsInterventionReady(attempt.state) ? <button type="button" className="primary-blue" onClick={() => void acceptIntervention()}>开始准备引导任务</button> : null}</section>
        : null}
      {state === "intervention_error"
        ? <section className="case-review-state case-review-state-error"><h2>引导任务准备没有完成</h2><p>{message}</p><button type="button" className="primary-blue" onClick={() => void acceptIntervention()}>重新开始准备引导任务</button></section>
        : null}
      {state === "intervention_accepted"
        ? <section className="case-review-state" data-intervention-accepted><h2>下一步已准备好</h2><p>返回“今日”，继续完成接下来的任务。</p><a className="primary-blue" href="/student/today">返回今日继续任务</a></section>
        : null}
    </section>
  </AppShell>;
}
