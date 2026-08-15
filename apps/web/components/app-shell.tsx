"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import logo from "../../../reference/stitch_gapproof_ai/logo.png";
import { Icon } from "./icons";

const items = [
  ["today", "今日", "/student/today"], ["search", "找原因", "/diagnose"],
  ["plan", "7 日计划", "/student/plan"], ["progress", "我的进步", "/student/progress"], ["report", "学习报告", "/student/report"],
] as const;

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  if (href === "/student/today") return pathname === href;
  if (href === "/diagnose") return pathname.startsWith("/diagnose") || pathname.startsWith("/materials");
  return pathname.startsWith(href);
}

export function AppShell({ children, actionHref = "/diagnose", actionLabel = "开始检查", actionDisabled = false }: { children: React.ReactNode; actionHref?: string; actionLabel?: string; actionDisabled?: boolean }) {
  const pathname = usePathname();
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-crop"><Image src={logo} alt="知隙 GapProof" priority className="brand-source" /></div>
      <nav className="top-tabs" aria-label="案例导航"><button type="button" className="top-tab active">当前案例</button><button type="button" className="top-tab">学生切换</button></nav>
      <div className="top-actions"><button type="button" className="role-label">学生 / 家长</button><button className="role-button" type="button">角色切换</button><span className="avatar" aria-label="当前用户">知</span></div>
    </header>
    <aside className="sidebar" aria-label="学生主导航">
      <nav>{items.map(([icon, label, href]) => { const active = isActive(pathname, href); return <Link key={label} href={href} className={`nav-item ${active ? "active" : ""}`} aria-current={active ? "page" : undefined}><Icon name={icon}/><span>{label}</span></Link>; })}</nav>
      {actionDisabled
        ? <span className="fixed-action disabled" aria-disabled="true">{actionLabel}</span>
        : <Link className="fixed-action" href={actionHref}>{actionLabel}</Link>}
    </aside>
    <details className="mobile-menu"><summary aria-label="打开学生导航"><Icon name="menu"/></summary><nav>{items.map(([_, label, href]) => <Link key={label} href={href} aria-current={isActive(pathname, href) ? "page" : undefined}>{label}</Link>)}</nav></details>
    <main className="content">{children}</main>
  </div>;
}
