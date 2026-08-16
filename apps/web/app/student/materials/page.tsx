import { StudentMaterialArchiveViewSchema, type StudentMaterialArchiveItem } from "@gapproof/contracts";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/icons";
import { MaterialTitleEditor } from "@/components/material-title-editor";
import { StudentSessionBootstrap } from "@/components/student-session-bootstrap";
import { apiServerGet } from "@/lib/api-server";
import { getCurrentStudentSession, StudentSessionRequiredError } from "@/lib/student-session-server";

export const dynamic = "force-dynamic";

type MaterialPresentation = {
  actionHref: string;
  actionLabel: string;
  detail: string;
  statusLabel: string;
  tone: "active" | "attention" | "complete" | "quiet";
  showMistakes?: boolean;
};

function completedMaterialPresentation(item: StudentMaterialArchiveItem): MaterialPresentation {
  if (item.caseState === "awaiting_confirmation") {
    return { actionHref: `/materials/${item.caseId}/review`, actionLabel: "核对题目内容", detail: "图片内容已经整理好，等你逐题检查后再继续。", statusLabel: "等待核对", tone: "attention" };
  }
  if (item.caseState === "ready_for_diagnosis") {
    return { actionHref: `/materials/${item.caseId}/review`, actionLabel: "继续找原因", detail: "题目内容已有确认记录，可以继续完成原因检查。", statusLabel: "等待检查", tone: "active", showMistakes: true };
  }
  if (item.caseState === "probe_required") {
    return { actionHref: `/materials/${item.caseId}/review`, actionLabel: "完成确认小题", detail: "继续回答确认小题，帮助分清接下来要练习的内容。", statusLabel: "检查进行中", tone: "active", showMistakes: true };
  }
  if (item.caseState === "intervention_ready") {
    return { actionHref: `/materials/${item.caseId}/review`, actionLabel: "准备下一步练习", detail: "原因检查已有记录，下一步练习还需要你确认开始。", statusLabel: "下一步待准备", tone: "active", showMistakes: true };
  }
  if (item.caseState === "d1_scheduled" || item.caseState === "d7_scheduled") {
    return { actionHref: "/student/today?source=api", actionLabel: "查看今日安排", detail: "这份材料已有后续检查安排，到期任务会出现在今日页。", statusLabel: "后续检查已安排", tone: "quiet", showMistakes: true };
  }
  if (item.caseState === "repair_verified" || item.caseState === "support_required" || item.caseState === "report_ready") {
    return { actionHref: `/student/reports/${item.caseId}`, actionLabel: "查看学习记录", detail: item.caseState === "support_required" ? "这份材料的当前记录建议请老师或家长一起查看。" : "这份材料已有后续学习记录，可以回看当时的检查与任务事实。", statusLabel: item.caseState === "support_required" ? "建议一起查看" : "本轮已有记录", tone: "complete", showMistakes: true };
  }
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
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function MaterialCard({ item }: { item: StudentMaterialArchiveItem }) {
  const presentation = materialPresentation(item);
  return <article className="material-archive-item" data-batch-status={item.batchStatus} data-case-state={item.caseState}>
    <div className={`material-archive-icon ${presentation.tone}`}><Icon name="materials"/></div>
    <div className="material-archive-copy">
      <div className="material-archive-heading"><h2>{item.title}</h2><span className={`material-archive-status ${presentation.tone}`}>{presentation.statusLabel}</span><MaterialTitleEditor batchId={item.batchId} initialTitle={item.title} initialVersion={item.version}/></div>
      <p>{presentation.detail}</p>
      <div className="material-archive-meta"><span>{item.pageCount} 张图片</span><span>更新于 {formatUpdatedAt(item.updatedAt)}</span></div>
    </div>
    <div className="material-archive-actions">
      <Link className="primary-blue" href={presentation.actionHref}>{presentation.actionLabel}<Icon name="arrow"/></Link>
      {presentation.showMistakes ? <Link className="material-archive-secondary" href="/student/mistakes">查看错题本</Link> : null}
    </div>
  </article>;
}

function EmptyArchive() {
  return <article className="material-archive-empty"><Icon name="materials"/><div><h2>还没有上传过学习材料</h2><p>有新的错题、作业或试卷时，可以一次选择多张图片。图片处理后仍需要你逐题核对。</p><Link className="primary-blue" href="/materials/new">上传学习材料</Link></div></article>;
}

function ArchiveUnavailable() {
  return <AppShell actionHref="/materials/new" actionLabel="上传学习材料"><section className="material-archive-page"><div className="title-row"><div><h1>我的材料</h1><p>暂时没能读取材料记录，已经保存的内容不会受到影响。</p></div></div><article className="material-archive-empty"><Icon name="alert"/><div><h2>请稍后重新打开</h2><p>也可以先返回今日页，继续当前可以完成的任务。</p><div className="button-row"><Link className="primary-blue" href="/student/materials">重新加载</Link><Link className="ghost-link" href="/student/today?source=api">返回今日</Link></div></div></article></section></AppShell>;
}

export default async function StudentMaterialsPage() {
  try {
    const { session, cookieHeader } = await getCurrentStudentSession();
    const response = await apiServerGet(`/api/v1/students/${session.studentId}/materials`, StudentMaterialArchiveViewSchema, undefined, { Cookie: cookieHeader });
    const { items, totalCount } = response.data;
    return <AppShell actionHref="/materials/new" actionLabel="添加学习材料"><section className="material-archive-page"><div className="title-row"><div><h1>我的材料</h1><p>按上传时间查看错题、作业和试卷，继续未完成的处理或后续学习。</p></div><div className="material-archive-count"><strong>{totalCount}</strong><span>份学习材料</span></div></div>{items.length === 0 ? <EmptyArchive/> : <div className="material-archive-list">{items.map(item => <MaterialCard item={item} key={item.batchId}/>)}</div>}<p className="material-archive-note">这里只显示当前学习空间中真实上传的材料和已保存状态；处理完成不代表题目已经核对，也不代表已经掌握。</p></section></AppShell>;
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) return <StudentSessionBootstrap/>;
    return <ArchiveUnavailable/>;
  }
}
