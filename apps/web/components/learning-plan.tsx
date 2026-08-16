import Link from "next/link";
import type { TodayTasksView } from "@gapproof/contracts";
import { AppShell } from "./app-shell";
import { Icon } from "./icons";
import { buildLearningPlan, planTaskLabel, planTaskStatus } from "@/lib/learning-plan";

const weekday = new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", month: "numeric", day: "numeric", weekday: "short" });

function DayLabel({ localDate }: { localDate: string }) {
  return <time dateTime={localDate}>{weekday.format(new Date(`${localDate}T12:00:00.000Z`))}</time>;
}

export function LearningPlan({ view, now = new Date() }: { view: TodayTasksView; now?: Date }) {
  const days = buildLearningPlan(view, now);
  const planned = days.flatMap(day => day.tasks);
  const totalMinutes = planned.reduce((sum, task) => sum + task.estimatedMinutes, 0);
  const completed = planned.filter(task => task.status === "completed").length;

  return <AppShell actionHref="/materials/new" actionLabel="添加学习材料">
    <section className="today-page learning-plan-page" data-learning-plan>
      <div className="title-row"><div><h1>7 日计划</h1><p>按实际已经安排的练习和复习，看看接下来七天要做什么。</p></div><div className="plan-summary"><strong>{planned.length}</strong><span>项已安排 · 约 {totalMinutes} 分钟</span></div></div>
      {planned.length === 0 ? <article className="state-card"><Icon name="plan"/><div><h2>还没有可安排的任务</h2><p>先完成一次正式检查。新的练习、次日复习和 7 天后巩固准备好后，会按日期出现在这里。</p><Link className="primary-blue" href="/diagnose">开始一次检查</Link></div></article> : <>
        <div className="plan-progress" aria-label={`本周已完成 ${completed} 项，共 ${planned.length} 项`}><span>已完成 {completed}/{planned.length}</span><div><i style={{ width: `${Math.round(completed / planned.length * 100)}%` }}/></div></div>
        <div className="plan-days">{days.map((day, index) => <section className={`plan-day ${index === 0 ? "today" : ""}`} key={day.localDate}>
          <header><DayLabel localDate={day.localDate}/><span>{index === 0 ? "今天" : day.tasks.length > 0 ? `${day.totalMinutes} 分钟` : "暂无安排"}</span></header>
          {day.tasks.length === 0 ? <p className="plan-day-empty">这一天暂时没有任务</p> : <div className="plan-task-list">{day.tasks.map(task => <article key={task.id} data-task-status={task.status}>
            <div><span className="task-kind">{planTaskLabel(task)}</span><h2>{task.title}</h2><p>{task.rationale}</p></div>
            <div className="plan-task-action"><span className={`status-chip ${task.status}`}>{planTaskStatus(task)}</span><Link href={`/student/mistakes/${encodeURIComponent(task.id)}`}>{task.status === "ready" ? "开始" : task.status === "completed" ? "回顾" : "查看"}<Icon name="arrow"/></Link></div>
          </article>)}</div>}
        </section>)}</div>
        <p className="mistake-truth-note">计划只显示已经写入学习记录的任务；安排会在复习结果需要调整时更新，不代表已经掌握。</p>
      </>}
    </section>
  </AppShell>;
}
