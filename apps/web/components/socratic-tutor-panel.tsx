"use client";

import type { GuidedInterventionTaskView, TutorTurnView } from "@gapproof/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import { ApiClientError } from "@/lib/api-client";
import { createBrowserUuidV7 } from "@/lib/browser-uuidv7";
import { getTutorSession, submitTutorTurn } from "@/lib/socratic-tutor";

type PanelState = "idle" | "sending" | "waiting" | "ready" | "error" | "limit";

function messageForError(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.response.error.code === "TASK_LIMIT_REACHED" || error.response.error.code === "DAILY_LIMIT_REACHED") return "今天的引导次数已经用完，先完成当前步骤，明天再继续。";
    if (error.response.error.code === "TURN_ALREADY_PENDING") return "上一条引导还在准备，请稍等片刻。";
    if (error.response.error.code === "VERSION_CONFLICT") return "任务内容已更新，请返回今日读取最新安排。";
  }
  return "这次没有收到引导。你的任务进度没有改变，可以稍后重试。";
}

export function SocraticTutorPanel({ task, expectedVersion }: { task: GuidedInterventionTaskView; expectedVersion: number | null }) {
  const firstStep = task.steps[0];
  const [stepId, setStepId] = useState(firstStep?.id ?? "");
  const [learnerText, setLearnerText] = useState("");
  const [state, setState] = useState<PanelState>("idle");
  const [turn, setTurn] = useState<TutorTurnView | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const selectedStep = useMemo(() => task.steps.find(step => step.id === stepId) ?? firstStep, [firstStep, stepId, task.steps]);

  useEffect(() => () => { if (pollTimer.current !== undefined) clearTimeout(pollTimer.current); }, []);

  async function readSession(attempt = 0) {
    try {
      const response = await getTutorSession(task.id);
      setTurn(response.data);
      if (response.data.status === "queued" || response.data.status === "running") {
        if (attempt < 20) { setState("waiting"); pollTimer.current = setTimeout(() => { void readSession(attempt + 1); }, 900); }
        else setState("error");
      } else if (response.data.status === "succeeded" || response.data.status === "fallback") setState("ready");
      else setState("error");
    } catch (error) {
      setState(error instanceof ApiClientError && ["TASK_LIMIT_REACHED", "DAILY_LIMIT_REACHED"].includes(error.response.error.code) ? "limit" : "error");
    }
  }

  async function submit() {
    if (!selectedStep || expectedVersion === null || learnerText.trim().length === 0 || state === "sending" || state === "waiting") return;
    setState("sending");
    try {
      const response = await submitTutorTurn(task.id, { expectedVersion, stepId: selectedStep.id, learnerText: learnerText.trim() }, createBrowserUuidV7());
      setTurn(response.data);
      if (response.data.status === "queued" || response.data.status === "running") { setState("waiting"); pollTimer.current = setTimeout(() => { void readSession(); }, 700); }
      else if (response.data.status === "succeeded" || response.data.status === "fallback") setState("ready");
      else setState("error");
    } catch (error) {
      setState(error instanceof ApiClientError && ["TASK_LIMIT_REACHED", "DAILY_LIMIT_REACHED"].includes(error.response.error.code) ? "limit" : "error");
    }
  }

  return <section className="socratic-tutor" aria-labelledby={`tutor-${task.id}`}>
    <div className="socratic-tutor-heading"><div><span className="task-kind">想一想</span><h3 id={`tutor-${task.id}`}>把你的思路说出来</h3></div><span className="socratic-tutor-count">每次只问一个问题</span></div>
    <p className="socratic-tutor-note">这是一道引导，不会直接告诉你答案，也不会改变任务完成状态。</p>
    <label className="socratic-tutor-step">正在思考： <select value={stepId} onChange={event => setStepId(event.target.value)} disabled={state === "sending" || state === "waiting"}>{task.steps.map(step => <option key={step.id} value={step.id}>{step.title}</option>)}</select></label>
    <textarea value={learnerText} onChange={event => setLearnerText(event.target.value.slice(0, 800))} maxLength={800} placeholder="例如：我先看到了哪个线索？" disabled={state === "sending" || state === "waiting"} aria-label="写下你的思路" />
    <div className="socratic-tutor-actions"><button type="button" className="secondary-button" onClick={() => void submit()} disabled={expectedVersion === null || learnerText.trim().length === 0 || state === "sending" || state === "waiting"}>{state === "sending" ? "正在发送" : state === "waiting" ? "正在准备引导" : "请导师引导我"}</button><span>{learnerText.length}/800</span></div>
    {state === "ready" && turn?.response ? <div className="socratic-tutor-response" role="status"><strong>{turn.response.question}</strong>{turn.response.hint ? <p>{turn.response.hint}</p> : null}</div> : null}
    {state === "waiting" ? <p className="socratic-tutor-status" role="status">正在准备一道只针对这一步的问题。</p> : null}
    {state === "limit" ? <p className="socratic-tutor-status" role="alert">今天的引导次数已用完，任务仍可继续完成。</p> : null}
    {state === "error" ? <div className="socratic-tutor-error" role="alert"><p>{messageForError(undefined)}</p><button type="button" className="ghost-link" onClick={() => void readSession()}>读取最新状态</button></div> : null}
  </section>;
}
