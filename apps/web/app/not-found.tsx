import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/icons";

export default function NotFound() {
  return <AppShell actionHref="/student/today" actionLabel="返回今日">
    <section className="today-page" aria-labelledby="not-found-title">
      <div className="title-row"><div>
        <h1 id="not-found-title">没有找到这个页面</h1>
        <p>它可能已经移动，或者当前学习任务还没有准备好。</p>
      </div></div>
      <article className="state-card">
        <Icon name="search"/>
        <div>
          <h2>从今日安排继续</h2>
          <p>今日页会显示你现在可以完成的任务和需要继续核对的内容。</p>
          <div className="button-row">
            <Link className="primary-blue" href="/student/today">查看今日安排</Link>
            <Link className="ghost-link" href="/diagnose">开始新的检查</Link>
          </div>
        </div>
      </article>
    </section>
  </AppShell>;
}
