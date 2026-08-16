"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiClientError } from "@/lib/api-client";
import { startMistakeReview } from "@/lib/mistake-review";

export function MistakeReviewStart({ studentId, entryRef }: { studentId: string; entryRef: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "starting" | "error" | "unknown">("idle");
  const start = async () => {
    if (state === "starting") return;
    setState("starting");
    try {
      const response = await startMistakeReview(studentId, entryRef);
      router.push(`/student/tasks/${encodeURIComponent(response.data.id)}`);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setState("error");
        if (error.response.error.code === "RESOURCE_NOT_FOUND") router.refresh();
      } else {
        setState("unknown");
      }
    }
  };
  return <div className="mistake-review-start">{state === "unknown" ? <><p className="guided-task-feedback error" role="alert">暂时无法确认是否已经开始。为避免重复操作，请回到错题本读取最新状态。</p><Link className="primary-blue" href="/student/mistakes">返回错题本</Link></> : <button className="primary-blue" type="button" onClick={() => { void start(); }} disabled={state === "starting"}>{state === "starting" ? "正在准备复习" : "现在重做这道题"}</button>}{state === "error" ? <p className="guided-task-feedback error" role="alert">暂时无法开始这次复习，请回到错题本刷新后再试。</p> : null}</div>;
}
