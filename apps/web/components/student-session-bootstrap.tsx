"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { createBrowserUuidV7 } from "@/lib/browser-uuidv7";
import { AppShell } from "./app-shell";
import { Icon } from "./icons";

export function StudentSessionBootstrap() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "creating" | "error">("idle");
  const keyRef = useRef(createBrowserUuidV7());

  async function start() {
    if (state === "creating") return;
    setState("creating");
    try {
      const response = await fetch("/api/v1/device-session", {
        method: "POST",
        headers: { Accept: "application/json", "Idempotency-Key": keyRef.current },
      });
      if (!response.ok) throw new Error("SESSION_CREATE_FAILED");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  useEffect(() => { void start(); }, []);

  return <AppShell actionDisabled actionLabel="准备学习空间">
    <section className="today-page" aria-labelledby="session-title">
      <div className="title-row"><div>
        <h1 id="session-title">先准备你的学习空间</h1>
        <p>这台设备会保存你的学习进度，不需要填写姓名或联系方式。</p>
      </div></div>
      <article className="state-card">
        <Icon name="today"/>
        <div>
          <h2>{state === "error" ? "暂时没有准备好" : "从这台设备开始"}</h2>
          <p>{state === "error" ? "请检查网络后重试。系统没有创建学习记录。" : "开始后先确认年级、学科、学期、地区和目前的学习状态。"}</p>
          <button className="primary-blue" type="button" onClick={() => void start()} disabled={state === "creating"}>
            {state === "creating" ? "正在准备" : state === "error" ? "重新准备" : "开始使用"}
          </button>
        </div>
      </article>
    </section>
  </AppShell>;
}
