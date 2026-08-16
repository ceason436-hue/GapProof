"use client";

import { StudentMaterialArchiveViewSchema, type StudentMaterialArchiveFilter, type StudentMaterialArchiveItem } from "@gapproof/contracts";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { apiGet } from "@/lib/api-client";
import { Icon } from "./icons";
import { MaterialTitleEditor } from "./material-title-editor";

const PAGE_SIZE = "20";

type MaterialPresentation = {
  actionHref: string;
  actionLabel: string;
  detail: string;
  statusLabel: string;
  tone: "active" | "attention" | "complete" | "quiet";
  showMistakes?: boolean;
};

function completedMaterialPresentation(item: StudentMaterialArchiveItem): MaterialPresentation {
  if (item.caseState === "awaiting_confirmation") return { actionHref: `/materials/${item.caseId}/review`, actionLabel: "核对题目内容", detail: "图片内容已经整理好，等你逐题检查后再继续。", statusLabel: "等待核对", tone: "attention" };
  if (item.caseState === "ready_for_diagnosis") return { actionHref: `/materials/${item.caseId}/review`, actionLabel: "继续找原因", detail: "题目内容已有确认记录，可以继续完成原因检查。", statusLabel: "等待检查", tone: "active", showMistakes: true };
  if (item.caseState === "probe_required") return { actionHref: `/materials/${item.caseId}/review`, actionLabel: "完成确认小题", detail: "继续回答确认小题，帮助分清接下来要练习的内容。", statusLabel: "检查进行中", tone: "active", showMistakes: true };
  if (item.caseState === "intervention_ready") return { actionHref: `/materials/${item.caseId}/review`, actionLabel: "准备下一步练习", detail: "原因检查已有记录，下一步练习还需要你确认开始。", statusLabel: "下一步待准备", tone: "active", showMistakes: true };
  if (item.caseState === "d1_scheduled" || item.caseState === "d7_scheduled") return { actionHref: "/student/today?source=api", actionLabel: "查看今日安排", detail: "这份材料已有后续检查安排，到期任务会出现在今日页。", statusLabel: "后续检查已安排", tone: "quiet", showMistakes: true };
  if (item.caseState === "repair_verified" || item.caseState === "support_required" || item.caseState === "report_ready") return { actionHref: `/student/reports/${item.caseId}`, actionLabel: "查看学习记录", detail: item.caseState === "support_required" ? "这份材料的当前记录建议请老师或家长一起查看。" : "这份材料已有后续学习记录，可以回看当时的检查与任务事实。", statusLabel: item.caseState === "support_required" ? "建议一起查看" : "本轮已有记录", tone: "complete", showMistakes: true };
  return { actionHref: "/student/today?source=api", actionLabel: "继续今日任务", detail: item.caseState === "replan_required" ? "后续安排正在根据已有记录调整，请从今日页继续。" : "这份材料已进入后续学习流程，请从今日页继续当前任务。", statusLabel: item.caseState === "replan_required" ? "等待下一步安排" : "练习进行中", tone: "active", showMistakes: true };
}

