"use client";

import type { D7RetestAttemptView, D7RetestTaskView } from "@gapproof/contracts";
import { useEffect, useState } from "react";
import { ApiClientError } from "@/lib/api-client";
import {
  createD7AttemptIntent,
  d7AttemptGuards,
  getCaseForD7Attempt,
  submitD7Attempt,
} from "@/lib/d7-attempt";

type D7AttemptResultState = D7RetestAttemptView["state"];

type SubmitState =
  | { kind: "loading_case" }
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "conflict"; requestId?: string }
  | { kind: "case_error"; code: string; requestId?: string }
  | { kind: "error"; code: string; requestId?: string; retryable?: boolean }
  | { kind: "success"; state: D7AttemptResultState; stateVersion: number };

export function d7AttemptResultCopy(state: D7AttemptResultState) {
  if (state === "repair_verified") {
    return {
      title: "第 7 天新题检查已通过",
      detail: "本次新题作答通过。这个结果只代表本次检查。",
    };
  }
  if (state === "support_required") {
    return {
      title: "需要老师或家长协助",
      detail: "自动调整已达到上限，请老师或家长一起看看下一步。",
    };
  }
  return {
    title: "正在调整接下来的计划",
    detail: "这次 7 天后巩固还需要再练习，新的安排会出现在今日页。",
  };
}

function toCaseErrorState(error: unknown): Extract<SubmitState, { kind: "case_error" }> {
  if (error instanceof ApiClientError) {
    return { kind: "case_error", code: error.response.error.code, requestId: error.response.requestId };
  }
  return { kind: "case_error", code: "CASE_SYNC_FAILED" };
}

function toSubmitErrorState(error: unknown): Extract<SubmitState, { kind: "error" }> {
  if (error instanceof ApiClientError) {
    return { kind: "error", code: error.response.error.code, requestId: error.response.requestId, retryable: error.response.error.retryable };
  }
  return { kind: "error", code: "NETWORK_UNKNOWN" };
}

function caseErrorCopy(state: Extract<SubmitState, { kind: "case_error" }>) {
  const detail = state.code === "RESOURCE_NOT_FOUND"
    ? "没有找到这项检查；你的选择仍保留，请重新加载或返回今日。"
    : "暂时无法加载最新内容；你的选择仍保留，请重新加载后再继续。";
  return <p className="attempt-feedback error" role="alert">{detail}</p>;
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
          : state.retryable || state.code === "NETWORK_UNKNOWN"
            ? "暂时无法确认是否提交成功。为避免重复操作，请返回今日页查看。"
            : "这次检查暂时没有完成，请返回今日页查看最新安排。";
  return <p className="attempt-feedback error" role="alert">{detail}</p>;
}

export function D7AttemptPanel({ task }: { task: D7RetestTaskView }) {
  const [expectedVersion, setExpectedVersion] = useState<number | null>(null);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [state, setState] = useState<SubmitState>({ kind: "loading_case" });

  const refreshCase = async () => {
    setState({ kind: "loading_case" });
    try {
      const response = await getCaseForD7Attempt(task.caseId);
      setExpectedVersion(response.data.stateVersion);
      setState({ kind: "idle" });
    } catch (error) {
      setState(toCaseErrorState(error));
    }
  };

  useEffect(() => { void refreshCase(); }, [task.caseId]);

  const selectChoice = (choiceId: string) => {
    const resultUnconfirmed = state.kind === "error" && (state.code === "NETWORK_UNKNOWN" || state.retryable === true);
    if (state.kind === "submitting" || state.kind === "success" || resultUnconfirmed) return;
    setSelectedChoiceId(choiceId);
    if (state.kind === "conflict" || state.kind === "error") setState({ kind: "idle" });
  };

  const submit = async () => {
    const resultUnconfirmed = state.kind === "error" && (state.code === "NETWORK_UNKNOWN" || state.retryable === true);
    const guards = d7AttemptGuards(expectedVersion, selectedChoiceId, resultUnconfirmed);
    if (!guards.submitAllowed || state.kind === "submitting" || state.kind === "success") return;

    let authoritativeVersion = expectedVersion!;
    if (state.kind !== "conflict") {
      setState({ kind: "loading_case" });
      try {
        const latest = await getCaseForD7Attempt(task.caseId);
        authoritativeVersion = latest.data.stateVersion;
        setExpectedVersion(authoritativeVersion);
      } catch (error) {
        setState(toCaseErrorState(error));
        return;
      }
    }

    const intent = createD7AttemptIntent(authoritativeVersion, task.item.id, selectedChoiceId);
    if (!intent) {
      setState({ kind: "error", code: "INVALID_INPUT" });
      return;
    }
    setState({ kind: "submitting" });
    try {
      const response = await submitD7Attempt(task.id, intent.body, intent.idempotencyKey);
      setState({ kind: "success", state: response.data.state, stateVersion: response.data.stateVersion });
    } catch (error) {
      if (error instanceof ApiClientError && error.response.error.code === "VERSION_CONFLICT") {
        try {
          const latest = await getCaseForD7Attempt(task.caseId);
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
    const result = d7AttemptResultCopy(state.state);
    return <article className="attempt-result" data-d7-attempt-result={state.state} aria-live="polite">
      <span className="task-kind">本次巩固已完成</span>
      <h3>{result.title}</h3>
      <p>{result.detail}</p>
    </article>;
  }

  const resultUnconfirmed = state.kind === "error" && (state.code === "NETWORK_UNKNOWN" || state.retryable === true);
  const guards = d7AttemptGuards(expectedVersion, selectedChoiceId, resultUnconfirmed);
  const disabled = state.kind === "loading_case" || state.kind === "submitting" || !guards.submitAllowed;
  return <div className="attempt-panel" data-d7-attempt-state={state.kind}>
    <p className="read-only-note">选择答案并提交后查看本次结果。这里只显示你的作答情况，不显示答案。</p>
    <fieldset disabled={state.kind === "loading_case" || state.kind === "submitting" || !guards.editable}>
      <legend>选择一个答案</legend>
      <div className="attempt-choices">{task.item.choices.map(choice => <label key={choice.id}>
        <input
          type="radio"
          name={`d7-${task.id}`}
          value={choice.id}
          checked={selectedChoiceId === choice.id}
          onChange={() => selectChoice(choice.id)}
        />
        <span>{choice.label}</span>
      </label>)}</div>
    </fieldset>
    {state.kind === "conflict" ? <p className="attempt-feedback error" role="alert">内容已更新，请确认选择后重新提交。</p> : null}
    {state.kind === "case_error" ? caseErrorCopy(state) : null}
    {state.kind === "error" ? errorCopy(state) : null}
    {state.kind === "case_error"
      ? <button type="button" onClick={() => { void refreshCase(); }}>重新加载</button>
      : <button type="button" onClick={() => { void submit(); }} disabled={disabled}>
        {state.kind === "loading_case" ? "正在加载最新内容" : state.kind === "submitting" ? "正在提交" : resultUnconfirmed ? "请先确认任务状态" : state.kind === "conflict" ? "确认后重新提交" : "提交本次选择"}
      </button>}
  </div>;
}
