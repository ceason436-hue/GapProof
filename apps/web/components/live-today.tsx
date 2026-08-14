import { AppShell } from "./app-shell";
import { ApiClientError } from "@/lib/api-client";
import { WebConfigurationError } from "@/lib/runtime-config";
import { toTodayReadModel, type RetestReadModel } from "@/lib/today-adapter";
import { fetchDemoStudentToday } from "@/lib/today-server";

function formatScheduledFor(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function RetestCard({ retest }: { retest: RetestReadModel }) {
  const status = retest.status === "scheduled" ? "等待到期" : retest.status === "ready" ? "可以检查" : "已有完成记录";
  const note = retest.status === "ready"
    ? "服务端已将任务标记为可检查，但作答与评分契约尚未开放。"
    : retest.status === "scheduled"
      ? `计划时间：${formatScheduledFor(retest.scheduledFor)}`
      : "这里只展示服务端状态，不生成掌握结论。";
  return <article className="retest-card" data-task-status={retest.status}>
    <header><h3>{retest.title}</h3><span className="status-chip">{status}</span></header>
    <p>{note} 预计约 {retest.estimatedMinutes} 分钟。</p>
    <button type="button" disabled aria-disabled="true">检查功能即将开放</button>
  </article>;
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
  }
  return <AppShell actionDisabled actionLabel="等待配置">
    <section className="today-page"><div className="title-row"><div><span className="status-chip error">真实 API 模式</span><h1>{title}</h1><p>{detail}</p><div className="config-detail">{code}</div></div></div></section>
  </AppShell>;
}

export async function LiveToday() {
  try {
    const response = await fetchDemoStudentToday();
    const model = toTodayReadModel(response.data);
    if (model.taskCount === 0) {
      return <AppShell actionDisabled actionLabel="暂无当前任务"><section className="today-page"><div className="title-row"><div><span className="status-chip">真实 API 模式</span><h1>今天暂时没有任务</h1><p>服务端返回了空任务列表；页面没有使用 Mock 内容填充。</p></div></div><article className="state-card"><div><h2>这是服务端确认的空状态</h2><p>新的任务或检查由服务端创建后才会显示。</p></div></article></section></AppShell>;
    }
    return <AppShell actionDisabled actionLabel="等待当前任务">
      <section className="today-page">
        <div className="title-row"><div><span className="status-chip">真实 API 模式</span><h1>今日任务已安全同步</h1><p>当前契约尚未提供 currentTaskId，因此页面不会从任务数组猜测重点任务。</p></div></div>
        <div className="live-today-grid">
          <article className="live-panel"><h2>等待服务端指定当前任务</h2><p>已读取 {model.taskCount} 个任务。重点任务卡和固定开始入口会在共享契约提供 currentTaskId 后启用。</p><div className="unavailable-list"><div className="unavailable-row"><strong>本周学习足迹</strong><span>当前接口没有真实投影，未显示 Mock 数据。</span></div><div className="unavailable-row"><strong>周目标、待确认与最近进展</strong><span>当前接口没有真实投影，保持不可用态。</span></div></div></article>
          <aside className="live-panel"><h2>D+1 检查状态</h2><p>只读展示服务端状态，不提供提交入口。</p><div className="retest-list">{model.retests.length ? model.retests.map(retest => <RetestCard key={retest.id} retest={retest}/>) : <div className="unavailable-row"><strong>暂无 D+1 检查</strong><span>服务端创建后才会显示。</span></div>}</div></aside>
        </div>
      </section>
    </AppShell>;
  } catch (error) {
    return <LiveError error={error}/>;
  }
}
