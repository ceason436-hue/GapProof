import Link from "next/link";
import { AppShell } from "./app-shell";

export function RoutePlaceholder({ eyebrow, title, description, nextHref, nextLabel }: { eyebrow: string; title: string; description: string; nextHref?: string; nextLabel?: string }) {
  return <AppShell actionHref="/materials/new" actionLabel="添加学习材料"><section className="placeholder-page"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p><div className="placeholder-card"><span>开始前准备</span><h2>从一次小检查开始</h2><p>请先遮盖姓名、学校和班级等不必要信息。体验内容不会保存为正式学习记录。</p>{nextHref && nextLabel ? <Link className="primary-blue" href={nextHref}>{nextLabel}</Link> : null}</div></section></AppShell>;
}
