import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/icons";
import { ProfileSetupRequired } from "@/components/live-today";
import { StudentSessionBootstrap } from "@/components/student-session-bootstrap";
import { getCurrentStudentProfile } from "@/lib/student-profile-server";
import { StudentSessionRequiredError } from "@/lib/student-session-server";

export default async function DiagnosePage() {
  try {
    const { profile } = await getCurrentStudentProfile();
    if (!profile.completed) return <ProfileSetupRequired profile={profile}/>;
    return <AppShell actionHref="/materials/new" actionLabel="上传学习材料">
    <section className="today-page diagnose-page">
      <div className="title-row"><div><h1>选择一种方式开始检查</h1><p>有错题就上传；手边没有材料，也可以先做 3 道练习题看看从哪里开始。</p></div></div>
      <div className="diagnose-entry-grid">
        <article className="diagnose-entry-card primary"><Icon name="upload"/><span className="eyebrow">推荐 · 从自己的错题开始</span><h2>上传错题或作业</h2><p>可以一次选择多张图片。识别后先由你逐题核对，确认无误再进入检查。</p><Link className="primary-blue" href="/materials/new">上传学习材料</Link></article>
        <article className="diagnose-entry-card"><Icon name="search"/><span className="eyebrow">约 3 分钟</span><h2>做 3 道快速检查题</h2><p>完成三道练习后查看本次作答提示。结果只作体验，不写入学习记录，也不会生成报告。</p><Link className="lime-button" href="/diagnose/quick-check">开始快速检查</Link></article>
      </div>
      <p className="synthetic-boundary-note">快速检查使用体验题，结果不会写入学习记录；上传自己的材料后，你需要先核对识别内容。</p>
    </section>
    </AppShell>;
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) return <StudentSessionBootstrap/>;
    throw error;
  }
}
