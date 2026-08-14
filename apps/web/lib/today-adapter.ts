import type { LearningTaskView, TodayTasksView } from "@gapproof/contracts";

export type RetestReadModel = Pick<
  LearningTaskView,
  "id" | "title" | "status" | "scheduledFor" | "dueAt" | "estimatedMinutes"
> & { submitAvailable: false };

export type TodayReadModel = {
  studentId: string;
  taskCount: number;
  hasServerSelectedCurrentTask: false;
  retests: RetestReadModel[];
};

export function toTodayReadModel(view: TodayTasksView): TodayReadModel {
  return {
    studentId: view.studentId,
    taskCount: view.tasks.length,
    // The current contract has no currentTaskId. Never infer it from array order,
    // status, task type, or timestamps.
    hasServerSelectedCurrentTask: false,
    retests: view.tasks
      .filter(task => task.taskType === "d1_retest")
      .map(task => ({
        id: task.id,
        title: task.title,
        status: task.status,
        scheduledFor: task.scheduledFor,
        dueAt: task.dueAt,
        estimatedMinutes: task.estimatedMinutes,
        submitAvailable: false,
      })),
  };
}
