import type { D1RetestTaskView, D7RetestTaskView, GuidedInterventionTaskView, MistakeReviewTaskView, RecoverableOcrBatchView, StudentProfileView, TodayOverview } from "@gapproof/contracts";
import Link from "next/link";
import { AppShell } from "./app-shell";
import { D1AttemptPanel } from "./d1-attempt-panel";
import { D7AttemptPanel } from "./d7-attempt-panel";
import { GuidedTaskCompletion } from "./guided-task-completion";
import { Icon } from "./icons";
import { ApiClientError } from "@/lib/api-client";
import { WebConfigurationError } from "@/lib/runtime-config";
import {
  formatTaskDateTime,
  TodayOverviewContractError,
  toTodayReadModel,
  type CurrentTaskSelection,
  type RetestTaskView,
} from "@/lib/today-adapter";
import { fetchCurrentStudentToday } from "@/lib/today-server";
import { StudentSessionRequiredError } from "@/lib/student-session-server";
import { StudentSessionBootstrap } from "./student-session-bootstrap";
import { OcrBatchRecovery } from "./ocr-batch-recovery";
import { fetchRecoverableOcrBatches } from "@/lib/ocr-recovery-server";
import { StudentProfileSetup } from "./student-profile-setup";
import { MistakeReviewTask } from "./mistake-review-task";

function TaskDates({
  scheduledFor,
  dueAt,
  timeZone,
}: Pick<RetestTaskView, "scheduledFor" | "dueAt"> & { timeZone: string }) {
  return <div className="task-dates">
    <span>计划：{formatTaskDateTime(scheduledFor, timeZone)}</span>
    {dueAt ? <span>截止：{formatTaskDateTime(dueAt, timeZone)}</span> : null}
  </div>;
}

const progressCopy: Record<TodayOverview["recentProgress"][number]["kind"], string> = {
  recognition_confirmed: "学习材料已确认",
  diagnosis_checked: "完成了一次学习检查",
  practice_completed: "完成了一次练习",
  d1_passed: "明日复习已完成，下一次复习已安排",
  d1_needs_followup: "这次检查后还需要再练习",
  plan_adjusted: "后续学习安排已更新",
};

export function TodayFootprint({ overview }: { overview: TodayOverview }) {
  const activeDays = overview.activityDays.filter(day => day.completedTaskCount > 0).length;
  return <section className="footprint overview-activity" aria-labelledby="activity-title">
    <h2 id="activity-title">本周学习足迹</h2>
    <div className="day-grid server-day-grid" role="list" aria-label="本周学习足迹">
      {overview.activityDays.map((day, index) => <span
        className={`${day.completedTaskCount > 0 ? "done" : ""}${index === overview.activityDays.length - 1 ? " today" : ""}`}
        data-local-date={day.localDate}
        key={day.localDate}
        role="listitem"
        aria-label={`${day.localDate}，完成任务 ${day.completedTaskCount} 项`}
        title={`${day.localDate}：完成任务 ${day.completedTaskCount} 项`}
      >{index === overview.activityDays.length - 1 ? <i>今日</i> : null}</span>)}
    </div>
    <p data-active-days={activeDays}>近 7 天有 {activeDays} 天完成任务</p>
  </section>;
}

function OverviewPending({ overview }: { overview: TodayOverview }) {
  const count = overview.pendingConfirmationCount;
  return <article className="lime-card overview-fact-card" data-pending-confirmations={count}>
    <div className="lime-content"><div className="lime-heading"><Icon name="alert"/><h3>等你确认</h3></div>
      <p>{count > 0 ? `有 ${count} 项内容等你确认。` : "当前没有待确认事项。"}</p>
    </div>
    <Icon name="check" className="card-art"/>
  </article>;
}

function OverviewProgress({ overview }: { overview: TodayOverview }) {
  return <article className="lime-card overview-fact-card" data-recent-progress-count={overview.recentProgress.length}>
    <div className="lime-content"><div className="lime-heading"><Icon name="progress"/><h3>最近进展</h3></div>
      {overview.recentProgress.length
        ? <ul className="recent-progress-list">{overview.recentProgress.slice(0, 2).map(progress => <li key={progress.eventId}>{progressCopy[progress.kind]}</li>)}</ul>
        : <p>暂无新的学习进展。</p>}
    </div>
    <Icon name="progress" className="card-art"/>
  </article>;
}

