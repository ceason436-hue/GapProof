import type { D1RetestTaskView, D7RetestTaskView, GuidedInterventionTaskView, TodayOverview } from "@gapproof/contracts";
import Link from "next/link";
import { AppShell } from "./app-shell";
import { D1AttemptPanel } from "./d1-attempt-panel";
import { D7AttemptPanel } from "./d7-attempt-panel";
import { GuidedTaskCompletion } from "./guided-task-completion";
import { ApiClientError } from "@/lib/api-client";
import { WebConfigurationError } from "@/lib/runtime-config";
import {
  formatTaskDateTime,
  TodayOverviewContractError,
  toTodayReadModel,
  type CurrentTaskSelection,
  type RetestTaskView,
} from "@/lib/today-adapter";
import { fetchDemoStudentToday } from "@/lib/today-server";

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

function activityLevel(completedTaskCount: number): string {
  return `activity-level-${Math.min(completedTaskCount, 3)}`;
}

const progressCopy: Record<TodayOverview["recentProgress"][number]["kind"], string> = {
  recognition_confirmed: "学习材料已确认",
  diagnosis_checked: "完成了一次学习检查",
  practice_completed: "完成了一次练习",
  d1_passed: "明日复习已完成，下一次复习已安排",
  d1_needs_followup: "这次检查后还需要再练习",
  plan_adjusted: "后续学习安排已更新",
};

function OverviewActivity({ overview }: { overview: TodayOverview }) {
  return <section className="overview-activity" aria-labelledby="activity-title">
    <h3 id="activity-title">本周学习足迹</h3>
    <div className="day-grid server-day-grid" role="list" aria-label="本周学习足迹">
      {overview.activityDays.map((day, index) => <span
        className={`${activityLevel(day.completedTaskCount)}${index === overview.activityDays.length - 1 ? " today" : ""}`}
        data-local-date={day.localDate}
        key={day.localDate}
        role="listitem"
        aria-label={`${day.localDate}，完成任务 ${day.completedTaskCount} 项`}
        title={`${day.localDate}：完成任务 ${day.completedTaskCount} 项`}
      />)}
    </div>
    <p>最右侧是今天；每天完成的任务越多，颜色越深。</p>
  </section>;
}

function OverviewGoal({ overview }: { overview: TodayOverview }) {
  return <section className="overview-goal" aria-labelledby="goal-title">
    <h3 id="goal-title">本周目标</h3>
    {overview.weeklyGoal
      ? <p data-weekly-goal>{overview.weeklyGoal.completedDays} / {overview.weeklyGoal.targetDays} 天</p>
      : <p data-weekly-goal="unset">目标待设置</p>}
    <span>{overview.weeklyGoal ? "继续保持本周节奏" : "完成第一次检查后即可设置目标"}</span>
  </section>;
}

function OverviewPending({ overview }: { overview: TodayOverview }) {
  const count = overview.pendingConfirmationCount;
  return <article className="lime-card overview-fact-card" data-pending-confirmations={count}>
    <div className="lime-heading"><h3>等你确认</h3></div>
    <p>{count > 0 ? `有 ${count} 项内容等你确认。` : "当前没有待确认事项。"}</p>
  </article>;
}

function OverviewProgress({ overview }: { overview: TodayOverview }) {
  return <article className="lime-card overview-fact-card" data-recent-progress-count={overview.recentProgress.length}>
    <div className="lime-heading"><h3>最近进展</h3></div>
    {overview.recentProgress.length
      ? <ul className="recent-progress-list">{overview.recentProgress.slice(0, 2).map(progress => <li key={progress.eventId}>{progressCopy[progress.kind]}</li>)}</ul>
      : <p>暂无新的学习进展。</p>}
  </article>;
}

export function TodayOverviewPanel({ overview }: { overview: TodayOverview }) {
  return <article className="live-panel overview-panel" data-today-overview>
    <h2>今日概览</h2>
    <div className="overview-summary"><OverviewActivity overview={overview}/><OverviewGoal overview={overview}/></div>
    <div className="overview-facts"><OverviewPending overview={overview}/><OverviewProgress overview={overview}/></div>
  </article>;
}

