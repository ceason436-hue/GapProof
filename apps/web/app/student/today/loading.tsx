import { AppShell } from "@/components/app-shell";

export default function TodayLoading() {
  return <AppShell actionDisabled actionLabel="正在读取"><section aria-busy="true" aria-label="正在加载今日安排" className="today-page"><div className="title-row"><div><div className="skeleton sk-title"/><div className="skeleton sk-line"/></div></div><div className="today-grid"><div><div className="skeleton sk-hero"/><div className="skeleton sk-overview"/></div><aside><div className="skeleton sk-side"/><div className="skeleton sk-side"/></aside></div><p className="loading-note">正在读取服务端今日安排；不会使用 Mock 数据回退。</p></section></AppShell>;
}
