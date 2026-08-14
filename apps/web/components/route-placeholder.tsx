import Link from "next/link";
import { AppShell } from "./app-shell";

export function RoutePlaceholder({ eyebrow, title, description, nextHref, nextLabel }: { eyebrow: string; title: string; description: string; nextHref?: string; nextLabel?: string }) {
  return <AppShell actionHref="/materials/new" actionLabel="添加学习材料"><section className="placeholder-page"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p><div className="placeholder-card"><span>F0 路由骨架</span><h2>这一页会在后续阶段接入真实流程</h2><p>当前没有上传、分析、干预、计划或报告写入，也不会展示虚构结果。</p>{nextHref && nextLabel ? <Link className="primary-blue" href={nextHref}>{nextLabel}</Link> : null}</div></section></AppShell>;
}
