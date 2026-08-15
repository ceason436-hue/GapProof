"use client";

import type { GuidedInterventionTaskView } from "@gapproof/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiClientError } from "@/lib/api-client";
import { formatTaskDateTime } from "@/lib/today-adapter";
import {
  createGuidedTaskIntent,
  getCaseForGuidedTask,
  guidedTaskGuards,
  submitGuidedTask,
} from "@/lib/guided-task";

type CompletionState =
  | { kind: "loading_case" }
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "conflict"; requestId?: string }
  | { kind: "success"; scheduledFor: string }
  | { kind: "case_error"; code: string; requestId?: string; retryable?: boolean }
  | { kind: "error"; code: string; requestId?: string; retryable?: boolean };

export function refreshTodayAfterConfirmedSubmit(refresh: () => void) {
  refresh();
}

export function toCaseErrorState(error: unknown): Extract<CompletionState, { kind: "case_error" }> {
  if (error instanceof ApiClientError) {
    return { kind: "case_error", code: error.response.error.code, requestId: error.response.requestId, retryable: error.response.error.retryable };
  }
  return { kind: "case_error", code: "CASE_SYNC_FAILED" };
}

export function toSubmitErrorState(error: unknown): Extract<CompletionState, { kind: "error" }> {
  if (error instanceof ApiClientError) {
    return { kind: "error", code: error.response.error.code, requestId: error.response.requestId, retryable: error.response.error.retryable };
  }
  return { kind: "error", code: "NETWORK_UNKNOWN" };
}

function caseErrorMessage(state: Extract<CompletionState, { kind: "case_error" }>) {
  const detail = state.code === "RESOURCE_NOT_FOUND"
    ? "这项任务暂时不可用；你的选择仍保留，请重新加载或返回今日。"
    : "暂时无法加载最新内容；你的选择仍保留，请重新加载后再继续。";
  return <p className="guided-task-feedback error" role="alert">{detail}</p>;
}

function errorMessage(state: Extract<CompletionState, { kind: "error" }>) {
  const detail = state.code === "INVALID_INPUT" || state.code === "SCHEMA_INVALID"
    ? "请完成全部步骤后再试；已完成的选择仍保留。"
    : state.code === "INVALID_TASK_STATE"
      ? "任务内容已经更新，请返回今日页查看最新安排。"
      : state.code === "IDEMPOTENCY_KEY_REUSED"
        ? "这次操作没有完成，请重新确认后再试。"
        : state.code === "RESOURCE_NOT_FOUND"
          ? "没有找到这项任务，请返回今日刷新最新安排。"
          : state.code === "NETWORK_UNKNOWN"
            ? "暂时无法确认是否提交成功。为避免重复操作，请返回今日页查看。"
            : "服务暂时没有完成这次提交；请再次确认后重试。已保留你的选择。";
  return <p className="guided-task-feedback error" role="alert">{detail}</p>;
}

