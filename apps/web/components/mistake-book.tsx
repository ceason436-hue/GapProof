import type { LearningTaskView, QuestionArchiveItem, QuestionArchiveTaskFact } from "@gapproof/contracts";
import Link from "next/link";
import { ApiClientError } from "@/lib/api-client";
import { archiveTaskAction, selectArchiveTask, taskKindLabel } from "@/lib/mistake-book";
import { fetchCurrentStudentQuestionArchive, fetchCurrentStudentQuestionArchiveItem } from "@/lib/question-archive-server";
import { fetchCurrentStudentTask } from "@/lib/student-task-server";
import { StudentSessionRequiredError } from "@/lib/student-session-server";
import { getCurrentStudentSession } from "@/lib/student-session-server";
import { formatTaskDateTime } from "@/lib/today-adapter";
import { AppShell } from "./app-shell";
import { D1AttemptPanel } from "./d1-attempt-panel";
import { D7AttemptPanel } from "./d7-attempt-panel";
import { GuidedTaskCompletion } from "./guided-task-completion";
import { MistakeReviewStart } from "./mistake-review-start";
import { MistakeReviewTask } from "./mistake-review-task";
import { MistakeBookBrowser } from "./mistake-book-browser";
import { Icon } from "./icons";
import { StudentSessionBootstrap } from "./student-session-bootstrap";
import { ReadOnlyTutorHistory } from "./socratic-tutor-panel";

function statusCopy(status: QuestionArchiveTaskFact["status"] | LearningTaskView["status"]) {
  if (status === "ready") return "可以继续";
  if (status === "completed") return "已有完成记录";
  return "等待复习";
}

function ErrorState({ missing = false }: { missing?: boolean }) {
  return <AppShell actionHref="/student/today?source=api" actionLabel="返回今日"><section className="mistake-book-page"><div className="title-row"><div><h1>{missing ? "没有找到这道错题" : "暂时没能读取错题本"}</h1><p>{missing ? "这道题可能已更新，或不属于当前设备上的学习记录。" : "已有记录不会受到影响，请稍后重试。"}</p></div></div><Link className="primary-blue" href="/student/mistakes">返回错题本</Link></section></AppShell>;
}

function EmptyBook() {
  return <section className="mistake-book-empty"><Icon name="report"/><div><h2>还没有已确认的错题</h2><p>上传学习材料并核对识别内容后，确认过的题目会保存在这里。</p><Link className="primary-blue" href="/materials/new">上传学习材料</Link></div></section>;
}

function Answer({ value }: { value: string | null }) {
  return <p className={value === null ? "archive-answer missing" : "archive-answer"}><strong>当时的作答</strong><span>{value ?? "确认时没有填写作答"}</span></p>;
}

function TaskSummary({ task, timeZone }: { task: QuestionArchiveTaskFact; timeZone: string }) {
  const time = task.completedAt ?? task.dueAt ?? task.scheduledFor;
  return <div className="archive-task-summary"><span className={`status-chip ${task.status}`}>{statusCopy(task.status)}</span><span>{taskKindLabel(task)} · {formatTaskDateTime(time, timeZone)}</span></div>;
}

export async function MistakeBook() {
  try {
    const response = await fetchCurrentStudentQuestionArchive();
    const { items, timeZone, totalCount, matchedCount, nextCursor } = response.data;
    const { session } = await getCurrentStudentSession();
    return <AppShell actionHref="/materials/new" actionLabel="添加错题"><section className="mistake-book-page" data-question-archive><div className="title-row"><div><h1>错题本</h1><p>这里收录你亲自核对过的上传题目，以及同一份材料下已有的练习和复习记录。</p></div><div className="mistake-book-count"><strong>{totalCount}</strong><span>道已确认题目</span></div></div>{totalCount === 0 ? <EmptyBook/> : <MistakeBookBrowser studentId={session.studentId} initialItems={items} initialTotalCount={totalCount} initialMatchedCount={matchedCount} initialNextCursor={nextCursor} timeZone={timeZone}/>}</section></AppShell>;
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) return <StudentSessionBootstrap/>;
    return <ErrorState/>;
  }
}

function ArchiveTaskFacts({ item, timeZone }: { item: QuestionArchiveItem; timeZone: string }) {
  if (item.tasks.length === 0) return <section className="archive-task-facts"><h2>同一份材料的练习与复习</h2><p>这份材料还没有后续任务。你可以回到今日页查看诊断是否仍在进行。</p><Link className="secondary-button" href="/student/today?source=api">返回今日</Link></section>;
  return <section className="archive-task-facts"><h2>同一份材料的练习与复习</h2><div>{item.tasks.map(task => <article key={task.taskId}><div><strong>{task.title}</strong><TaskSummary task={task} timeZone={timeZone}/></div><Link href={`/student/tasks/${encodeURIComponent(task.taskId)}`}>{archiveTaskAction(task)}<Icon name="arrow"/></Link></article>)}</div><p>这些是同一份上传材料下的任务记录，不代表每项任务只对应这一道题。作答与完成状态由服务端记录决定，查看错题不会自动标记完成。</p></section>;
}

