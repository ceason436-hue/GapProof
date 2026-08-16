"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { createBrowserUuidV7 } from "@/lib/browser-uuidv7";
import { AppShell } from "./app-shell";
import { Icon } from "./icons";

export function StudentSessionBootstrap() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "creating" | "recovering" | "error" | "unknown">("idle");
  const keyRef = useRef(createBrowserUuidV7());

  async function recoverLatest() {
    setState("recovering");
    try {
      const response = await fetch("/api/v1/device-session", { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" });
      if (response.ok) {
        router.refresh();
        return;
      }
      setState(response.status === 401 ? "error" : "unknown");
    } catch {
      setState("unknown");
    }
  }

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
      await recoverLatest();
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
          <h2>{state === "error" || state === "unknown" ? "暂时没有准备好" : "从这台设备开始"}</h2>
          <p>{state === "error"
            ? "最新状态显示学习空间还没有准备好。请检查网络后重新准备。"
            : state === "unknown"
              ? "暂时无法确认是否已经准备完成。先读取最新状态，不会重复创建。"
              : "开始后先确认年级、学科、学期、地区和目前的学习状态。"}</p>
          {state === "unknown"
            ? <button className="primary-blue" type="button" onClick={() => void recoverLatest()}>读取最新状态</button>
            : <button className="primary-blue" type="button" onClick={() => void start()} disabled={state === "creating" || state === "recovering"}>
              {state === "creating" ? "正在准备" : state === "recovering" ? "正在读取" : state === "error" ? "重新准备" : "开始使用"}
            </button>}
        </div>
      </article>
    </section>
  </AppShell>;
}
