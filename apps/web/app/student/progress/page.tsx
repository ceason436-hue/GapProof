import { StudentFeatureState } from "@/components/student-feature-state";

export default function ProgressPage() {
  return <StudentFeatureState title="我的进步" description="完成的正式练习会在这里留下可回看的记录。" cardTitle="还没有可以对比的记录" cardDescription="先从“今日”完成一次正式任务。有两次以上同类练习后，这里才会展示基于作答记录的变化。" icon="progress" secondaryLabel="查看今日任务"/>;
}
