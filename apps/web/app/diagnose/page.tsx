import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/icons";

export default function DiagnosePage() {
  return <AppShell actionHref="/materials/new" actionLabel="上传学习材料">
    <section className="today-page diagnose-page">
      <div className="title-row"><div><span className="status-chip">找原因</span><h1>选择一种方式开始检查</h1><p>有错题就上传；手边没有材料，也可以先做 3 道练习题看看从哪里开始。</p></div></div>
      <div className="diagnose-entry-grid">
        <article className="diagnose-entry-card primary"><Icon name="upload"/><span className="eyebrow">推荐 · 从自己的错题开始</span><h2>上传错题或作业</h2><p>先检查图片是否清晰，再由你确认识别出的题目。当前体验内容不会保存为正式学习记录。</p><Link className="primary-blue" href="/materials/new">上传学习材料</Link></article>
        <article className="diagnose-entry-card"><Icon name="search"/><span className="eyebrow">约 3 分钟</span><h2>做 3 道快速检查题</h2><p>完成三道练习后查看本次作答提示。结果只作体验，不写入学习记录，也不会生成报告。</p><Link className="lime-button" href="/diagnose/quick-check">开始快速检查</Link></article>
      </div>
      <p className="synthetic-boundary-note">快速检查使用体验题；上传入口会继续让你核对识别内容。两种方式都不会把体验结果当作真实学习效果。</p>
    </section>
  </AppShell>;
}