export function TodayOverviewPanel({ overview }: { overview: TodayOverview }) {
  return <section className="overview overview-panel" data-today-overview>
    <h2>今日概览</h2>
    <div className="overview-grid overview-facts"><OverviewPending overview={overview}/><OverviewProgress overview={overview}/></div>
  </section>;
}

export function FirstUseToday({ recoverableBatches = [] }: { recoverableBatches?: readonly RecoverableOcrBatchView[] }) {
  return <AppShell actionHref="/diagnose" actionLabel="开始第一次检查"><section className="today-page" data-first-use-today>
    <div className="title-row"><div><h1>从一次小检查开始</h1><p>上传一张或多张错题、作业图片，或先用 3 道题找到适合你的起点。</p></div></div>
    <OcrBatchRecovery batches={recoverableBatches}/>
    <div className="onboarding-grid">
      <article className="onboarding-main"><span className="eyebrow">推荐路径</span><h2>三步完成第一次检查</h2><ol><li><span className="step-number">1</span><div><strong>选择开始方式</strong><span>上传错题，或先做 3 道快速练习题。</span></div></li><li><span className="step-number">2</span><div><strong>核对题目内容</strong><span>逐项检查题干，发现问题可以自己修改。</span></div></li><li><span className="step-number">3</span><div><strong>开始针对性练习</strong><span>完成检查后，继续今天的练习和后续巩固。</span></div></li></ol><div className="button-row"><Link className="primary-blue" href="/materials/new">上传错题或作业</Link><Link className="ghost-link" href="/diagnose/quick-check">没有材料，先做 3 道题</Link></div></article>
      <aside className="prepare-card"><h2>开始前说明</h2><ul><li>上传后由你决定是否继续，不会自动建立学习结论。</li><li>图片通过检查并由你确认后，才会发送给识别服务。</li><li>三题体验只显示本次结果，不保存为正式学习记录。</li></ul><p>请先遮盖姓名、学校和班级等不必要信息。</p></aside>
    </div>
  </section></AppShell>;
}

export function ProfileSetupRequired({ profile, recoverableBatches = [] }: { profile: StudentProfileView; recoverableBatches?: readonly RecoverableOcrBatchView[] }) {
  return <AppShell actionDisabled actionLabel="完成学习范围后开始"><section className="today-page profile-setup-today" data-profile-setup-required>
    <OcrBatchRecovery batches={recoverableBatches}/>
    <StudentProfileSetup profile={profile} variant="today"/>
  </section></AppShell>;
}

export function OverviewNextCheck({ nextCheck, timeZone }: { nextCheck: TodayOverview["nextCheck"]; timeZone: string }) {
  if (!nextCheck) return <section className="next-check" data-next-check="none"><header><span>下次检查</span><strong>尚未安排</strong></header><p>暂无已安排检查。</p></section>;
  const cycle = nextCheck.taskType === "d7_retest" ? "7 天后巩固" : "明日复习";
  return <section className="next-check" data-next-check={nextCheck.taskType}>
    <header><span>下次检查 · {cycle}</span><strong>{formatTaskDateTime(nextCheck.scheduledFor, timeZone)}</strong></header>
    <div><h2>{cycle}练习</h2><p>预计时长：约 {nextCheck.estimatedMinutes} 分钟</p>{nextCheck.dueAt ? <p>截止：{formatTaskDateTime(nextCheck.dueAt, timeZone)}</p> : null}</div>
    <button type="button" disabled>到时间后开始</button>
    <small>完成后会更新你的学习足迹。</small>
  </section>;
}