function materialPresentation(item: StudentMaterialArchiveItem): MaterialPresentation {
  if (item.batchStatus === "collecting") return { actionHref: `/materials/new?batch=${item.batchId}`, actionLabel: "继续添加图片", detail: "这份材料还没有提交，可以继续补充或调整图片。", statusLabel: "等待提交", tone: "quiet" };
  if (item.batchStatus === "ready") return { actionHref: `/materials/new?batch=${item.batchId}`, actionLabel: "继续提交识别", detail: "图片已经上传，确认页序后可以开始处理。", statusLabel: "可以继续", tone: "active" };
  if (item.batchStatus === "processing") return { actionHref: `/materials/new?batch=${item.batchId}`, actionLabel: "查看处理进度", detail: "图片仍在处理中，完成后还需要你核对题目内容。", statusLabel: "正在处理", tone: "active" };
  if (item.batchStatus === "retryable_error") return { actionHref: `/materials/new?batch=${item.batchId}`, actionLabel: "继续处理材料", detail: "上次处理没有完成，可以打开原材料查看恢复方式。", statusLabel: "需要继续处理", tone: "attention" };
  if (item.batchStatus === "failed") return { actionHref: "/materials/new", actionLabel: "重新上传材料", detail: "这次没有形成可继续处理的内容，可以重新上传清晰图片。", statusLabel: "没有处理完成", tone: "attention" };
  if (item.batchStatus === "needs_confirmation") return { actionHref: `/materials/${item.caseId}/review`, actionLabel: "核对题目内容", detail: "图片内容已经整理好，等你逐题检查后再继续。", statusLabel: "等待核对", tone: "attention" };
  return completedMaterialPresentation(item);
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function archivePath(studentId: string, query: string, filter: StudentMaterialArchiveFilter, cursor?: string) {
  const params = new URLSearchParams({ limit: PAGE_SIZE, filter });
  const normalized = query.trim();
  if (normalized) params.set("query", normalized);
  if (cursor) params.set("cursor", cursor);
  return `/api/v1/students/${studentId}/materials?${params.toString()}` as `/api/v1/${string}`;
}

function MaterialCard({ item, onRenamed }: { item: StudentMaterialArchiveItem; onRenamed: (title: string, version: number) => void }) {
  const presentation = materialPresentation(item);
  return <article className="material-archive-item" data-batch-status={item.batchStatus} data-case-state={item.caseState}>
    <div className={`material-archive-icon ${presentation.tone}`}><Icon name="materials"/></div>
    <div className="material-archive-copy">
      <div className="material-archive-heading"><h2>{item.title}</h2><span className={`material-archive-status ${presentation.tone}`}>{presentation.statusLabel}</span><MaterialTitleEditor batchId={item.batchId} initialTitle={item.title} initialVersion={item.version} onSaved={onRenamed}/></div>
      <p>{presentation.detail}</p>
      <div className="material-archive-meta"><span>{item.pageCount} 张图片</span><span>更新于 {formatUpdatedAt(item.updatedAt)}</span></div>
    </div>
    <div className="material-archive-actions"><Link className="primary-blue" href={presentation.actionHref}>{presentation.actionLabel}<Icon name="arrow"/></Link>{presentation.showMistakes ? <Link className="material-archive-secondary" href="/student/mistakes">查看错题本</Link> : null}</div>
  </article>;
}

export function MaterialArchiveBrowser({ studentId, initialItems, initialTotalCount, initialMatchedCount, initialNextCursor }: { studentId: string; initialItems: readonly StudentMaterialArchiveItem[]; initialTotalCount: number; initialMatchedCount: number; initialNextCursor: string | null }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StudentMaterialArchiveFilter>("all");
  const [items, setItems] = useState<readonly StudentMaterialArchiveItem[]>(initialItems);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [matchedCount, setMatchedCount] = useState(initialMatchedCount);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [status, setStatus] = useState<"idle" | "loading" | "loading_more" | "error">("idle");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const skipInitialRequest = useRef(true);

  useEffect(() => {
    if (skipInitialRequest.current) { skipInitialRequest.current = false; return; }
    const controller = new AbortController();
    setStatus("loading");
    const timer = window.setTimeout(async () => {
      try {
        const response = await apiGet(archivePath(studentId, query, filter), StudentMaterialArchiveViewSchema, controller.signal);
        setItems(response.data.items); setTotalCount(response.data.totalCount); setMatchedCount(response.data.matchedCount); setNextCursor(response.data.nextCursor); setStatus("idle");
      } catch { if (!controller.signal.aborted) setStatus("error"); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [filter, query, refreshVersion, studentId]);

  async function loadMore() {
    if (!nextCursor || status === "loading_more") return;
    setStatus("loading_more");
    try {
      const response = await apiGet(archivePath(studentId, query, filter, nextCursor), StudentMaterialArchiveViewSchema);
      setItems(current => { const known = new Set(current.map(item => item.batchId)); return [...current, ...response.data.items.filter(item => !known.has(item.batchId))]; });
      setTotalCount(response.data.totalCount); setMatchedCount(response.data.matchedCount); setNextCursor(response.data.nextCursor); setStatus("idle");
    } catch { setStatus("error"); }
  }

  function renameItem(batchId: string, title: string, version: number) {
    setItems(current => current.map(item => item.batchId === batchId ? { ...item, title, version } : item));
  }

  function clearFilters() {
    setQuery("");
    setFilter("all");
  }

  return <div className="material-archive-browser">
    <div className="mistake-book-tools"><label className="mistake-book-search"><Icon name="search"/><span className="visually-hidden">搜索材料</span><input type="search" value={query} maxLength={80} onChange={event => setQuery(event.currentTarget.value)} placeholder="搜索材料名称" aria-label="搜索材料名称"/></label><div className="mistake-book-filters" role="group" aria-label="筛选材料">{(["all", "active", "completed"] as const).map(value => <button key={value} type="button" className={filter === value ? "selected" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{{ all: "全部", active: "待继续", completed: "已有记录" }[value]}</button>)}</div></div>
    <p className="mistake-book-result-summary" aria-live="polite">{status === "loading" ? "正在更新材料…" : `当前显示 ${items.length} 份，筛选命中 ${matchedCount} 份，共 ${totalCount} 份材料`}</p>
    {items.length === 0 && status !== "loading" ? <div className="mistake-book-no-results" role="status"><Icon name="search"/><div><h2>{status === "error" ? "暂时没能读取材料" : "没有找到符合条件的材料"}</h2><p>{status === "error" ? "当前搜索和筛选会保留，可以重新读取。" : "可以换个关键词，或查看全部材料。"}</p><button type="button" className="secondary-button" onClick={() => status === "error" ? setRefreshVersion(current => current + 1) : clearFilters()}>{status === "error" ? "重新读取" : "清空搜索和筛选"}</button></div></div> : <><div className="material-archive-list">{items.map(item => <MaterialCard item={item} key={item.batchId} onRenamed={(title, version) => renameItem(item.batchId, title, version)}/>)}</div>{nextCursor || status === "error" ? <div className="mistake-book-load-more"><button type="button" className="secondary-button" disabled={status === "loading" || status === "loading_more"} onClick={() => status === "error" ? setRefreshVersion(current => current + 1) : void loadMore()}>{status === "loading_more" ? "正在继续显示" : status === "error" ? "重新读取" : "继续显示更多材料"}</button><span>{status === "error" ? "刚才的读取没有完成，当前结果仍保留。" : `还有 ${Math.max(0, matchedCount - items.length)} 份`}</span></div> : null}</>}
  </div>;
}
