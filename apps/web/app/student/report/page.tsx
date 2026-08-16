import { StudentFeatureState } from "@/components/student-feature-state";

export default function ReportPage() {
  return <StudentFeatureState title="学习报告" description="报告只汇总你已经确认并完成的学习记录。" cardTitle="还没有足够的记录生成报告" cardDescription="先完成一次正式检查和后续任务。记录足够后，这里会展示做过的内容、仍需复习的地方和下一步安排。" icon="report"/>;
}
