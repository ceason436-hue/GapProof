import Image from "next/image";
import Link from "next/link";
import logo from "../../../reference/stitch_gapproof_ai/logo.png";
import { Icon } from "./icons";

const items = [
  ["today", "今日", "/student/today"], ["search", "找原因", "/materials/new"],
  ["plan", "7 日计划", "#"], ["progress", "我的进步", "#"], ["report", "学习报告", "#"],
] as const;

export function AppShell({ children, actionHref = "/materials/demo/review", actionLabel = "开始学习" }: { children: React.ReactNode; actionHref?: string; actionLabel?: string }) {
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-crop"><Image src={logo} alt="知隙 GapProof" priority className="brand-source" /></div>
      <nav className="top-tabs" aria-label="案例导航"><button type="button" className="top-tab active">当前案例</button><button type="button" className="top-tab">学生切换</button></nav>
      <div className="top-actions"><button type="button" className="role-label">学生 / 家长</button><button className="role-button" type="button">角色切换</button><span className="avatar" aria-label="当前用户">知</span></div>
    </header>
    <aside className="sidebar" aria-label="学生主导航">
      <nav>{items.map(([icon, label, href], index) => <Link key={label} href={href} className={`nav-item ${index === 0 ? "active" : ""}`} aria-current={index === 0 ? "page" : undefined}><Icon name={icon}/><span>{label}</span></Link>)}</nav>
      <Link className="fixed-action" href={actionHref}>{actionLabel}</Link>
    </aside>
    <details className="mobile-menu"><summary aria-label="打开学生导航"><Icon name="menu"/></summary><nav>{items.map(([_, label, href]) => <Link key={label} href={href}>{label}</Link>)}</nav></details>
    <main className="content">{children}</main>
  </div>;
}
