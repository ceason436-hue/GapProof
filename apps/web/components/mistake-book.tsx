import type { LearningTaskView } from "@gapproof/contracts";
import Link from "next/link";
import { ApiClientError } from "@/lib/api-client";
import { fetchCurrentStudentToday } from "@/lib/today-server";
import { StudentSessionRequiredError } from "@/lib/student-session-server";
import { findMistakeBookEntry, taskKindLabel, toMistakeBookEntries } from "@/lib/mistake-book";
import { formatTaskDateTime } from "@/lib/today-adapter";
import { AppShell } from "./app-shell";
import { D1AttemptPanel } from "./d1-attempt-panel";
import { D7AttemptPanel } from "./d7-attempt-panel";
import { GuidedTaskCompletion } from "./guided-task-completion";
import { Icon } from "./icons";
import { StudentSessionBootstrap } from "./student-session-bootstrap";

function statusCopy(status: LearningTaskView["status"]) {
  if (status === "ready") return "可以重做";
  if (status === "completed") return "已完成";
  return "等待复习";
}

function ErrorState({ missing = false }: { missing?: boolean }) {
  return <AppShell actionHref="/student/today?source=api" actionLabel="返回今日"><section className="mistake-book-page"><div className="title-row"><div><h1>{missing ? "没有找到这项学习记录" : "暂时没能读取错题本"}</h1><p>{missing ? "这项内容可能已更新，请返回错题本查看最新记录。" : "已有记录不会受到影响，请稍后重试。"}</p></div></div><Link className="primary-blue" href="/student/mistakes">返回错题本</Link></section></AppShell>;
}

function EmptyBook() {
  return <section className="mistake-book-empty"><Icon name="report"/><div><h2>还没有可以回顾的内容</h2><p>完成第一次学习检查后，针对练习和后续复习会保存在这里。</p><Link className="primary-blue" href="/diagnose">开始一次检查</Link></div></section>;
}

export async function MistakeBook() {
  try {
    const response = await fetchCurrentStudentToday();
    const entries = toMistakeBookEntries(response.data);
    return <AppShell actionHref="/materials/new" actionLabel="添加错题"><section className="mistake-book-page" data-mistake-book><div className="title-row"><div><h1>错题本</h1><p>回顾已经完成的练习，或继续到期的复习任务。</p></div><div className="mistake-book-count"><strong>{entries.length}</strong><span>项学习记录</span></div></div>{entries.length === 0 ? <EmptyBook/> : <div className="mistake-book-list">{entries.map(({ task, action }) => <article className="mistake-entry" key={task.id} data-task-status={task.status}><div className="mistake-entry-main"><span className="task-kind">{taskKindLabel(task)}</span><h2>{task.title}</h2><p>{task.rationale}</p><span className="mistake-date">{task.completedAt ? `完成于 ${formatTaskDateTime(task.completedAt, response.data.timeZone)}` : `安排于 ${formatTaskDateTime(task.scheduledFor, response.data.timeZone)}`}</span></div><div className="mistake-entry-action"><span className={`status-chip ${task.status}`}>{statusCopy(task.status)}</span><Link href={`/student/mistakes/${encodeURIComponent(task.id)}`}>{action === "practice" ? "开始重做" : action === "review" ? "回顾内容" : "查看安排"}<Icon name="arrow"/></Link></div></article>)}</div>}</section></AppShell>;
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) return <StudentSessionBootstrap/>;
    return <ErrorState/>;
  }
}

function TaskContent({ task, timeZone }: { task: LearningTaskView; timeZone: string }) {
  if (task.status === "ready") {
    if (task.taskType === "guided_intervention") return <GuidedTaskCompletion task={task} timeZone={timeZone}/>;
    if (task.taskType === "d1_retest") return <D1AttemptPanel task={task} timeZone={timeZone}/>;
    return <D7AttemptPanel task={task}/>;
  }
  if (task.taskType === "guided_intervention") return <ol className="mistake-review-steps">{task.steps.map(step => <li key={step.id}><strong>{step.title}</strong><span>{step.content}</span></li>)}</ol>;
  return <div className="mistake-review-question"><h2>{task.item.prompt}</h2><ul>{task.item.choices.map(choice => <li key={choice.id}>{choice.label}</li>)}</ul><p>这里只展示已有的题目内容，不补充未确认的答案或学习结论。</p></div>;
}

export async function MistakeBookTask({ taskId }: { taskId: string }) {
  try {
    const response = await fetchCurrentStudentToday();
    const entry = findMistakeBookEntry(response.data, taskId);
    if (!entry) return <ErrorState missing/>;
    const { task } = entry;
    return <AppShell actionHref="/student/mistakes" actionLabel="返回错题本"><section className="mistake-task-page" data-mistake-task={task.id}><Link className="back-link" href="/student/mistakes">← 返回错题本</Link><header><span className="task-kind">{taskKindLabel(task)} · {statusCopy(task.status)}</span><h1>{task.title}</h1><p>{task.rationale}</p></header><article className="mistake-task-panel"><TaskContent task={task} timeZone={response.data.timeZone}/></article>{task.status === "completed" ? <p className="mistake-truth-note">这项任务已有完成记录。当前页面只供回顾，不会重复写入成绩或改变学习进度。</p> : task.status === "scheduled" ? <p className="mistake-truth-note">还没到复习时间。到期后这里会开放作答。</p> : null}</section></AppShell>;
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) return <StudentSessionBootstrap/>;
    if (error instanceof ApiClientError && error.response.error.code === "RESOURCE_NOT_FOUND") return <ErrorState missing/>;
    return <ErrorState/>;
  }
}
