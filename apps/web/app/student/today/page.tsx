import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/icons";
import { getMockTodayView } from "@/lib/mock-adapter";

type PageProps = { searchParams: Promise<{ state?: string }> };

function Skeleton() {
  return <AppShell><section aria-busy="true" aria-label="正在加载今日安排" className="today-page"><div className="title-row"><div><div className="skeleton sk-title"/><div className="skeleton sk-line"/></div></div><div className="today-grid"><div><div className="skeleton sk-hero"/><div className="skeleton sk-overview"/></div><aside><div className="skeleton sk-side"/><div className="skeleton sk-side"/></aside></div><p className="loading-note">正在整理今日安排。可以先去做别的，完成后会出现在这里。</p></section></AppShell>;
}

function NewUser() {
  return <AppShell actionHref="/materials/new" actionLabel="开始第一次检查"><section className="today-page"><div className="title-row"><div><span className="status-chip">第一次使用</span><h1>欢迎来到知隙</h1><p>先从一次小检查开始，看看你卡在哪里。</p></div></div><div className="onboarding-grid"><article className="onboarding-main"><p className="eyebrow">只需要 5–8 分钟</p><h2>先了解你的学习情况</h2><ol><li><Icon name="upload"/><div><strong>上传一张错题或作业图片</strong><span>只选择这次想检查的内容</span></div></li><li><span className="step-number">2</span><div><strong>做几道确认小题</strong><span>帮助我们分清可能卡住的地方</span></div></li><li><span className="step-number">3</span><div><strong>准备你的学习安排</strong><span>任务生成前不会显示虚构进展</span></div></li></ol><div className="button-row"><Link className="primary-blue" href="/materials/new">开始第一次检查 <Icon name="arrow"/></Link><Link className="ghost-link" href="/materials/demo/review">先看一个示例</Link></div></article><aside className="prepare-card"><h2>开始前你需要准备</h2><ul><li>一张清楚的错题或作业图片</li><li>大约 5–8 分钟</li><li>只上传你愿意用于检查的内容</li></ul><p>可以稍后补充材料，也可以随时暂停。</p></aside></div><div className="onboarding-notes"><article><h2>你会得到什么</h2><p>找到可能卡住的地方，再安排短小的下一步。</p></article><article><h2>你可以随时暂停</h2><p>离开不会自动提交答案；回来后可重新选择入口。</p></article></div></section></AppShell>;
}

function StatusPage({ kind }: { kind: "empty" | "error" }) {
  const error = kind === "error";
  return <AppShell actionHref={error ? "/student/today" : "/materials/new"} actionLabel={error ? "重新加载" : "添加学习材料"}><section className="today-page"><div className="title-row"><div><span className={`status-chip ${error ? "error" : ""}`}>{error ? "服务暂时不可用" : "今日已整理"}</span><h1>{error ? "暂时没能加载今日安排" : "今天的任务完成了"}</h1><p>{error ? "你的学习判断没有改变，可以稍后再试。" : "现在没有待做任务。下一次检查安排好后，会出现在这里。"}</p></div></div><article className="state-card"><Icon name={error ? "report" : "check"}/><div><h2>{error ? "这次没有加载成功" : "这里暂时是空的，这是正常状态"}</h2><p>{error ? "没有写入新记录，也不会显示猜测的任务。请检查网络后重试。" : "如果你有新的错题，可以添加学习材料开始下一次检查。"}</p><Link className="primary-blue" href={error ? "/student/today" : "/materials/new"}>{error ? "重新加载" : "添加学习材料"}</Link></div></article></section></AppShell>;
}

function Footprint() {
  return <section className="footprint" aria-labelledby="footprint-title"><h2 id="footprint-title">本周学习足迹</h2><div className="day-grid" role="img" aria-label="合成演示：本周一、周二有学习记录，今天尚未完成，其余日期未开始"><span className="done"/><span className="done"/><span className="today"><i>今天</i></span><span/><span/><span/><span/></div><p>演示记录：本周已有 2 天活动</p></section>;
}

function RegularToday() {
  return <AppShell actionHref="/materials/demo/review"><section className="today-page"><div className="title-row"><div><h1>早上好，同学！今天我们来解决“不规则动词”</h1><p>合成演示：用一个短任务检查现在完成时中的动词形式，不代表真实学习记录。</p></div><div className="date-summary"><strong>周六，15 日</strong><span>演示目标完成度 40%</span></div></div><div className="today-grid"><div className="main-column"><article className="hero-card"><svg className="book-art" aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg><span className="time-chip"><Icon name="clock"/> 预计 10 分钟</span><div className="hero-content"><div className="task-label-row"><span className="dark-chip"><i/> 今日重点任务</span></div><h2>攻克“现在完成时”动词形式</h2><p>根据合成练习案例，学习教练将在这里检查 write、eat、see 等词的过去分词形式。</p><div className="steps" role="list"><div role="listitem"><b>1</b>看一个例子</div><Icon name="arrow" className="path-arrow"/><div role="listitem"><b>2</b>做一道确认小题</div><Icon name="arrow" className="path-arrow"/><div role="listitem"><b>3</b>换一道新题再试</div></div><div className="cta-row"><Link className="lime-button" href="/materials/demo/review">开始今天的任务 <Icon name="arrow"/></Link></div></div></article><section className="overview"><h2>今日概览</h2><div className="overview-grid"><article className="lime-card"><div className="lime-heading"><Icon name="check"/><h3>等你确认</h3></div><p>合成演示材料中有一处识别结果需要确认；不会自动写入学习判断。</p><Link href="/materials/demo/review" className="dark-button">去确认</Link><Icon name="check" className="card-art"/></article><article className="lime-card"><div className="lime-heading"><Icon name="progress"/><h3>最近进展</h3></div><p>这里保持母版的信息位置；真实进展只会在服务端存在学习记录后显示。</p><Icon name="progress" className="card-art"/></article></div></section></div><aside className="right-column"><Footprint/><section className="continue" aria-labelledby="continue-title"><h2 id="continue-title">稍后继续</h2><div className="continue-list"><article><div className="task-row"><strong>阅读理解：代词指代关系</strong><span>01</span></div><div className="progress-row"><div className="mini-progress"><i style={{ width: "0%" }}/></div><span>0%</span></div></article><article><div className="task-row"><strong>词汇巩固：语境词义辨析</strong><span>02</span></div><div className="progress-row"><div className="mini-progress"><i style={{ width: "50%" }}/></div><span>50%</span></div></article></div></section><section className="next-check"><header><span><Icon name="today"/> 下次检查</span><strong>演示：明天</strong></header><div><h2>现在完成时中的过去分词</h2><p>形式：换一道新题</p><p>预计时长：约 4 分钟</p></div><button type="button" disabled title="F0 不接入真实调度">明天再试</button><small>F0 尚未接入真实定时调度</small></section></aside></div></section></AppShell>;
}

export default async function TodayPage({ searchParams }: PageProps) {
  const { state } = await searchParams;
  const view = getMockTodayView(state);
  if (view.mode === "loading") return <Skeleton/>;
  if (view.mode === "new") return <NewUser/>;
  if (view.mode === "empty" || view.mode === "error") return <StatusPage kind={view.mode}/>;
  return <RegularToday/>;
}
