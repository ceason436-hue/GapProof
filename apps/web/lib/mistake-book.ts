import type { LearningTaskView, TodayTasksView } from "@gapproof/contracts";

export type MistakeBookEntry = { task: LearningTaskView; action: "practice" | "review" | "waiting" };

function taskTimestamp(task: LearningTaskView) {
  return Date.parse(task.completedAt ?? task.scheduledFor);
}

const statusPriority: Record<LearningTaskView["status"], number> = {
  ready: 0,
  completed: 1,
  scheduled: 2,
};

export function toMistakeBookEntries(view: TodayTasksView): MistakeBookEntry[] {
  return [...view.tasks]
    .sort((left, right) => statusPriority[left.status] - statusPriority[right.status] || taskTimestamp(right) - taskTimestamp(left))
    .map(task => ({ task, action: task.status === "ready" ? "practice" : task.status === "completed" ? "review" : "waiting" }));
}

export function findMistakeBookEntry(view: TodayTasksView, taskId: string) {
  return toMistakeBookEntries(view).find(entry => entry.task.id === taskId) ?? null;
}

export function taskKindLabel(task: LearningTaskView) {
  if (task.taskType === "guided_intervention") return "针对练习";
  return task.taskType === "d1_retest" ? "明日复习" : "7 天后巩固";
}
