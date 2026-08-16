"use client";

import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/icons";

export default function AppError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <AppShell actionHref="/student/today" actionLabel="返回今日">
    <section className="today-page" aria-labelledby="app-error-title">
      <div className="title-row"><div>
        <h1 id="app-error-title">这个页面暂时没有加载成功</h1>
        <p>你的答案和学习状态不会因为这次显示问题自动改变。</p>
      </div></div>
      <article className="state-card">
        <Icon name="report"/>
        <div>
          <h2>可以重新读取一次</h2>
          <p>如果仍然无法打开，请先返回今日，稍后再继续当前任务。</p>
          <div className="button-row">
            <button className="primary-blue" type="button" onClick={() => retry()}>重新加载</button>
            <Link className="ghost-link" href="/student/today">返回今日</Link>
          </div>
        </div>
      </article>
    </section>
  </AppShell>;
}
