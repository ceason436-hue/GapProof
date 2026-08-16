import type { LearningRecordSource, ProgressStage, ProgressTimelineKind, StudentFactReportsView, StudentProgressView } from "@gapproof/contracts";
import Link from "next/link";

import { fetchCurrentStudentProgress, fetchCurrentStudentReports } from "@/lib/progress-report-server";
import { StudentSessionRequiredError } from "@/lib/student-session-server";
import { formatTaskDateTime } from "@/lib/today-adapter";
import { AppShell } from "./app-shell";
import { Icon } from "./icons";
import { StudentSessionBootstrap } from "./student-session-bootstrap";

const stageCopy: Record<ProgressStage, { label: string; next: string }> = {
  collecting: { label: "正在整理材料", next: "确认材料后继续检查" },
  checking: { label: "正在检查", next: "完成当前确认小题" },
  practicing: { label: "正在练习", next: "完成当前针对练习" },
  retesting: { label: "等待后续检查", next: "按安排完成下一次新题" },
  needs_follow_up: { label: "需要再确认", next: "继续下一次调整或检查" },
  repair_verified: { label: "已有修复验证证据", next: "可以在报告中回看现有记录" },
  support_required: { label: "需要协助", next: "请老师或家长一起看看" },
};

const timelineCopy: Record<ProgressTimelineKind, string> = {
  material_confirmed: "已确认学习材料",
  diagnosis_checked: "已完成一次原因检查",
  practice_completed: "已完成一次针对练习",
  d1_passed: "次日新题检查通过",
  d1_needs_follow_up: "次日检查后需要继续巩固",
  d7_passed: "第 7 天新题检查通过",
  d7_needs_follow_up: "第 7 天检查后需要继续巩固",
  plan_adjusted: "学习安排已根据记录调整",
};

function SourceNote({ source }: { source: LearningRecordSource }) {
  return source === "synthetic_experience"
    ? <span className="record-source synthetic">体验内容 · 合成材料</span>
    : <span className="record-source real">上传材料记录</span>;
}

function ReadError({ title }: { title: string }) {
  return <AppShell actionHref="/student/today?source=api" actionLabel="返回今日"><section className="progress-report-page"><div className="title-row"><div><h1>{title}</h1><p>暂时没能读取记录，已有内容不会受到影响。</p></div></div><article className="progress-report-empty"><Icon name="report"/><div><h2>请稍后再试</h2><p>可以先返回今日任务，稍后重新打开本页。</p><Link className="primary-blue" href="/student/today?source=api">返回今日</Link></div></article></section></AppShell>;
}

function ProgressView({ view }: { view: StudentProgressView }) {
  if (view.goals.length === 0) return <article className="progress-report-empty"><Icon name="progress"/><div><h2>还没有正式学习记录</h2><p>完成第一次材料确认和学习检查后，这里会按事实显示当前目标与后续安排。</p><Link className="primary-blue" href="/materials/new">添加学习材料</Link></div></article>;
  return <div className="progress-layout"><section aria-labelledby="current-progress"><h2 id="current-progress">当前进展</h2><div className="progress-goal-list">{view.goals.map(goal => <article className="progress-goal" key={goal.caseId}><header><SourceNote source={goal.source}/><span>{stageCopy[goal.stage].label}</span></header><h3>{goal.title}</h3><dl><div><dt>已有任务记录</dt><dd>{goal.completedTaskCount} 项完成</dd></div><div><dt>下一步</dt><dd>{goal.nextTask ? `${goal.nextTask.status === "ready" ? "现在可以完成" : "已安排"}：${goal.nextTask.title}` : stageCopy[goal.stage].next}</dd></div></dl>{goal.nextTask ? <p className="record-time">{formatTaskDateTime(goal.nextTask.scheduledFor, view.timeZone)}</p> : null}</article>)}</div></section><section aria-labelledby="learning-timeline"><h2 id="learning-timeline">学习记录</h2>{view.timeline.length === 0 ? <p className="timeline-empty">还没有可展示的状态变化。</p> : <ol className="fact-timeline">{view.timeline.map(entry => <li key={entry.eventId}><i/><div><strong>{timelineCopy[entry.kind]}</strong><span>{formatTaskDateTime(entry.occurredAt, view.timeZone)}</span><SourceNote source={entry.source}/></div></li>)}</ol>}</section></div>;
}

export async function StudentProgress() {
  try {
    const response = await fetchCurrentStudentProgress();
    return <AppShell actionHref="/materials/new" actionLabel="添加学习材料"><section className="progress-report-page"><div className="title-row"><div><h1>我的进步</h1><p>这里只显示已经发生的学习记录和接下来的安排，不用分数猜测你的能力。</p></div><div className="progress-count"><strong>{response.data.goals.length}</strong><span>个当前目标</span></div></div><ProgressView view={response.data}/></section></AppShell>;
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) return <StudentSessionBootstrap/>;
    return <ReadError title="我的进步"/>;
  }
}

function resultCopy(value: StudentFactReportsView["reports"][number]["d1Result"], label: string) {
  if (value === "passed") return `${label}：新题检查通过`;
  if (value === "needs_follow_up") return `${label}：需要继续巩固`;
  return `${label}：还没有记录`;
}

export async function StudentReports() {
  try {
    const response = await fetchCurrentStudentReports();
    const { reports, timeZone } = response.data;
    return <AppShell actionHref="/student/progress" actionLabel="查看我的进步"><section className="progress-report-page"><div className="title-row"><div><h1>学习报告</h1><p>这些是已有权威状态与复习证据的事实摘要，不代表永久掌握或整体学习效果。</p></div><div className="progress-count"><strong>{reports.length}</strong><span>份事实摘要</span></div></div>{reports.length === 0 ? <article className="progress-report-empty"><Icon name="report"/><div><h2>还没有可以形成摘要的记录</h2><p>只有完成后续检查并形成“已有修复验证证据”或“需要协助”的权威状态后，才会出现在这里。</p><Link className="primary-blue" href="/student/today?source=api">查看今日任务</Link></div></article> : <div className="fact-report-list">{reports.map(report => <article className="fact-report" key={report.caseId}><header><SourceNote source={report.source}/><span className={`report-conclusion ${report.conclusion}`}>{report.conclusion === "repair_verified" ? "已有修复验证证据" : "需要协助"}</span></header><h2>{report.title}</h2><ul><li>{resultCopy(report.d1Result, "次日检查")}</li><li>{resultCopy(report.d7Result, "第 7 天检查")}</li><li>已完成 {report.completedTaskCount} 项相关任务</li></ul><p>记录更新至 {formatTaskDateTime(report.evidenceThrough, timeZone)}</p>{report.source === "synthetic_experience" ? <small>本摘要来自合成体验 Case，仅说明体验流程中的记录，不是现实材料诊断或真实学习效果。</small> : <small>本摘要只复述已保存的任务和检查状态，不推断永久掌握。</small>}</article>)}</div>}</section></AppShell>;
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) return <StudentSessionBootstrap/>;
    return <ReadError title="学习报告"/>;
  }
}
