"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import logo from "../../../reference/stitch_gapproof_ai/logo.png";
import { Icon } from "./icons";

const items = [
  ["today", "今日", "/student/today"], ["search", "找原因", "/diagnose"],
  ["materials", "我的材料", "/student/materials"],
  ["mistakes", "错题本", "/student/mistakes"], ["plan", "7 日计划", "/student/plan"], ["progress", "我的进步", "/student/progress"], ["report", "学习报告", "/student/report"],
] as const;

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  if (href === "/student/today") return pathname === href || pathname.startsWith("/student/tasks/");
  if (href === "/diagnose") return pathname.startsWith("/diagnose");
  if (href === "/student/materials") return pathname.startsWith(href) || pathname.startsWith("/materials");
  return pathname.startsWith(href);
}

export function AppShell({ children, actionHref = "/diagnose", actionLabel = "开始检查", actionDisabled = false }: { children: React.ReactNode; actionHref?: string; actionLabel?: string; actionDisabled?: boolean }) {
  const pathname = usePathname();
  const currentSection = items.find(([, , href]) => isActive(pathname, href))?.[1] ?? "我的学习";
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-crop"><Image src={logo} alt="知隙 GapProof" priority className="brand-source" /></div>
      <div className="top-tabs" aria-label="当前位置"><span className="top-tab active">{currentSection}</span></div>
      <div className="top-actions"><Link className="role-button" href="/setup">学习设置</Link></div>
    </header>
    <aside className="sidebar" aria-label="学生主导航">
      <nav>{items.map(([icon, label, href]) => { const active = isActive(pathname, href); return <Link key={label} href={href} className={`nav-item ${active ? "active" : ""}`} aria-current={active ? "page" : undefined}><Icon name={icon}/><span>{label}</span></Link>; })}</nav>
      {actionDisabled
        ? <span className="fixed-action disabled" aria-disabled="true">{actionLabel}</span>
        : <Link className="fixed-action" href={actionHref}>{actionLabel}</Link>}
    </aside>
    <details className="mobile-menu"><summary aria-label="打开学生导航"><Icon name="menu"/></summary><nav>{items.map(([_, label, href]) => <Link key={label} href={href} aria-current={isActive(pathname, href) ? "page" : undefined}>{label}</Link>)}<Link href="/setup">学习设置</Link></nav></details>
    <main className="content">{children}</main>
  </div>;
}
