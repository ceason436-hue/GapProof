import type { QuestionArchiveItem, QuestionArchiveTaskFact } from "@gapproof/contracts";

const statusPriority: Record<QuestionArchiveTaskFact["status"], number> = { ready: 0, scheduled: 1, completed: 2 };

export function findArchiveItem(items: readonly QuestionArchiveItem[], entryRef: string) {
  return items.find(item => item.entryRef === entryRef) ?? null;
}

export function selectArchiveTask(tasks: readonly QuestionArchiveTaskFact[]) {
  return [...tasks].sort((left, right) =>
    statusPriority[left.status] - statusPriority[right.status]
    || Date.parse(right.completedAt ?? right.scheduledFor) - Date.parse(left.completedAt ?? left.scheduledFor)
  )[0] ?? null;
}

export function taskKindLabel(task: { taskType: QuestionArchiveTaskFact["taskType"] }) {
  if (task.taskType === "guided_intervention") return "针对练习";
  return task.taskType === "d1_retest" ? "明日复习" : "7 天后巩固";
}

export function archiveTaskAction(task: QuestionArchiveTaskFact) {
  if (task.status === "ready") return task.taskType === "guided_intervention" ? "继续当前任务" : "开始复测";
  if (task.status === "scheduled") return "查看复习安排";
  return "查看任务记录";
}
