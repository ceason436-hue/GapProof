import type { D1RetestTaskView, GuidedInterventionTaskView } from "@gapproof/contracts";
import { AppShell } from "./app-shell";
import { D1AttemptPanel } from "./d1-attempt-panel";
import { ApiClientError } from "@/lib/api-client";
import { WebConfigurationError } from "@/lib/runtime-config";
import {
  formatTaskDateTime,
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

export function RetestCard({
  retest,
  timeZone,
}: {
  retest: RetestTaskView;
  timeZone: string;
}) {
  const cycle = retest.taskType === "d1_retest" ? "D+1" : "D+7";
  const status = retest.status === "scheduled"
    ? "等待到期"
    : retest.status === "ready"
      ? retest.taskType === "d7_retest" ? "只读待接入" : "可以检查"
      : "已有完成记录";
  const note = retest.status === "scheduled"
    ? "等待服务端按学生时区激活。"
    : retest.status === "completed"
      ? "这里只展示服务端完成状态，不生成掌握结论。"
      : retest.taskType === "d1_retest"
        ? "作答接入下一阶段，本轮不提交或评分。"
        : "D+7 attempts 尚未实现，本轮保持只读。";
  const button = retest.status === "scheduled"
    ? "尚未到期"
    : retest.status === "completed"
      ? "已完成（只读）"
      : retest.taskType === "d1_retest"
        ? "作答接入下一阶段"
        : "D+7 检查只读";

  return <article className="retest-card" data-task-status={retest.status} data-task-type={retest.taskType}>
    <header>
      <div><span className="task-kind">{cycle} 检查</span><h3>{retest.title}</h3></div>
      <span className="status-chip">{status}</span>
    </header>
    <TaskDates scheduledFor={retest.scheduledFor} dueAt={retest.dueAt} timeZone={timeZone}/>
    <p>{note} 预计约 {retest.estimatedMinutes} 分钟。</p>
    <button type="button" disabled aria-disabled="true">{button}</button>
  </article>;
}

function GuidedCurrent({ task, timeZone }: { task: GuidedInterventionTaskView; timeZone: string }) {
  return <article className="live-panel current-panel" data-current-task-type={task.taskType}>
    <span className="task-kind">服务端当前任务 · 引导干预</span>
    <h2>{task.title}</h2>
    <p>{task.rationale}</p>
    <TaskDates scheduledFor={task.scheduledFor} dueAt={task.dueAt} timeZone={timeZone}/>
    <ol className="guided-steps">{task.steps.map(step => <li key={step.id}>
      <strong>{step.title}</strong><span>{step.content}</span>
    </li>)}</ol>
    <p className="read-only-note">预计约 {task.estimatedMinutes} 分钟；F1b 仅展示，不改变任务状态。</p>
    <button type="button" disabled aria-disabled="true">引导任务只读</button>
  </article>;
}

function D1Current({ task, timeZone }: { task: D1RetestTaskView; timeZone: string }) {
  return <article className="live-panel current-panel" data-current-task-type={task.taskType}>
    <span className="task-kind">服务端当前任务 · D+1 检查</span>
    <h2>{task.title}</h2>
    <p>{task.item.prompt}</p>
    <TaskDates scheduledFor={task.scheduledFor} dueAt={task.dueAt} timeZone={timeZone}/>
    <D1AttemptPanel task={task} timeZone={timeZone}/>
  </article>;
}

function CurrentContractError({ current }: { current: Extract<CurrentTaskSelection, { kind: "contract_error" }> }) {
  const detail = current.code === "CURRENT_TASK_NOT_FOUND"
    ? "currentTaskId 没有对应任务。"
    : current.code === "CURRENT_TASK_READ_ONLY"
      ? "currentTaskId 指向当前只读的 D+7 任务。"
      : "currentTaskId 指向 scheduled 或 completed 任务。";
  return <article className="live-panel contract-error" data-current-contract-error={current.code}>
    <span className="task-kind">受控契约错误</span>
    <h2>当前任务暂不可用</h2>
    <p>{detail} 页面不会从其他任务中选择替代项。</p>
    <div className="config-detail">{current.code}</div>
  </article>;
}

function CurrentPanel({ current, timeZone }: { current: CurrentTaskSelection; timeZone: string }) {
  if (current.kind === "none") {
    return <article className="live-panel" data-current-task="none">
      <span className="task-kind">服务端 currentTaskId = null</span>
      <h2>当前没有可行动任务</h2>
      <p>页面保留 scheduled 与历史任务的只读信息，不自行选择重点任务。</p>
    </article>;
  }
  if (current.kind === "contract_error") return <CurrentContractError current={current}/>;
  return current.task.taskType === "guided_intervention"
    ? <GuidedCurrent task={current.task} timeZone={timeZone}/>
    : <D1Current task={current.task} timeZone={timeZone}/>;
}

function LiveError({ error }: { error: unknown }) {
  let title = "暂时没能读取今日安排";
  let detail = "没有使用 Mock 数据回退，也没有改变任何学习记录。";
  let code = "TODAY_FETCH_FAILED";
  if (error instanceof WebConfigurationError) {
    title = error.code.includes("MISSING") ? "真实 Today 尚未配置" : "真实 Today 配置无效";
    detail = "请在服务端配置有效的 API Origin 与 Demo 学生 UUID；系统不会自动选择假学生。";
    code = error.code;
  } else if (error instanceof ApiClientError) {
    title = error.response.error.code === "RESOURCE_NOT_FOUND" ? "没有找到这个 Demo 学生" : title;
    code = error.response.error.code;
  } else if (error instanceof RangeError) {
    title = "学生时区无法用于日期显示";
    detail = "页面拒绝回退到浏览器、服务器或固定时区，请修正服务端学生时区。";
    code = "TODAY_TIME_ZONE_INVALID";
  }
  return <AppShell actionDisabled actionLabel="等待配置">
    <section className="today-page"><div className="title-row"><div><span className="status-chip error">真实 API 模式</span><h1>{title}</h1><p>{detail}</p><div className="config-detail">{code}</div></div></div></section>
  </AppShell>;
}

export async function LiveToday() {
  try {
    const response = await fetchDemoStudentToday();
    const model = toTodayReadModel(response.data);
    if (model.taskCount === 0 && model.current.kind === "none") {
      return <AppShell actionDisabled actionLabel="暂无当前任务"><section className="today-page">
        <div className="title-row"><div><span className="status-chip">真实 API 模式</span><h1>今天暂时没有任务</h1><p>服务端返回空任务列表；页面没有使用 Mock 内容填充。</p></div></div>
        <article className="state-card"><div><h2>这是服务端确认的空状态</h2><p>新的任务或检查由服务端创建后才会显示。</p></div></article>
      </section></AppShell>;
    }

    const actionLabel = model.current.kind === "selected"
      ? model.current.task.taskType === "guided_intervention" ? "引导任务只读" : "D+1 检查"
      : model.current.kind === "contract_error" ? "当前任务不可用" : "暂无当前任务";
    return <AppShell actionDisabled actionLabel={actionLabel}>
      <section className="today-page">
        <div className="title-row"><div><span className="status-chip">真实 API 模式</span><h1>今日任务已安全同步</h1><p>所有日期按学生时区 {model.timeZone} 显示；当前任务只采用服务端 currentTaskId。</p></div></div>
        <div className="live-today-grid">
          <div className="live-main-column">
            <CurrentPanel current={model.current} timeZone={model.timeZone}/>
            <article className="live-panel unavailable-panel"><h2>尚无真实首页投影</h2><div className="unavailable-list">
              <div className="unavailable-row"><strong>本周学习足迹</strong><span>当前接口没有真实投影，未显示 Mock 数据。</span></div>
              <div className="unavailable-row"><strong>周目标、待确认与最近进展</strong><span>当前接口没有真实投影，保持不可用态。</span></div>
            </div></article>
          </div>
          <aside className="live-panel"><h2>D+1 / D+7 检查状态</h2><p>ready D1 可在当前任务区作答；D+7 仍只读。默认入口仍为 Mock。</p><div className="retest-list">
            {model.retests.length
              ? model.retests.map(retest => <RetestCard key={retest.id} retest={retest} timeZone={model.timeZone}/>)
              : <div className="unavailable-row"><strong>暂无延迟检查</strong><span>服务端创建后才会显示。</span></div>}
          </div></aside>
        </div>
      </section>
    </AppShell>;
  } catch (error) {
    return <LiveError error={error}/>;
  }
}
