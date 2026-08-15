import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/icons";

export default function DiagnosePage() {
  return <AppShell actionHref="/materials/new" actionLabel="上传学习材料">
    <section className="today-page diagnose-page">
      <div className="title-row"><div><span className="status-chip">找原因</span><h1>选择一种方式开始检查</h1><p>有错题就上传；手边没有材料，也可以先做 3 道原创合成题体验规则化诊断。</p></div></div>
      <div className="diagnose-entry-grid">
        <article className="diagnose-entry-card primary"><Icon name="upload"/><span className="eyebrow">推荐 · 建立同一 Case</span><h2>上传错题或作业</h2><p>先做图片基础检查，再由你明确创建案例和启动合成识别。上传图片不会被 Fake OCR 读取。</p><Link className="primary-blue" href="/materials/new">上传学习材料</Link></article>
        <article className="diagnose-entry-card"><Icon name="search"/><span className="eyebrow">约 3 分钟 · 合成 Demo</span><h2>做 3 道快速诊断题</h2><p>真实 API 返回原创合成题并由服务端规则评分。结果只作体验，不写学习记录、不生成报告。</p><Link className="lime-button" href="/diagnose/quick-check">开始快速诊断</Link></article>
      </div>
      <p className="synthetic-boundary-note">两条入口的事实边界不同：上传入口可建立同一合成 Case；快速诊断只返回一次临时、规则化结果。</p>
    </section>
  </AppShell>;
}
