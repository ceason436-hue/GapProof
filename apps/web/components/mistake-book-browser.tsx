"use client";

import type { QuestionArchiveItem, QuestionArchiveTaskFact } from "@gapproof/contracts";
import Link from "next/link";
import { useMemo, useState } from "react";
import { selectArchiveTask, taskKindLabel } from "@/lib/mistake-book";
import { formatTaskDateTime } from "@/lib/today-adapter";
import { Icon } from "./icons";

type ArchiveFilter = "all" | "active" | "completed";

function statusCopy(status: QuestionArchiveTaskFact["status"]) {
  if (status === "ready") return "可以继续";
  if (status === "completed") return "已有完成记录";
  return "等待复习";
}

function Answer({ value }: { value: string | null }) {
  return <p className={value === null ? "archive-answer missing" : "archive-answer"}><strong>当时的作答</strong><span>{value ?? "确认时没有填写作答"}</span></p>;
}

function TaskSummary({ task, timeZone }: { task: QuestionArchiveTaskFact; timeZone: string }) {
  const time = task.completedAt ?? task.dueAt ?? task.scheduledFor;
  return <div className="archive-task-summary"><span className={`status-chip ${task.status}`}>{statusCopy(task.status)}</span><span>{taskKindLabel(task)} · {formatTaskDateTime(time, timeZone)}</span></div>;
}

function isActive(item: QuestionArchiveItem) {
  const task = selectArchiveTask(item.tasks);
  return task === null || task.status === "ready" || task.status === "scheduled";
}

function matchesFilter(item: QuestionArchiveItem, filter: ArchiveFilter) {
  if (filter === "all") return true;
  const task = selectArchiveTask(item.tasks);
  return filter === "completed" ? task?.status === "completed" : isActive(item);
}

export function MistakeBookBrowser({
  items,
  timeZone,
}: {
  items: readonly QuestionArchiveItem[];
  timeZone: string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ArchiveFilter>("all");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredItems = useMemo(() => items.filter(item => {
    const matchesQuery = normalizedQuery.length === 0
      || item.prompt.toLocaleLowerCase().includes(normalizedQuery)
      || item.sourceTitle.toLocaleLowerCase().includes(normalizedQuery);
    return matchesQuery && matchesFilter(item, filter);
  }), [filter, items, normalizedQuery]);

  function clearFilters() {
    setQuery("");
    setFilter("all");
  }

  return <div className="mistake-book-browser">
    <div className="mistake-book-tools">
      <label className="mistake-book-search">
        <Icon name="search"/>
        <span className="visually-hidden">搜索错题</span>
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索题干或来源" aria-label="搜索题干或来源"/>
      </label>
      <div className="mistake-book-filters" role="group" aria-label="筛选错题">
        {(["all", "active", "completed"] as const).map(value => {
          const labels: Record<ArchiveFilter, string> = { all: "全部", active: "可继续/待复习", completed: "已完成" };
          return <button key={value} type="button" className={filter === value ? "selected" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{labels[value]}</button>;
        })}
      </div>
    </div>
    <p className="mistake-book-result-summary" aria-live="polite">当前显示 {filteredItems.length} 道，共 {items.length} 道已确认题目</p>
    {filteredItems.length === 0 ? <div className="mistake-book-no-results" role="status"><Icon name="search"/><div><h2>没有找到符合条件的错题</h2><p>可以换个关键词，或清空搜索和筛选后再试。</p><button type="button" className="secondary-button" onClick={clearFilters}>清空搜索和筛选</button></div></div> : <div className="mistake-book-list">{filteredItems.map(item => {
      const task = selectArchiveTask(item.tasks);
      return <article className="mistake-entry" key={item.entryRef}><div className="mistake-entry-main"><span className="task-kind">来自 {item.sourceTitle}</span><h2>{item.prompt}</h2><Answer value={item.studentAnswer}/><span className="mistake-date">确认于 {formatTaskDateTime(item.confirmedAt, timeZone)}</span></div><div className="mistake-entry-action">{task ? <TaskSummary task={task} timeZone={timeZone}/> : <span className="status-chip scheduled">尚无后续任务</span>}<Link href={`/student/mistakes/questions/${encodeURIComponent(item.entryRef)}`}>查看题目<Icon name="arrow"/></Link></div></article>;
    })}</div>}
  </div>;
}