export async function QuestionArchiveDetail({ entryRef }: { entryRef: string }) {
  try {
    const response = await fetchCurrentStudentQuestionArchiveItem(entryRef);
    const item = response.data.item;
    const { session } = await getCurrentStudentSession();
    return <AppShell actionHref="/student/mistakes" actionLabel="返回错题本"><section className="mistake-task-page archive-detail" data-question-archive-detail><Link className="back-link" href="/student/mistakes">← 返回错题本</Link><header><span className="task-kind">你已确认 · {item.sourceTitle}</span><h1>{item.prompt}</h1><p>确认于 {formatTaskDateTime(item.confirmedAt, response.data.timeZone)}</p></header><article className="mistake-task-panel"><h2>题目记录</h2><div className="archive-question"><strong>题干</strong><p>{item.prompt}</p></div><div className="archive-question"><strong>当时的作答</strong><p>{item.studentAnswer ?? "确认时没有填写作答"}</p></div><p className="mistake-truth-note">这里只展示你确认后的题目文字与已有任务事实，不展示答案键或系统内部判断。</p>{item.reviewReady ? <MistakeReviewStart studentId={session.studentId} entryRef={item.entryRef}/> : <p className="mistake-truth-note">完成这份材料的诊断后，就可以从这里重新做这道题。</p>}</article><ArchiveTaskFacts item={item} timeZone={response.data.timeZone}/></section></AppShell>;
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) return <StudentSessionBootstrap/>;
    if (error instanceof ApiClientError && error.response.error.code === "RESOURCE_NOT_FOUND") return <ErrorState missing/>;
    return <ErrorState/>;
  }
}

function TaskContent({ task, timeZone }: { task: LearningTaskView; timeZone: string }) {
  if (task.status === "ready") {
    if (task.taskType === "guided_intervention") return <GuidedTaskCompletion task={task} timeZone={timeZone}/>;
    if (task.taskType === "mistake_review") return <MistakeReviewTask task={task}/>;
    if (task.taskType === "d1_retest") return <D1AttemptPanel task={task} timeZone={timeZone}/>;
    return <D7AttemptPanel task={task}/>;
  }
  if (task.taskType === "mistake_review") return <MistakeReviewTask task={task}/>;
  if (task.taskType === "guided_intervention") return <><ol className="mistake-review-steps">{task.steps.map(step => <li key={step.id}><strong>{step.title}</strong><span>{step.content}</span></li>)}</ol><ReadOnlyTutorHistory taskId={task.id}/></>;
  const resultCopy = task.attemptSummary?.result === "passed"
    ? "这次新题检查已通过"
    : task.attemptSummary?.result === "support_required"
      ? "这次检查后需要老师或家长协助"
      : task.attemptSummary ? "这次检查后还需要继续巩固" : null;
  return <div className="mistake-review-question"><h2>{task.item.prompt}</h2><ul>{task.item.choices.map(choice => <li key={choice.id}>{choice.label}</li>)}</ul>{task.attemptSummary ? <div className="task-attempt-summary"><p><strong>你当时选择：</strong>{task.attemptSummary.selectedChoiceLabel}</p><p><strong>本次记录：</strong>{resultCopy}</p><p><strong>完成时间：</strong>{formatTaskDateTime(task.attemptSummary.evaluatedAt, timeZone)}</p></div> : <p>当前记录没有可展示的历史作答摘要，不补充答案或学习结论。</p>}</div>;
}

export async function StudentTask({ taskId }: { taskId: string }) {
  try {
    const { task, timeZone } = await fetchCurrentStudentTask(taskId);
    const returnHref = task.taskType === "mistake_review" ? "/student/mistakes" : "/student/today?source=api";
    const returnLabel = task.taskType === "mistake_review" ? "返回错题本" : "返回今日";
    return <AppShell actionHref={returnHref} actionLabel={returnLabel}><section className="mistake-task-page" data-student-task={task.id}><Link className="back-link" href={returnHref}>← {returnLabel}</Link><header><span className="task-kind">{taskKindLabel(task)} · {statusCopy(task.status)}</span><h1>{task.title}</h1><p>{task.rationale}</p></header><article className="mistake-task-panel"><TaskContent task={task} timeZone={timeZone}/></article>{task.status === "completed" ? <p className="mistake-truth-note">这项任务已有完成记录。当前页面只供回顾，不会重复写入结果或改变学习进度。</p> : task.status === "scheduled" ? <p className="mistake-truth-note">还没到复习时间。到期后这里会开放作答。</p> : null}</section></AppShell>;
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) return <StudentSessionBootstrap/>;
    if (error instanceof ApiClientError && error.response.error.code === "RESOURCE_NOT_FOUND") return <ErrorState missing/>;
    return <ErrorState/>;
  }
}
