import type { LearningTaskView, TodayTasksView } from "@gapproof/contracts";

export type LearningPlanDay = {
  localDate: string;
  tasks: LearningTaskView[];
  totalMinutes: number;
  completedCount: number;
};

function localDate(value: string | Date, timeZone: string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map(({ type, value: part }) => [type, part]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function dateRange(start: string) {
  const cursor = new Date(`${start}T12:00:00.000Z`);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(cursor);
    date.setUTCDate(cursor.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

function taskTime(task: LearningTaskView) {
  return Date.parse(task.dueAt ?? task.scheduledFor);
}

export function buildLearningPlan(view: TodayTasksView, now = new Date()): LearningPlanDay[] {
  const dates = dateRange(localDate(now, view.timeZone));
  return dates.map(date => {
    const tasks = view.tasks
      .filter(task => localDate(task.scheduledFor, view.timeZone) === date)
      .sort((left, right) => taskTime(left) - taskTime(right) || left.id.localeCompare(right.id));
    return {
      localDate: date,
      tasks,
      totalMinutes: tasks.reduce((sum, task) => sum + task.estimatedMinutes, 0),
      completedCount: tasks.filter(task => task.status === "completed").length,
    };
  });
}

export function planTaskLabel(task: LearningTaskView) {
  if (task.taskType === "mistake_review") return "错题重做";
  if (task.taskType === "guided_intervention") return "重点练习";
  return task.taskType === "d1_retest" ? "明天再试" : "换道新题";
}

export function planTaskStatus(task: LearningTaskView) {
  if (task.status === "completed") return "已完成";
  return task.status === "ready" ? "现在可做" : "等待开始";
}