export function RetestCard({
  retest,
  timeZone,
}: {
  retest: RetestTaskView;
  timeZone: string;
}) {
  const cycle = retest.taskType === "d1_retest" ? "明日复习" : "7 天后巩固";
  const status = retest.status === "scheduled"
    ? "等待到期"
    : retest.status === "ready"
      ? "可以开始"
      : "已有完成记录";
  const note = retest.status === "scheduled"
    ? "还没到开始时间。"
    : retest.status === "completed"
      ? "这次复习已经完成。"
      : "现在可以作答，完成后会保存本次结果。";
  const actionLabel = retest.taskType === "d7_retest" ? "开始巩固" : "开始复习";

  return <article className="retest-card" data-task-status={retest.status} data-task-type={retest.taskType}>
    <header>
      <div><span className="task-kind">{cycle}</span><h3>{cycle}练习</h3></div>
      <span className="status-chip">{status}</span>
    </header>
    <TaskDates scheduledFor={retest.scheduledFor} dueAt={retest.dueAt} timeZone={timeZone}/>
    <p>{note} 预计约 {retest.estimatedMinutes} 分钟。</p>
    {retest.status === "ready"
      ? <Link className="retest-action" href={`/student/today?source=api&task=${encodeURIComponent(retest.id)}`}>{actionLabel}</Link>
      : null}
  </article>;
}

function GuidedCurrent({ task, timeZone }: { task: GuidedInterventionTaskView; timeZone: string }) {
  return <article className="hero-card live-task-hero" data-current-task-type={task.taskType}>
    <HeroArt/><span className="time-chip"><Icon name="clock"/> 预计 {task.estimatedMinutes} 分钟</span>
    <div className="hero-content">
      <div className="task-label-row"><span className="dark-chip"><i/> 今天的引导练习</span></div>
      <h2>{task.title}</h2>
      <p>{task.rationale}</p>
      <TaskDates scheduledFor={task.scheduledFor} dueAt={task.dueAt} timeZone={timeZone}/>
      <p className="read-only-note">逐项完成并提交后，将根据本次记录安排后续复习。</p>
      <GuidedTaskCompletion task={task} timeZone={timeZone}/>
    </div>
  </article>;
}

function D1Current({ task, timeZone }: { task: D1RetestTaskView; timeZone: string }) {
  return <article className="hero-card live-task-hero" data-current-task-type={task.taskType}>
    <HeroArt/><span className="time-chip"><Icon name="clock"/> 预计 {task.estimatedMinutes} 分钟</span>
    <div className="hero-content">
      <div className="task-label-row"><span className="dark-chip"><i/> 明日复习</span></div>
      <h2>{task.title}</h2>
      <p>{task.item.prompt}</p>
      <TaskDates scheduledFor={task.scheduledFor} dueAt={task.dueAt} timeZone={timeZone}/>
      <D1AttemptPanel task={task} timeZone={timeZone}/>
    </div>
  </article>;
}

function D7Current({ task, timeZone }: { task: D7RetestTaskView; timeZone: string }) {
  return <article className="hero-card live-task-hero" data-current-task-type={task.taskType}>
    <HeroArt/><span className="time-chip"><Icon name="clock"/> 预计 {task.estimatedMinutes} 分钟</span>
    <div className="hero-content">
      <div className="task-label-row"><span className="dark-chip"><i/> 7 天后巩固</span></div>
      <h2>{task.title}</h2>
      <p>{task.item.prompt}</p>
      <TaskDates scheduledFor={task.scheduledFor} dueAt={task.dueAt} timeZone={timeZone}/>
      <D7AttemptPanel task={task}/>
    </div>
  </article>;
}

function MistakeReviewCurrent({ task }: { task: MistakeReviewTaskView }) {
  return <article className="hero-card live-task-hero" data-current-task-type={task.taskType}>
    <HeroArt/><span className="time-chip"><Icon name="clock"/> 预计 {task.estimatedMinutes} 分钟</span>
    <div className="hero-content">
      <div className="task-label-row"><span className="dark-chip"><i/> 错题重做</span></div>
      <h2>{task.title}</h2>
      <p>{task.rationale}</p>
      <MistakeReviewTask task={task}/>
    </div>
  </article>;
}

function HeroArt() {
  return <svg className="book-art" aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>;
}

