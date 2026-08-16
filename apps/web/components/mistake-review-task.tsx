"use client";

import type { MistakeReviewTaskView } from "@gapproof/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiClientError } from "@/lib/api-client";
import { completeMistakeReview, createMistakeReviewResponseRequest } from "@/lib/mistake-review";

export function MistakeReviewTask({ task }: { task: MistakeReviewTaskView }) {
  const router = useRouter();
  const [responseText, setResponseText] = useState(task.submittedResponse ?? "");
  const [state, setState] = useState<"idle" | "submitting" | "success" | "error">(task.status === "completed" ? "success" : "idle");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const completed = task.status === "completed" || state === "success";
  const submit = async () => {
    if (completed || state === "submitting") return;
    const body = createMistakeReviewResponseRequest(responseText);
    if (!body) { setErrorCode("INVALID_INPUT"); setState("error"); return; }
    setState("submitting"); setErrorCode(null);
    try {
      await completeMistakeReview(task.id, body);
      setState("success");
      router.refresh();
    } catch (error) {
      setState("error");
      setErrorCode(error instanceof ApiClientError ? error.response.error.code : "NETWORK_UNKNOWN");
    }
  };
  if (completed) {
    const recordedResponse = task.submittedResponse ?? responseText.trim();
    return <article className="guided-task-result" data-mistake-review-result="completed" aria-live="polite">
    <span className="task-kind">这次复习已记录</span>
    <h3>你已经写下了自己的思路</h3>
    {recordedResponse ? <p>你的记录：{recordedResponse}</p> : null}
    <p>可以回到错题本，对照原来的作答继续整理。记录本身不代表已经掌握。</p>
    <div className="guided-task-result-actions">
      <Link className="primary-blue" href="/student/mistakes">返回错题本</Link>
      <Link className="secondary-button" href="/student/today?source=api">查看今日安排</Link>
    </div>
  </article>;
  }
  return <div className="guided-task-panel" data-mistake-review-state={state}>
    <p className="guided-task-note">先独立想一遍，再写下你的判断。这里不会直接告诉你答案。</p>
    <article className="mistake-review-question"><h2>{task.prompt}</h2>{task.originalAnswer ? <p>你当时的作答：{task.originalAnswer}</p> : null}</article>
    <label className="mistake-review-response"><span>{task.reflectionPrompt}</span><textarea value={responseText} onChange={event => setResponseText(event.target.value)} disabled={state === "submitting"} rows={6} maxLength={4000} /></label>
    {state === "error" ? <p className="guided-task-feedback error" role="alert">{errorCode === "INVALID_INPUT" ? "请先写下你的想法，再完成这次复习。" : errorCode === "INVALID_TASK_STATE" ? "这项复习已经更新，请回到错题本查看。" : "暂时无法记录这次复习，请稍后再试。"}</p> : null}
    <button className="guided-task-submit" type="button" onClick={() => { void submit(); }} disabled={state === "submitting" || responseText.trim().length === 0}>{state === "submitting" ? "正在记录" : "完成这次复习"}</button>
  </div>;
}