export function FirstUseToday() {
  return <AppShell actionHref="/diagnose" actionLabel="开始第一次检查"><section className="today-page" data-first-use-today>
    <div className="title-row"><div><h1>从一次小检查开始</h1><p>上传一页错题，或先用 3 道题找到适合你的起点。</p></div></div>
    <div className="onboarding-grid">
      <article className="onboarding-main"><span className="eyebrow">推荐路径</span><h2>三步完成第一次检查</h2><ol><li><span className="step-number">1</span><div><strong>选择开始方式</strong><span>上传错题，或先做 3 道快速练习题。</span></div></li><li><span className="step-number">2</span><div><strong>核对题目内容</strong><span>逐项检查题干，发现问题可以自己修改。</span></div></li><li><span className="step-number">3</span><div><strong>开始针对性练习</strong><span>完成检查后，继续今天的练习和后续巩固。</span></div></li></ol><div className="button-row"><Link className="primary-blue" href="/materials/new">上传错题或作业</Link><Link className="ghost-link" href="/diagnose/quick-check">没有材料，先做 3 道题</Link></div></article>
      <aside className="prepare-card"><h2>体验说明</h2><ul><li>上传后由你决定是否继续，不会自动建立学习记录。</li><li>当前上传流程使用演示识别内容，不会读取图片里的题目。</li><li>三题体验只显示本次结果，不保存为正式学习记录。</li></ul><p>请先遮盖姓名、学校和班级等不必要信息。</p></aside>
    </div>
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
  const button = retest.status === "scheduled"
    ? "尚未到期"
    : retest.status === "completed"
      ? "已完成（只读）"
      : retest.taskType === "d7_retest" ? "开始巩固" : "开始复习";

  return <article className="retest-card" data-task-status={retest.status} data-task-type={retest.taskType}>
    <header>
      <div><span className="task-kind">{cycle}</span><h3>{cycle}练习</h3></div>
      <span className="status-chip">{status}</span>
    </header>
    <TaskDates scheduledFor={retest.scheduledFor} dueAt={retest.dueAt} timeZone={timeZone}/>
    <p>{note} 预计约 {retest.estimatedMinutes} 分钟。</p>
    <button type="button" disabled aria-disabled="true">{button}</button>
  </article>;
}

function GuidedCurrent({ task, timeZone }: { task: GuidedInterventionTaskView; timeZone: string }) {
  return <article className="live-panel current-panel" data-current-task-type={task.taskType}>
    <span className="task-kind">今天的引导练习</span>
    <h2>完成今天的针对练习</h2>
    <p>按下面的步骤完成练习，做完后再安排下一次复习。</p>
    <TaskDates scheduledFor={task.scheduledFor} dueAt={task.dueAt} timeZone={timeZone}/>
    <p className="read-only-note">预计约 {task.estimatedMinutes} 分钟；完成后会安排下一次复习。</p>
    <GuidedTaskCompletion task={task} timeZone={timeZone}/>
  </article>;
}

function D1Current({ task, timeZone }: { task: D1RetestTaskView; timeZone: string }) {
  return <article className="live-panel current-panel" data-current-task-type={task.taskType}>
    <span className="task-kind">明日复习</span>
    <h2>明日复习题</h2>
    <p>{task.item.prompt}</p>
    <TaskDates scheduledFor={task.scheduledFor} dueAt={task.dueAt} timeZone={timeZone}/>
    <D1AttemptPanel task={task} timeZone={timeZone}/>
  </article>;
}

function D7Current({ task, timeZone }: { task: D7RetestTaskView; timeZone: string }) {
  return <article className="live-panel current-panel" data-current-task-type={task.taskType}>
    <span className="task-kind">7 天后巩固</span>
    <h2>7 天后巩固题</h2>
    <p>{task.item.prompt}</p>
    <TaskDates scheduledFor={task.scheduledFor} dueAt={task.dueAt} timeZone={timeZone}/>
    <D7AttemptPanel task={task}/>
  </article>;
}