function CurrentContractError({ current }: { current: Extract<CurrentTaskSelection, { kind: "contract_error" }> }) {
  const detail = current.code === "CURRENT_TASK_NOT_FOUND"
    ? "这项任务暂时找不到。"
    : current.code === "CURRENT_TASK_READ_ONLY"
      ? "这项巩固练习还没到开始时间。"
      : "这项任务的状态刚刚发生了变化。";
  return <article className="hero-card live-task-hero contract-error" data-current-contract-error={current.code}>
    <HeroArt/><div className="hero-content">
      <div className="task-label-row"><span className="dark-chip"><i/> 需要刷新</span></div>
      <h2>当前任务暂不可用</h2>
      <p>{detail} 请刷新今日安排后再试。</p>
      <div className="cta-row"><Link className="lime-button" href="/student/today?source=api">刷新今日安排 <Icon name="arrow"/></Link></div>
    </div>
  </article>;
}

function CurrentPanel({ current, timeZone, completed }: { current: CurrentTaskSelection; timeZone: string; completed: boolean }) {
  if (current.kind === "none") {
    return <article className="hero-card live-task-hero" data-current-task="none" data-completed-today={completed ? "true" : "false"}>
      <HeroArt/><div className="hero-content">
        <div className="task-label-row"><span className="dark-chip"><i/> 今天的安排</span></div>
        <h2>{completed ? "今天先到这里" : "当前没有待完成任务"}</h2>
        <p>{completed ? "已有记录会保留；想继续时，可以开始一次新的检查。" : "已安排的后续复习会在到达开始时间后出现在这里。"}</p>
        {completed ? <div className="cta-row"><Link className="lime-button" href="/diagnose">开始新的检查 <Icon name="arrow"/></Link><Link className="hero-secondary-link" href="/student/progress">查看已有进展</Link></div> : null}
      </div>
    </article>;
  }
  if (current.kind === "contract_error") return <CurrentContractError current={current}/>;
  if (current.task.taskType === "guided_intervention") return <GuidedCurrent task={current.task} timeZone={timeZone}/>;
  if (current.task.taskType === "mistake_review") return <MistakeReviewCurrent task={current.task}/>;
  return current.task.taskType === "d1_retest"
    ? <D1Current task={current.task} timeZone={timeZone}/>
    : <D7Current task={current.task} timeZone={timeZone}/>;
}

function TodayDateSummary({ overview }: { overview: TodayOverview }) {
  const today = overview.activityDays[overview.activityDays.length - 1];
  if (!today) return null;
  const [, month = "", day = ""] = today.localDate.split("-");
  return <div className="date-summary" data-today-local-date={today.localDate}>
    <strong>{Number(month)} 月 {Number(day)} 日</strong>
    <span>{overview.weeklyGoal
      ? `本周目标 ${overview.weeklyGoal.completedDays} / ${overview.weeklyGoal.targetDays} 天`
      : "本周目标待设置"}</span>
  </div>;
}

export function selectLaterRetests(retests: RetestTaskView[], currentTaskId: string | null) {
  return retests.filter(retest => retest.id !== currentTaskId);
}

function ContinueTasks({ retests, timeZone, currentTaskId }: { retests: RetestTaskView[]; timeZone: string; currentTaskId: string | null }) {
  const laterRetests = selectLaterRetests(retests, currentTaskId);
  return <section className="continue" aria-labelledby="continue-title">
    <h2 id="continue-title">稍后继续</h2>
    <div className="continue-list">
      {laterRetests.length
        ? laterRetests.map(retest => <RetestCard key={retest.id} retest={retest} timeZone={timeZone}/>)
        : <div className="unavailable-row"><strong>还没有后续复习</strong><span>完成今天的练习后再来看看。</span></div>}
    </div>
  </section>;
}

