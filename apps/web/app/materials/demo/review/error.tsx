"use client";

import Link from "next/link";
import { AppShell } from "@/components/app-shell";

export default function DemoReviewError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <AppShell actionHref="/student/today" actionLabel="返回今日">
    <section className="demo-review-page" aria-labelledby="demo-review-error-title">
      <div className="demo-review-banner" role="note"><strong>演示识别 · 合成材料 · 不是真实学生数据</strong><span>预置识别结果 / 演示回退</span></div>
      <article className="demo-review-state demo-review-state-error" data-review-state="error">
        <span className="demo-review-state-label">演示内容暂时不可用</span>
        <h1 id="demo-review-error-title">当前演示内容无法显示</h1>
        <p role="alert">没有写入任何记录。请重新打开演示，或返回今日。</p>
        <div className="demo-review-links"><button className="demo-review-primary" type="button" onClick={() => reset()}>重新打开演示</button><Link className="ghost-link" href="/student/today">返回今日</Link></div>
      </article>
    </section>
  </AppShell>;
}