function CurrentContractError({ current }: { current: Extract<CurrentTaskSelection, { kind: "contract_error" }> }) {
  const detail = current.code === "CURRENT_TASK_NOT_FOUND"
    ? "这项任务暂时找不到。"
    : current.code === "CURRENT_TASK_READ_ONLY"
      ? "这项巩固练习还没到开始时间。"
      : "这项任务的状态刚刚发生了变化。";
  return <article className="live-panel contract-error" data-current-contract-error={current.code}>
    <span className="task-kind">需要刷新</span>
    <h2>当前任务暂不可用</h2>
    <p>{detail} 请返回今日页刷新后再试。</p>
  </article>;
}

function CurrentPanel({ current, timeZone }: { current: CurrentTaskSelection; timeZone: string }) {
  if (current.kind === "none") {
    return <article className="live-panel" data-current-task="none">
      <span className="task-kind">今天的安排</span>
      <h2>当前没有待完成任务</h2>
      <p>可以休息一下，或开始一次新的检查。</p>
    </article>;
  }
  if (current.kind === "contract_error") return <CurrentContractError current={current}/>;
  if (current.task.taskType === "guided_intervention") return <GuidedCurrent task={current.task} timeZone={timeZone}/>;
  return current.task.taskType === "d1_retest"
    ? <D1Current task={current.task} timeZone={timeZone}/>
    : <D7Current task={current.task} timeZone={timeZone}/>;
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
  return <AppShell actionDisabled actionLabel="等待配置">
    <section className="today-page"><div className="title-row"><div><h1>{title}</h1><p>{detail}</p></div></div></section>
  </AppShell>;
}

export async function LiveToday() {
  try {
    const response = await fetchDemoStudentToday();
    const model = toTodayReadModel(response.data);
    if (!model.overview.hasStartedJourney) return <FirstUseToday/>;
    if (model.taskCount === 0 && model.current.kind === "none") return <AppShell actionHref="/diagnose" actionLabel="开始新的检查"><section className="today-page">
      <div className="title-row"><div><h1>今天的任务已完成</h1><p>做得不错。想继续时，可以开始一次新的检查。</p></div></div>
      <article className="state-card"><div><h2>今天先到这里</h2><p>已有记录会保留；需要时可以上传新材料，或先做 3 道快速检查题。</p><div className="button-row"><Link className="primary-blue" href="/diagnose">开始新的检查</Link><Link className="ghost-link" href="/student/progress">查看已有进展</Link></div></div></article>
      <TodayOverviewPanel overview={model.overview}/>
    </section></AppShell>;

    const actionLabel = model.current.kind === "selected"
      ? model.current.task.taskType === "guided_intervention" ? "完成今天的练习" : model.current.task.taskType === "d1_retest" ? "完成明日复习" : "完成巩固练习"
      : model.current.kind === "contract_error" ? "当前任务不可用" : "暂无当前任务";
    return <AppShell actionDisabled actionLabel={actionLabel}>
      <section className="today-page">
        <div className="title-row"><div><h1>今天从这一项开始</h1><p>按自己的节奏完成，做完后再看看下一次复习安排。</p></div></div>
        <div className="live-today-grid">
          <div className="live-main-column">
            <CurrentPanel current={model.current} timeZone={model.timeZone}/>
            <TodayOverviewPanel overview={model.overview}/>
          </div>
          <aside className="live-panel"><OverviewNextCheck nextCheck={model.overview.nextCheck} timeZone={model.timeZone}/><h2>后续复习</h2><p>到时间后，复习任务会出现在今天的学习安排里。</p><div className="retest-list">
            {model.retests.length
              ? model.retests.map(retest => <RetestCard key={retest.id} retest={retest} timeZone={model.timeZone}/>)
              : <div className="unavailable-row"><strong>还没有后续复习</strong><span>完成今天的练习后再来看看。</span></div>}
          </div></aside>
        </div>
      </section>
    </AppShell>;
  } catch (error) {
    return <LiveError error={error}/>;
  }
}
