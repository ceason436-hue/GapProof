import type {
  D1RetestTaskView,
  D7RetestTaskView,
  GuidedInterventionTaskView,
  LearningTaskView,
  TodayTasksView,
} from "@gapproof/contracts";

export type RetestTaskView = D1RetestTaskView | D7RetestTaskView;
export type CurrentActionableTask = GuidedInterventionTaskView | D1RetestTaskView;

export type CurrentTaskSelection =
  | { kind: "none" }
  | { kind: "selected"; task: CurrentActionableTask }
  | {
      kind: "contract_error";
      code:
        | "CURRENT_TASK_NOT_FOUND"
        | "CURRENT_TASK_NOT_READY"
        | "CURRENT_TASK_READ_ONLY";
      referencedTask?: LearningTaskView;
    };

export type TodayReadModel = {
  studentId: string;
  timeZone: string;
  taskCount: number;
  current: CurrentTaskSelection;
  retests: RetestTaskView[];
};

function requireUsableTimeZone(timeZone: string): void {
  // The API validates the student's IANA time zone. Recheck at the rendering
  // boundary so even an empty task response cannot silently use a local zone.
  new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
}

function selectCurrentTask(view: TodayTasksView): CurrentTaskSelection {
  if (view.currentTaskId === null) return { kind: "none" };

  const task = view.tasks.find(candidate => candidate.id === view.currentTaskId);
  if (!task) return { kind: "contract_error", code: "CURRENT_TASK_NOT_FOUND" };
  if (task.status !== "ready") {
    return {
      kind: "contract_error",
      code: "CURRENT_TASK_NOT_READY",
      referencedTask: task,
    };
  }
  if (task.taskType === "d7_retest") {
    return {
      kind: "contract_error",
      code: "CURRENT_TASK_READ_ONLY",
      referencedTask: task,
    };
  }
  return { kind: "selected", task };
}

export function toTodayReadModel(view: TodayTasksView): TodayReadModel {
  requireUsableTimeZone(view.timeZone);
  return {
    studentId: view.studentId,
    timeZone: view.timeZone,
    taskCount: view.tasks.length,
    // Selection is exclusively the server-provided ID. No array, status,
    // timestamp, or task-type fallback is allowed.
    current: selectCurrentTask(view),
    retests: view.tasks.filter(
      (task): task is RetestTaskView => task.taskType !== "guided_intervention",
    ),
  };
}

export function formatTaskDateTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
