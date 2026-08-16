"use client";

import { QuestionArchiveViewSchema, type QuestionArchiveItem, type QuestionArchiveTaskFact } from "@gapproof/contracts";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiGet } from "@/lib/api-client";
import { selectArchiveTask, taskKindLabel } from "@/lib/mistake-book";
import { formatTaskDateTime } from "@/lib/today-adapter";
import { Icon } from "./icons";

type ArchiveFilter = "all" | "active" | "completed";
const PAGE_SIZE = "20";

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

function archivePath(studentId: string, query: string, filter: ArchiveFilter, cursor?: string) {
  const params = new URLSearchParams({ limit: PAGE_SIZE, filter });
  const normalizedQuery = query.trim();
  if (normalizedQuery) params.set("query", normalizedQuery);
  if (cursor) params.set("cursor", cursor);
  return `/api/v1/students/${studentId}/question-archive?${params.toString()}` as `/api/v1/${string}`;
}

export function MistakeBookBrowser({ studentId, initialItems, initialTotalCount, initialMatchedCount, initialNextCursor, timeZone }: {
  studentId: string;
  initialItems: readonly QuestionArchiveItem[];
  initialTotalCount: number;
  initialMatchedCount: number;
  initialNextCursor: string | null;
  timeZone: string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ArchiveFilter>("all");
  const [items, setItems] = useState<readonly QuestionArchiveItem[]>(initialItems);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [matchedCount, setMatchedCount] = useState(initialMatchedCount);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [status, setStatus] = useState<"idle" | "loading" | "loading_more" | "error">("idle");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const skipInitialRequest = useRef(true);

  useEffect(() => {
    if (skipInitialRequest.current) {
      skipInitialRequest.current = false;
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    const timer = window.setTimeout(async () => {
      try {
        const response = await apiGet(archivePath(studentId, query, filter), QuestionArchiveViewSchema, controller.signal);
        setItems(response.data.items);
        setTotalCount(response.data.totalCount);
        setMatchedCount(response.data.matchedCount);
        setNextCursor(response.data.nextCursor);
        setStatus("idle");
      } catch {
        if (!controller.signal.aborted) setStatus("error");
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [filter, query, refreshVersion, studentId]);

  async function loadMore() {
    if (!nextCursor || status === "loading_more") return;
    setStatus("loading_more");
    try {
      const response = await apiGet(archivePath(studentId, query, filter, nextCursor), QuestionArchiveViewSchema);
      setItems(current => {
        const known = new Set(current.map(item => item.entryRef));
        return [...current, ...response.data.items.filter(item => !known.has(item.entryRef))];
      });
      setTotalCount(response.data.totalCount);
      setMatchedCount(response.data.matchedCount);
      setNextCursor(response.data.nextCursor);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  function clearFilters() {
    setQuery("");
    setFilter("all");
  }

  return <div className="mistake-book-browser">
    <div className="mistake-book-tools">
      <label className="mistake-book-search"><Icon name="search"/><span className="visually-hidden">搜索错题</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索题干或来源" aria-label="搜索题干或来源"/></label>
      <div className="mistake-book-filters" role="group" aria-label="筛选错题">
        {(["all", "active", "completed"] as const).map(value => {
          const labels: Record<ArchiveFilter, string> = { all: "全部", active: "可继续/待复习", completed: "已完成" };
          return <button key={value} type="button" className={filter === value ? "selected" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{labels[value]}</button>;
        })}
      </div>
    </div>
    <p className="mistake-book-result-summary" aria-live="polite">{status === "loading" ? "正在更新错题…" : `当前显示 ${items.length} 道，筛选命中 ${matchedCount} 道，共 ${totalCount} 道已确认题目`}</p>
    {items.length === 0 && status !== "loading" ? <div className="mistake-book-no-results" role="status"><Icon name="search"/><div><h2>{status === "error" ? "暂时没能读取错题" : "没有找到符合条件的错题"}</h2><p>{status === "error" ? "当前筛选条件会保留，可以重新读取。" : "可以换个关键词，或清空搜索和筛选后再试。"}</p>{status === "error" ? <button type="button" className="secondary-button" onClick={() => setRefreshVersion(current => current + 1)}>重新读取</button> : <button type="button" className="secondary-button" onClick={clearFilters}>清空搜索和筛选</button>}</div></div> : <><div className="mistake-book-list">{items.map(item => {
      const task = selectArchiveTask(item.tasks);
      return <article className="mistake-entry" key={item.entryRef}><div className="mistake-entry-main"><span className="task-kind">来自 {item.sourceTitle}</span><h2>{item.prompt}</h2><Answer value={item.studentAnswer}/><span className="mistake-date">确认于 {formatTaskDateTime(item.confirmedAt, timeZone)}</span></div><div className="mistake-entry-action">{task ? <TaskSummary task={task} timeZone={timeZone}/> : <span className="status-chip scheduled">尚无后续任务</span>}<Link href={`/student/mistakes/questions/${encodeURIComponent(item.entryRef)}`}>查看题目<Icon name="arrow"/></Link></div></article>;
    })}</div>{nextCursor || status === "error" ? <div className="mistake-book-load-more"><button type="button" className="secondary-button" onClick={() => status === "error" ? setRefreshVersion(current => current + 1) : void loadMore()} disabled={status === "loading" || status === "loading_more"}>{status === "loading_more" ? "正在继续显示" : status === "error" ? "重新读取" : "继续显示更多错题"}</button><span>{status === "error" ? "刚才的读取没有完成，当前结果仍保留。" : `还有 ${Math.max(0, matchedCount - items.length)} 道`}</span></div> : null}</>}
  </div>;
}
