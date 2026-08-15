"use client";

import {
  type D1RetestAttemptView,
  type D1RetestTaskView,
} from "@gapproof/contracts";
import { useEffect, useState } from "react";
import { ApiClientError } from "@/lib/api-client";
import { createD1AttemptIntent, d1AttemptGuards, getCaseForD1Attempt, submitD1Attempt } from "@/lib/d1-attempt";
import { formatTaskDateTime } from "@/lib/today-adapter";

type D1AttemptResultState = D1RetestAttemptView["state"] | "support_required";

type SubmitState =
  | { kind: "loading_case" }
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "conflict"; requestId: string }
  | { kind: "error"; code: string; requestId?: string }
  | { kind: "success"; passed: boolean; state: D1AttemptResultState; stateVersion: number; selectedChoiceId: string; scheduledFor: string | null };

export function d1AttemptResultCopy(state: D1AttemptResultState, passed: boolean) {
  if (state === "support_required") {
    return {
      title: "需要老师或家长协助",
      detail: "同一 Case 已达到最多两次自动重排上限，需要老师或家长协助；停止自动重排。",
    };
  }
  return passed
    ? { title: "D+7 已安排", detail: null }
    : { title: "正在调整接下来的计划", detail: "服务端正在等待异步任务处理；当前不会宣称已形成真实个性化调整。" };
}

function errorState(error: unknown): Extract<SubmitState, { kind: "error" }> {
  if (error instanceof ApiClientError) {
    return { kind: "error", code: error.response.error.code, requestId: error.response.requestId };
  }
  return { kind: "error", code: "NETWORK_UNKNOWN" };
}

function errorCopy(state: Extract<SubmitState, { kind: "error" }>) {
  const detail = state.code === "SCHEMA_INVALID" || state.code === "INVALID_INPUT"
    ? "请选择一个选项后再试；你的选择仍保留。"
    : state.code === "INVALID_TASK_STATE"
      ? "这个检查状态已变化，请返回今日页查看最新安排。"
      : state.code === "IDEMPOTENCY_KEY_REUSED"
        ? "这次提交标识已被其他内容使用，请重新确认后再提交。"
        : state.code === "RESOURCE_NOT_FOUND"
          ? "没有找到这项检查，请返回今日页查看最新安排。"
          : "结果未确认，请刷新任务状态或返回今日页确认；页面不会再次提交或生成新的提交标识。";
  return <p className="attempt-feedback error" role="alert">{detail}{state.requestId ? ` 请求编号：${state.requestId}` : ""}</p>;
}

export function D1AttemptPanel({ task, timeZone }: { task: D1RetestTaskView; timeZone: string }) {
  const [expectedVersion, setExpectedVersion] = useState<number | null>(null);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [state, setState] = useState<SubmitState>({ kind: "loading_case" });

  const refreshCase = async () => {
    setState({ kind: "loading_case" });
    try {
      const response = await getCaseForD1Attempt(task.caseId);
      setExpectedVersion(response.data.stateVersion);
      setState({ kind: "idle" });
    } catch (error) {
      setState(errorState(error));
    }
  };

  useEffect(() => { void refreshCase(); }, [task.caseId]);

  const submit = async () => {
    if (state.kind === "error" && state.code === "NETWORK_UNKNOWN") return;
    if (expectedVersion === null || selectedChoiceId === null) return;
    const intent = createD1AttemptIntent(expectedVersion, task.item.id, selectedChoiceId);
    if (!intent) {
      setState({ kind: "error", code: "INVALID_INPUT" });
      return;
    }
    setState({ kind: "submitting" });
    // The UUIDv7 and body are frozen for this confirmed user action. apiPost
    // reuses this exact intent once for unknown/retryable outcomes.
    try {
      const response = await submitD1Attempt(task.id, intent.body, intent.idempotencyKey);
      const result = response.data;
      setState({
        kind: "success",
        passed: result.passed,
        state: result.state,
        stateVersion: result.stateVersion,
        selectedChoiceId: result.selectedChoiceId,
        scheduledFor: result.scheduledRetest?.scheduledFor ?? null,
      });
    } catch (error) {
      if (error instanceof ApiClientError && error.response.error.code === "VERSION_CONFLICT") {
        try {
          const latest = await getCaseForD1Attempt(task.caseId);
          setExpectedVersion(latest.data.stateVersion);
          setState({ kind: "conflict", requestId: error.response.requestId });
        } catch (refreshError) {
          setState(errorState(refreshError));
        }
        return;
      }
      setState(errorState(error));
    }
  };

  if (state.kind === "success") {
    const resultCopy = d1AttemptResultCopy(state.state, state.passed);
    return <article className="attempt-result" data-attempt-result={state.state === "support_required" ? "support_required" : state.passed ? "passed" : "replan_required"}>
      <span className="task-kind">本次提交已由服务端记录</span>
      <h3>{resultCopy.title}</h3>
      <p>你本次选择：{state.selectedChoiceId}</p>
      {resultCopy.detail
        ? <p>{resultCopy.detail}</p>
        : state.passed && state.scheduledFor
        ? <p>下一次延迟检查：{formatTaskDateTime(state.scheduledFor, timeZone)}。这只增加一条后续检查安排，不代表已经掌握。</p>
        : <p>服务端正在等待异步任务处理；当前不会宣称已形成真实个性化调整。</p>}
      <div className="config-detail">{state.state} · v{state.stateVersion}</div>
    </article>;
  }

  const resultUnconfirmed = state.kind === "error" && state.code === "NETWORK_UNKNOWN";
  const guards = d1AttemptGuards(expectedVersion, selectedChoiceId, resultUnconfirmed);
  const disabled = state.kind === "loading_case" || state.kind === "submitting" || !guards.submitAllowed;
  return <div className="attempt-panel" data-d1-attempt-state={state.kind}>
    <p className="read-only-note">选择后由服务端评分；页面不会显示答案键或评分映射。</p>
    <fieldset disabled={state.kind === "loading_case" || state.kind === "submitting" || !guards.editable}>
      <legend>选择一个答案</legend>
      <div className="attempt-choices">{task.item.choices.map(choice => <label key={choice.id}>
        <input
          type="radio"
          name={`d1-${task.id}`}
          value={choice.id}
          checked={selectedChoiceId === choice.id}
          onChange={() => { if (!guards.editable) return; setSelectedChoiceId(choice.id); if (state.kind !== "submitting") setState({ kind: "idle" }); }}
        />
        <span>{choice.label}</span>
      </label>)}</div>
    </fieldset>
    {state.kind === "conflict" ? <p className="attempt-feedback error" role="alert">内容已更新，已同步最新版本。请确认选择后重新提交。请求编号：{state.requestId}</p> : null}
    {state.kind === "error" ? errorCopy(state) : null}
    <button type="button" onClick={() => { void submit(); }} disabled={disabled}>
      {state.kind === "loading_case" ? "正在同步检查" : state.kind === "submitting" ? "正在提交" : resultUnconfirmed ? "请先确认任务状态" : state.kind === "conflict" ? "确认后重新提交" : "提交本次选择"}
    </button>
  </div>;
}
