"use client";

import { SyntheticQuickCheckResultSchema, SyntheticQuickCheckViewSchema, type SubmitSyntheticQuickCheckRequest, type SyntheticQuickCheckResult, type SyntheticQuickCheckView } from "@gapproof/contracts";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/api-client";
import { createBrowserUuidV7 } from "@/lib/browser-uuidv7";

const findingLabels: Record<SyntheticQuickCheckResult["finding"], string> = {
  irregular_participle: "不规则过去分词", past_tense: "一般过去时", passive_voice: "被动语态", mixed_review: "混合复习",
};

export function SyntheticQuickCheck() {
  const submittingRef = useRef(false);
  const [view, setView] = useState<SyntheticQuickCheckView | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<SyntheticQuickCheckResult | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "submitting" | "success" | "error" | "network_unknown">("loading");
  const [message, setMessage] = useState("正在准备题目……");

  useEffect(() => {
    const controller = new AbortController();
    void apiGet("/api/v1/quick-checks/synthetic", SyntheticQuickCheckViewSchema, controller.signal).then(response => {
      setView(response.data); setState("ready"); setMessage("选择每题答案后再提交；提交前不会评分。");
    }).catch(error => {
      if (controller.signal.aborted) return;
      setState(error instanceof TypeError ? "network_unknown" : "error");
      setMessage(error instanceof TypeError ? "题目读取结果未知，请确认网络后刷新页面。" : "暂时无法读取快速诊断题，请稍后再试。");
    });
    return () => controller.abort("PAGE_LEFT");
  }, []);

  const isComplete = view?.questions.every(question => Boolean(answers[question.itemId])) ?? false;
  const submit = async () => {
    if (!view || !isComplete || submittingRef.current || state === "success" || state === "network_unknown") return;
    submittingRef.current = true;
    const body: SubmitSyntheticQuickCheckRequest = { answers: view.questions.map(question => ({ itemId: question.itemId, selectedChoiceId: answers[question.itemId]! })) };
    const idempotencyKey = createBrowserUuidV7();
    setState("submitting"); setMessage("正在检查本次作答……");
    try {
      const response = await apiPost("/api/v1/quick-checks/synthetic/attempts", SyntheticQuickCheckResultSchema, body, idempotencyKey);
      setResult(response.data); setState("success"); setMessage("本次作答已检查完成。体验结果不会写入学习记录，也不会生成报告。");
    } catch (error) {
      if (error instanceof TypeError) { setState("network_unknown"); setMessage("暂时无法确认是否提交成功。为避免重复操作，请重新进入快速检查后查看。"); }
      else { submittingRef.current = false; setState("error"); setMessage("这次检查没有完成，你可以确认答案后重新提交。"); }
    }
  };

  return <section className="quick-check-panel" aria-labelledby="quick-check-title">
    <div className="synthetic-demo-banner"><strong>快速体验</strong><span>3 道原创练习题 · 结果不会保存为正式学习记录</span></div>
    <header><span className="eyebrow">约 3 分钟</span><h1 id="quick-check-title">先做 3 道题，看看从哪里开始</h1><p>结果只反映这三道题的作答情况，不代表已经掌握，也不用于评价真实学习效果。</p></header>
    {view ? <form onSubmit={event => { event.preventDefault(); void submit(); }}>{view.questions.map((question, index) => <fieldset key={question.itemId} disabled={state === "submitting" || state === "success" || state === "network_unknown"}><legend><span>{index + 1}</span>{question.prompt}</legend><div className="quick-check-choices">{question.choices.map(choice => <label key={choice.id}><input type="radio" name={question.itemId} value={choice.id} checked={answers[question.itemId] === choice.id} onChange={() => setAnswers(current => ({ ...current, [question.itemId]: choice.id }))}/><span>{choice.label}</span></label>)}</div></fieldset>)}<button className="primary-blue" type="submit" disabled={!isComplete || state === "submitting" || state === "success" || state === "network_unknown"}>{state === "submitting" ? "正在评分" : state === "success" ? "已完成" : "提交 3 道题"}</button></form> : null}
    <p className={`quick-check-live ${state === "error" || state === "network_unknown" ? "error" : ""}`} aria-live={state === "error" || state === "network_unknown" ? "assertive" : "polite"} role={state === "error" || state === "network_unknown" ? "alert" : undefined} data-quick-check-state={state}>{message}</p>
    {result ? <article className="quick-check-result" data-quick-check-result><span className="status-chip">本次作答</span><h2>{result.correctCount} / {result.totalCount} 题正确</h2><p><strong>建议先复习：</strong>{findingLabels[result.finding]}</p><p>可以从这个知识点开始回顾，再用自己的错题做一次更完整的检查。</p><small>体验结果不会保存为正式学习记录，也不会生成报告。</small></article> : null}
    <div className="quick-check-links"><Link className="secondary-button" href="/materials/new">改为上传材料</Link><Link className="ghost-link" href="/student/today">返回今日</Link></div>
  </section>;
}
