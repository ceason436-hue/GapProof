import { StudentFeatureState } from "@/components/student-feature-state";

export default function PlanPage() {
  return <StudentFeatureState title="完成检查，再安排下一步" description="你的计划会根据已经完成的任务逐步更新。" cardTitle="暂时还没有完整计划" cardDescription="当前任务、明日复习和 7 天后巩固会先出现在“今日”。完成一次检查后，再回来查看新的安排。" icon="plan"/>;
}
