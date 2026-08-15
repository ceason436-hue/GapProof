import { StudentFeatureState } from "@/components/student-feature-state";

export default function ReportPage() {
  return <StudentFeatureState eyebrow="学习报告" title="报告功能尚未开放" description="完成诊断或复测不等于报告已经生成。" cardTitle="当前没有可读取的报告" cardDescription="只有进入严格 report_ready、存在权威引用且当前可读时才能开放报告；异步学生/家长报告仍为 deferred。" icon="report"/>;
}