export function GuidedTaskCompletion({ task, timeZone }: { task: GuidedInterventionTaskView; timeZone: string }) {
  const router = useRouter();
  const requiredStepIds = task.steps.map(step => step.id);
  const [expectedVersion, setExpectedVersion] = useState<number | null>(null);
  const [completedStepIds, setCompletedStepIds] = useState<string[]>([]);
  const [state, setState] = useState<CompletionState>({ kind: "loading_case" });

  const refreshCase = async () => {
    setState({ kind: "loading_case" });
    try {
      const response = await getCaseForGuidedTask(task.caseId);
      setExpectedVersion(response.data.stateVersion);
      setState({ kind: "idle" });
    } catch (error) {
      setState(toCaseErrorState(error));
    }
  };

  useEffect(() => { void refreshCase(); }, [task.caseId]);

  const toggleStep = (stepId: string, checked: boolean) => {
    if (state.kind === "submitting" || state.kind === "success" || state.kind === "error" && (state.code === "NETWORK_UNKNOWN" || state.code === "INVALID_TASK_STATE")) return;
    setCompletedStepIds(current => checked
      ? current.includes(stepId) ? current : [...current, stepId]
      : current.filter(id => id !== stepId));
    if (state.kind === "conflict" || state.kind === "error") setState({ kind: "idle" });
  };

  const submit = async () => {
    const locked = state.kind === "error" && (state.code === "NETWORK_UNKNOWN" || state.code === "INVALID_TASK_STATE");
    const guards = guidedTaskGuards(expectedVersion, requiredStepIds, completedStepIds, locked);
    if (!guards.submitAllowed || state.kind === "submitting" || state.kind === "success") return;
    let authoritativeVersion = expectedVersion!;
    if (state.kind !== "conflict") {
      setState({ kind: "loading_case" });
      try {
        const latest = await getCaseForGuidedTask(task.caseId);
        authoritativeVersion = latest.data.stateVersion;
        setExpectedVersion(authoritativeVersion);
      } catch (error) {
        setState(toCaseErrorState(error));
        return;
      }
    }
    const intent = createGuidedTaskIntent(authoritativeVersion, requiredStepIds, completedStepIds);
    if (!intent) {
      setState({ kind: "error", code: "INVALID_INPUT" });
      return;
    }
    setState({ kind: "submitting" });
    try {
      const response = await submitGuidedTask(task.id, intent.body, intent.idempotencyKey);
      setState({ kind: "success", scheduledFor: response.data.scheduledRetest.scheduledFor });
      refreshTodayAfterConfirmedSubmit(router.refresh);
    } catch (error) {
      if (error instanceof ApiClientError && error.response.error.code === "VERSION_CONFLICT") {
        try {
          const latest = await getCaseForGuidedTask(task.caseId);
          setExpectedVersion(latest.data.stateVersion);
          setState({ kind: "conflict", requestId: error.response.requestId });
        } catch (refreshError) {
          setState(toCaseErrorState(refreshError));
        }
        return;
      }
      setState(toSubmitErrorState(error));
    }
  };

  if (state.kind === "success") {
    return <article className="guided-task-result" data-guided-result="success" aria-live="polite">
      <span className="task-kind">本次练习已完成</span>
      <h3>明日复习已安排</h3>
      <p>下一次检查：{formatTaskDateTime(state.scheduledFor, timeZone)}。</p>
      <p>完成后续检查前，这不代表已经掌握。</p>
    </article>;
  }

  const locked = state.kind === "error" && (state.code === "NETWORK_UNKNOWN" || state.code === "INVALID_TASK_STATE");
  const guards = guidedTaskGuards(expectedVersion, requiredStepIds, completedStepIds, locked);
  const disabled = state.kind === "loading_case" || state.kind === "submitting" || !guards.submitAllowed;
  return <div className="guided-task-panel" data-guided-task-state={state.kind}>
    <p className="guided-task-note">逐项完成后再提交。完成本次任务不代表已经掌握，还需要后续复习确认。</p>
    <fieldset disabled={!guards.editable || state.kind === "loading_case" || state.kind === "submitting"}>
      <legend>完成本次引导任务</legend>
      <div className="guided-task-steps">
        {task.steps.map(step => <label key={step.id} className="guided-task-step">
          <input type="checkbox" value={step.id} checked={completedStepIds.includes(step.id)} onChange={event => toggleStep(step.id, event.target.checked)} />
          <span><strong>{step.title}</strong><small>{step.content}</small></span>
        </label>)}
      </div>
    </fieldset>
    {state.kind === "conflict" ? <p className="guided-task-feedback error" role="alert">任务内容已更新，请再次确认全部步骤后提交。</p> : null}
    {state.kind === "case_error" ? caseErrorMessage(state) : null}
    {state.kind === "error" ? errorMessage(state) : null}
    {state.kind === "case_error"
      ? <button className="guided-task-submit" type="button" onClick={() => { void refreshCase(); }}>重新加载</button>
      : state.kind === "error" && (state.code === "NETWORK_UNKNOWN" || state.code === "INVALID_TASK_STATE")
      ? <a className="guided-task-submit" href="/student/today">{state.code === "NETWORK_UNKNOWN" ? "请刷新今日" : "返回今日刷新"}</a>
      : <button className="guided-task-submit" type="button" onClick={() => { void submit(); }} disabled={disabled}>
        {state.kind === "loading_case" ? "正在加载最新内容" : state.kind === "submitting" ? "正在提交" : state.kind === "conflict" ? "确认后重新提交" : state.kind === "error" && state.retryable ? "再次确认提交" : "确认完成任务"}
      </button>}
  </div>;
}
