import { StudentFeatureState } from "@/components/student-feature-state";

export default function ProgressPage() {
  return <StudentFeatureState eyebrow="我的进步" title="每次完成，都会留下新的学习足迹" description="积累更多练习后，这里会展示你的变化。" cardTitle="暂时还没有学习趋势" cardDescription="先从“今日”完成一次任务。体验内容不会保存为正式学习记录，也不会被当作真实学习效果。" icon="progress" secondaryLabel="查看今日任务"/>;
}