export function TodayDashboard({
  current,
  overview,
  retests,
  timeZone,
  completed,
  recoverableBatches = [],
}: {
  current: CurrentTaskSelection;
  overview: TodayOverview;
  retests: RetestTaskView[];
  timeZone: string;
  completed: boolean;
  recoverableBatches?: readonly RecoverableOcrBatchView[];
}) {
  const heading = completed
    ? "今天的任务已完成"
    : current.kind === "selected"
      ? `今天先完成：${current.task.title}`
      : current.kind === "contract_error"
        ? "今天的安排需要刷新"
        : "今天暂时没有待完成任务";
  const summary = completed
    ? "今天没有待做任务；新的检查或复习安排好后会出现在这里。"
    : "按自己的节奏完成，再看看后续复习安排。";
  const currentTaskId = current.kind === "selected" ? current.task.id : null;

  return <section className="today-page" data-live-today-dashboard>
    <div className="title-row"><div><h1>{heading}</h1><p>{summary}</p></div><TodayDateSummary overview={overview}/></div>
    <OcrBatchRecovery batches={recoverableBatches}/>
    <div className="today-grid">
      <div className="main-column">
        <CurrentPanel current={current} timeZone={timeZone} completed={completed}/>
        <TodayOverviewPanel overview={overview}/>
      </div>
      <aside className="right-column">
        <TodayFootprint overview={overview}/>
        <ContinueTasks retests={retests} timeZone={timeZone} currentTaskId={currentTaskId}/>
        <OverviewNextCheck nextCheck={overview.nextCheck} timeZone={timeZone}/>
      </aside>
    </div>
  </section>;
}

function LiveError({ error }: { error: unknown }) {
  let title = "暂时没能读取今日安排";
  let detail = "请检查网络后重试，你已有的学习记录不会受到影响。";
  if (error instanceof WebConfigurationError) {
    title = "今日安排暂时不可用";
    detail = "演示环境还没有准备好，请稍后再试。";
  } else if (error instanceof ApiClientError) {
    title = error.response.error.code === "RESOURCE_NOT_FOUND" ? "暂时没有找到学习档案" : title;
  } else if (error instanceof RangeError) {
    title = "学生时区无法用于日期显示";
    detail = "日期显示暂时出现问题，请稍后再试。";
  } else if (error instanceof TodayOverviewContractError) {
    title = "今日概览暂不可用";
    detail = "学习概览还没有准备好，请稍后刷新。";
  }
  return <AppShell actionHref="/student/today?source=api" actionLabel="重新读取">
    <section className="today-page"><div className="title-row"><div><h1>{title}</h1><p>{detail}</p><Link className="primary-blue" href="/student/today?source=api">重新读取今日安排</Link></div></div></section>
  </AppShell>;
}

export async function LiveToday({ selectedRetestId }: { selectedRetestId?: string } = {}) {
  try {
    const [response, recoveryResponse] = await Promise.all([fetchCurrentStudentToday(), fetchRecoverableOcrBatches()]);
    const recoverableBatches = recoveryResponse.data.batches;
    const model = toTodayReadModel(response.data, selectedRetestId);
    if (!model.profile.completed) return <ProfileSetupRequired profile={model.profile} recoverableBatches={recoverableBatches}/>;
    if (!model.overview.hasStartedJourney) return <FirstUseToday recoverableBatches={recoverableBatches}/>;
    const completed = model.taskCount === 0 && model.current.kind === "none";
    if (completed) return <AppShell actionHref="/diagnose" actionLabel="开始新的检查"><TodayDashboard
      current={model.current}
      overview={model.overview}
      retests={model.retests}
      timeZone={model.timeZone}
      completed
      recoverableBatches={recoverableBatches}
    /></AppShell>;

    const actionLabel = model.current.kind === "selected"
      ? model.current.task.taskType === "guided_intervention" ? "完成今天的练习" : model.current.task.taskType === "d1_retest" ? "完成明日复习" : model.current.task.taskType === "d7_retest" ? "完成巩固练习" : "完成错题重做"
      : model.current.kind === "contract_error" ? "当前任务不可用" : "暂无当前任务";
    return <AppShell actionDisabled actionLabel={actionLabel}>
      <TodayDashboard current={model.current} overview={model.overview} retests={model.retests} timeZone={model.timeZone} completed={false} recoverableBatches={recoverableBatches}/>
    </AppShell>;
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) return <StudentSessionBootstrap/>;
    return <LiveError error={error}/>;
  }
}
