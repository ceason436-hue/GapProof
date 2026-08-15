import { StudentFeatureState } from "@/components/student-feature-state";

export default function ProgressPage() {
  return <StudentFeatureState eyebrow="我的进步" title="进步需要学习证据支持" description="这里不会用 Mock 百分比填充空状态。" cardTitle="暂时没有可展示的趋势" cardDescription="“今日”只展示服务端已有的脱敏学习足迹；完整趋势页仍未实现，也不代表真实学习效果已经得到证明。" icon="progress" secondaryLabel="查看今日证据"/>;
}
