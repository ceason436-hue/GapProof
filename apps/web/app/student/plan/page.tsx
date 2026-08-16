import { LearningPlan } from "@/components/learning-plan";
import { StudentFeatureState } from "@/components/student-feature-state";
import { StudentSessionBootstrap } from "@/components/student-session-bootstrap";
import { StudentSessionRequiredError } from "@/lib/student-session-server";
import { fetchCurrentStudentToday } from "@/lib/today-server";

export default async function PlanPage() {
  try {
    const response = await fetchCurrentStudentToday();
    return <LearningPlan view={response.data}/>;
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) return <StudentSessionBootstrap/>;
    return <StudentFeatureState title="7 日计划" description="这里会汇总你接下来要完成的练习和复习。" cardTitle="暂时没能读取计划" cardDescription="已有学习记录不会改变。请稍后重试，或从今日页继续当前任务。" icon="plan" secondaryLabel="返回今日"/>;
  }
}
