"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiClientError } from "@/lib/api-client";
import { startMistakeReview } from "@/lib/mistake-review";

export function MistakeReviewStart({ studentId, entryRef }: { studentId: string; entryRef: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "starting" | "error">("idle");
  const start = async () => {
    if (state === "starting") return;
    setState("starting");
    try {
      const response = await startMistakeReview(studentId, entryRef);
      router.push(`/student/mistakes/${encodeURIComponent(response.data.id)}`);
    } catch (error) {
      setState("error");
      if (error instanceof ApiClientError && error.response.error.code === "RESOURCE_NOT_FOUND") router.refresh();
    }
  };
  return <div className="mistake-review-start"><button className="primary-blue" type="button" onClick={() => { void start(); }} disabled={state === "starting"}>{state === "starting" ? "正在准备复习" : "现在重做这道题"}</button>{state === "error" ? <p className="guided-task-feedback error" role="alert">暂时无法开始这次复习，请回到错题本刷新后再试。</p> : null}</div>;
}
