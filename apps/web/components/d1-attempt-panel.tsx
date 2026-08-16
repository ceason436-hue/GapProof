"use client";

import {
  type D1RetestAttemptView,
  type D1RetestTaskView,
} from "@gapproof/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

export function refreshTodayAfterConfirmedD1Submit(refresh: () => void) {
  refresh();
}

export function refreshAuthoritativeTodayAfterUnknownD1(
  replace: (href: string) => void,
  refresh: () => void,
) {
  replace("/student/today?source=api");
  refresh();
}

export function D1UnknownAttemptRecovery({ onRefresh }: { onRefresh: () => void }) {
  return <div className="attempt-recovery" data-attempt-recovery="network-unknown">
    <p className="read-only-note">这里不会再次提交你的答案。请重新打开今日页，查看最新任务状态。</p>
    <button type="button" onClick={onRefresh}>重新读取今日状态</button>
    <a className="hero-secondary-link" href="/student/today?source=api">返回今日</a>
  </div>;
}

export function d1AttemptResultCopy(state: D1AttemptResultState, passed: boolean) {
  if (state === "support_required") {
    return {
      title: "需要老师或家长协助",
      detail: "自动调整已达到上限，请老师或家长一起看看下一步。",
    };
  }
  return passed
    ? { title: "7 天后巩固已安排", detail: null }
    : { title: "正在调整接下来的计划", detail: "新的安排还在准备中，请稍后回到今日页查看。" };
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
        ? "这次操作没有完成，请重新确认后再提交。"
        : state.code === "RESOURCE_NOT_FOUND"
          ? "没有找到这项检查，请返回今日页查看最新安排。"
          : "暂时无法确认是否提交成功。为避免重复操作，请返回今日页查看。";
  return <p className="attempt-feedback error" role="alert">{detail}</p>;
}

export function D1AttemptPanel({ task, timeZone }: { task: D1RetestTaskView; timeZone: string }) {
  const router = useRouter();
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
      refreshTodayAfterConfirmedD1Submit(router.refresh);
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
    const selectedChoiceLabel = task.item.choices.find(choice => choice.id === state.selectedChoiceId)?.label ?? "已提交";
    return <article className="attempt-result" data-attempt-result={state.state === "support_required" ? "support_required" : state.passed ? "passed" : "replan_required"}>
      <span className="task-kind">本次复习已完成</span>
      <h3>{resultCopy.title}</h3>
      <p>你本次选择：{selectedChoiceLabel}</p>
      {resultCopy.detail
        ? <p>{resultCopy.detail}</p>
        : state.passed && state.scheduledFor
        ? <p>7 天后巩固：{formatTaskDateTime(state.scheduledFor, timeZone)}。这只是后续复习安排，不代表已经掌握。</p>
        : <p>新的安排还在准备中，请稍后回到今日页查看。</p>}
      <div className="guided-task-result-actions">
        <Link className="primary-blue" href="/student/today?source=api">返回今日查看安排</Link>
        <Link className="secondary-button" href="/student/plan">查看 7 日计划</Link>
      </div>
    </article>;
  }

  const resultUnconfirmed = state.kind === "error" && state.code === "NETWORK_UNKNOWN";
  const guards = d1AttemptGuards(expectedVersion, selectedChoiceId, resultUnconfirmed);
  const disabled = state.kind === "loading_case" || state.kind === "submitting" || !guards.submitAllowed;
  return <div className="attempt-panel" data-d1-attempt-state={state.kind}>
    <p className="read-only-note">选择答案并提交后查看本次结果。完成这道题不代表已经掌握。</p>
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
    {state.kind === "conflict" ? <p className="attempt-feedback error" role="alert">内容已更新，请确认选择后重新提交。</p> : null}
    {state.kind === "error" ? errorCopy(state) : null}
    {resultUnconfirmed
      ? <D1UnknownAttemptRecovery onRefresh={() => refreshAuthoritativeTodayAfterUnknownD1(router.replace, router.refresh)}/>
      : <button type="button" onClick={() => { void submit(); }} disabled={disabled}>
        {state.kind === "loading_case" ? "正在加载最新内容" : state.kind === "submitting" ? "正在提交" : state.kind === "conflict" ? "确认后重新提交" : "提交本次选择"}
      </button>}
  </div>;
}
