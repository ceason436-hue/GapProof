import { StudentMaterialArchiveViewSchema } from "@gapproof/contracts";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/icons";
import { MaterialArchiveBrowser } from "@/components/material-archive-browser";
import { StudentSessionBootstrap } from "@/components/student-session-bootstrap";
import { apiServerGet } from "@/lib/api-server";
import { getCurrentStudentSession, StudentSessionRequiredError } from "@/lib/student-session-server";

export const dynamic = "force-dynamic";

function EmptyArchive() {
  return <article className="material-archive-empty"><Icon name="materials"/><div><h2>还没有上传过学习材料</h2><p>有新的错题、作业或试卷时，可以一次选择多张图片。图片处理后仍需要你逐题核对。</p><Link className="primary-blue" href="/materials/new">上传学习材料</Link></div></article>;
}

function ArchiveUnavailable() {
  return <AppShell actionHref="/materials/new" actionLabel="上传学习材料"><section className="material-archive-page"><div className="title-row"><div><h1>我的材料</h1><p>暂时没能读取材料记录，已经保存的内容不会受到影响。</p></div></div><article className="material-archive-empty"><Icon name="alert"/><div><h2>请稍后重新打开</h2><p>也可以先返回今日页，继续当前可以完成的任务。</p><div className="button-row"><Link className="primary-blue" href="/student/materials">重新加载</Link><Link className="ghost-link" href="/student/today?source=api">返回今日</Link></div></div></article></section></AppShell>;
}

export default async function StudentMaterialsPage() {
  try {
    const { session, cookieHeader } = await getCurrentStudentSession();
    const response = await apiServerGet(`/api/v1/students/${session.studentId}/materials?limit=20&filter=all`, StudentMaterialArchiveViewSchema, undefined, { Cookie: cookieHeader });
    const { items, totalCount, matchedCount, nextCursor } = response.data;
    return <AppShell actionHref="/materials/new" actionLabel="添加学习材料"><section className="material-archive-page"><div className="title-row"><div><h1>我的材料</h1><p>按上传时间查看错题、作业和试卷，继续未完成的处理或后续学习。</p></div><div className="material-archive-count"><strong>{totalCount}</strong><span>份学习材料</span></div></div>{totalCount === 0 ? <EmptyArchive/> : <MaterialArchiveBrowser studentId={session.studentId} initialItems={items} initialTotalCount={totalCount} initialMatchedCount={matchedCount} initialNextCursor={nextCursor}/>}<p className="material-archive-note">这里只显示当前学习空间中真实上传的材料和已保存状态；处理完成不代表题目已经核对，也不代表已经掌握。</p></section></AppShell>;
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) return <StudentSessionBootstrap/>;
    return <ArchiveUnavailable/>;
  }
}
