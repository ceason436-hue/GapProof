import Link from "next/link";

import { AppShell } from "./app-shell";
import { Icon } from "./icons";

export function StudentFeatureState({
  eyebrow,
  title,
  description,
  cardTitle,
  cardDescription,
  icon,
  secondaryHref = "/student/today",
  secondaryLabel = "返回今日",
}: {
  eyebrow: string;
  title: string;
  description: string;
  cardTitle: string;
  cardDescription: string;
  icon: "plan" | "progress" | "report";
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  return <AppShell actionHref="/diagnose" actionLabel="开始一次检查">
    <section className="today-page feature-state-page">
      <div className="title-row"><div><span className="status-chip">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div></div>
      <article className="state-card"><Icon name={icon}/><div><h2>{cardTitle}</h2><p>{cardDescription}</p><div className="button-row"><Link className="primary-blue" href="/diagnose">选择诊断方式</Link><Link className="ghost-link" href={secondaryHref}>{secondaryLabel}</Link></div></div></article>
    </section>
  </AppShell>;
}
