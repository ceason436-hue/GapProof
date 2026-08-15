"use client";

import type { GuidedInterventionTaskView } from "@gapproof/contracts";
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
  | { kind: "error"; code: string; requestId?: string; retryable?: boolean };

function toErrorState(error: unknown): Extract<CompletionState, { kind: "error" }> {
  if (error instanceof ApiClientError) {
    return { kind: "error", code: error.response.error.code, requestId: error.response.requestId, retryable: error.response.error.retryable };
  }
  return { kind: "error", code: "NETWORK_UNKNOWN" };
}

function errorMessage(state: Extract<CompletionState, { kind: "error" }>) {
  const detail = state.code === "INVALID_INPUT" || state.code === "SCHEMA_INVALID"
    ? "请完成全部步骤后再试；已完成的选择仍保留。"
    : state.code === "INVALID_TASK_STATE"
      ? "服务端任务状态已经变化，请返回今日刷新最新安排。"
      : state.code === "IDEMPOTENCY_KEY_REUSED"
        ? "这次提交标识已被其他内容使用，请重新确认后再试。"
        : state.code === "RESOURCE_NOT_FOUND"
          ? "没有找到这项任务，请返回今日刷新最新安排。"
          : state.code === "NETWORK_UNKNOWN"
            ? "提交结果未确认；选择和提交已锁定，请刷新今日查看服务端状态。页面不会再次提交。"
            : "服务暂时没有完成这次提交；请再次确认后重试。已保留你的选择。";
  return <p className="guided-task-feedback error" role="alert">{detail}{state.requestId ? ` 请求编号：${state.requestId}` : ""}</p>;
}

export function GuidedTaskCompletion({ task, timeZone }: { task: GuidedInterventionTaskView; timeZone: string }) {
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
      setState(toErrorState(error));
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
        setState(toErrorState(error));
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
    } catch (error) {
      if (error instanceof ApiClientError && error.response.error.code === "VERSION_CONFLICT") {
        try {
          const latest = await getCaseForGuidedTask(task.caseId);
          setExpectedVersion(latest.data.stateVersion);
          setState({ kind: "conflict", requestId: error.response.requestId });
        } catch (refreshError) {
          setState(toErrorState(refreshError));
        }
        return;
      }
      setState(toErrorState(error));
    }
  };

  if (state.kind === "success") {
    return <article className="guided-task-result" data-guided-result="success" aria-live="polite">
      <span className="task-kind">干预已完成</span>
      <h3>D+1 已安排</h3>
      <p>下一次检查：{formatTaskDateTime(state.scheduledFor, timeZone)}。</p>
      <p>服务端状态：已安排。后续检查不代表已经掌握或修复。</p>
    </article>;
  }

  const locked = state.kind === "error" && (state.code === "NETWORK_UNKNOWN" || state.code === "INVALID_TASK_STATE");
  const guards = guidedTaskGuards(expectedVersion, requiredStepIds, completedStepIds, locked);
  const disabled = state.kind === "loading_case" || state.kind === "submitting" || !guards.submitAllowed;
  return <div className="guided-task-panel" data-guided-task-state={state.kind}>
    <p className="guided-task-note">逐项完成后提交；页面只记录服务端返回的任务状态，不生成掌握结论。</p>
    <fieldset disabled={!guards.editable || state.kind === "loading_case" || state.kind === "submitting"}>
      <legend>完成本次引导任务</legend>
      <div className="guided-task-steps">
        {task.steps.map(step => <label key={step.id} className="guided-task-step">
          <input type="checkbox" value={step.id} checked={completedStepIds.includes(step.id)} onChange={event => toggleStep(step.id, event.target.checked)} />
          <span><strong>{step.title}</strong><small>{step.content}</small></span>
        </label>)}
      </div>
    </fieldset>
    {state.kind === "conflict" ? <p className="guided-task-feedback error" role="alert">任务版本已更新，已同步最新版本。请再次确认全部步骤后提交。{state.requestId ? ` 请求编号：${state.requestId}` : ""}</p> : null}
    {state.kind === "error" ? errorMessage(state) : null}
    {state.kind === "error" && (state.code === "NETWORK_UNKNOWN" || state.code === "INVALID_TASK_STATE")
      ? <a className="guided-task-submit" href="/student/today">{state.code === "NETWORK_UNKNOWN" ? "请刷新今日" : "返回今日刷新"}</a>
      : <button className="guided-task-submit" type="button" onClick={() => { void submit(); }} disabled={disabled}>
        {state.kind === "loading_case" ? "正在同步任务" : state.kind === "submitting" ? "正在提交" : state.kind === "conflict" ? "确认后重新提交" : state.kind === "error" && state.retryable ? "再次确认提交" : "确认完成任务"}
      </button>}
  </div>;
}
