import type {
  D1RetestTaskView,
  D7RetestTaskView,
  GuidedInterventionTaskView,
  LearningTaskView,
  TodayOverview,
  TodayTasksView,
} from "@gapproof/contracts";
import { describe, expect, it } from "vitest";
import { formatTaskDateTime, TodayOverviewContractError, toTodayReadModel } from "./today-adapter";

const studentId = "11111111-1111-4111-8111-111111111111";
const caseId = "22222222-2222-4222-8222-222222222222";
const scheduledFor = "2026-08-16T12:00:00.000Z";
const overview: TodayOverview = {
  hasStartedJourney: false,
  activityDays: Array.from({ length: 7 }, (_, index) => ({
    localDate: `2026-08-${String(10 + index).padStart(2, "0")}`,
    completedTaskCount: index === 6 ? 1 : 0,
  })),
  weeklyGoal: null,
  pendingConfirmationCount: 0,
  recentProgress: [],
  nextCheck: null,
};

function base(id: string, status: LearningTaskView["status"]) {
  return {
    id,
    caseId,
    studentId,
    status,
    title: `task-${id.slice(0, 4)}`,
    rationale: "contract fixture",
    estimatedMinutes: 5,
    scheduledFor,
    dueAt: "2026-08-16T13:00:00.000Z",
    completedAt: status === "completed" ? "2026-08-16T13:05:00.000Z" : null,
  };
}

function guided(
  id = "33333333-3333-4333-8333-333333333333",
  status: LearningTaskView["status"] = "ready",
): GuidedInterventionTaskView {
  return {
    ...base(id, status),
    taskType: "guided_intervention",
    steps: [{ id: "step-1", kind: "explain", title: "Read", content: "Fixture" }],
  };
}

function retest(
  taskType: "d1_retest" | "d7_retest",
  status: LearningTaskView["status"] = "ready",
  id = taskType === "d1_retest"
    ? "44444444-4444-4444-8444-444444444444"
    : "55555555-5555-4555-8555-555555555555",
): D1RetestTaskView | D7RetestTaskView {
  return {
    ...base(id, status),
    taskType,
    item: {
      id: `${taskType}-item`,
      prompt: "Synthetic prompt",
      choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    },
  } as D1RetestTaskView | D7RetestTaskView;
}

function today(tasks: LearningTaskView[], currentTaskId: string | null): TodayTasksView {
  return { studentId, timeZone: "Asia/Tokyo", currentTaskId, tasks, overview };
}

describe("Today contract adapter", () => {
  it("preserves a server null current task without guessing from ready tasks", () => {
    const model = toTodayReadModel(today([guided(), retest("d1_retest")], null));
    expect(model.current).toEqual({ kind: "none" });
    expect(model.taskCount).toBe(2);
  });

  it.each([
    ["guided_intervention", guided()],
    ["d1_retest", retest("d1_retest")],
  ] as const)("selects only the server-referenced ready %s", (_, task) => {
    expect(toTodayReadModel(today([task], task.id)).current).toEqual({
      kind: "selected",
      task,
    });
  });

  it("returns a controlled error for a missing currentTaskId reference", () => {
    expect(toTodayReadModel(today([guided()], "66666666-6666-4666-8666-666666666666")).current)
      .toEqual({ kind: "contract_error", code: "CURRENT_TASK_NOT_FOUND" });
  });

  it.each(["scheduled", "completed"] as const)(
    "does not replace a server-referenced %s task",
    status => {
      const task = guided(undefined, status);
      expect(toTodayReadModel(today([task, retest("d1_retest")], task.id)).current)
        .toMatchObject({ kind: "contract_error", code: "CURRENT_TASK_NOT_READY", referencedTask: task });
    },
  );

  it("promotes a ready D7 reference as the server-selected current task", () => {
    const d7 = retest("d7_retest");
    expect(toTodayReadModel(today([d7, guided()], d7.id)).current).toMatchObject({
      kind: "selected",
      task: d7,
    });
  });

  it("preserves the shared D1/D7 discriminants in the read-only list", () => {
    const model = toTodayReadModel(today([
      retest("d1_retest", "scheduled"),
      retest("d7_retest", "completed"),
    ], null));
    expect(model.retests.map(task => [task.taskType, task.status])).toEqual([
      ["d1_retest", "scheduled"],
      ["d7_retest", "completed"],
    ]);
  });

  it("requires overview in explicit API mode instead of allowing a Mock fallback", () => {
    const withoutOverview = { ...today([], null) };
    delete withoutOverview.overview;
    expect(() => toTodayReadModel(withoutOverview)).toThrow(TodayOverviewContractError);
  });

  it("keeps overview facts unchanged for the rendering boundary", () => {
    const model = toTodayReadModel(today([], null));
    expect(model.overview).toBe(overview);
  });

  it("formats task dates only in the response time zone", () => {
    expect(formatTaskDateTime(scheduledFor, "Asia/Tokyo")).toContain("21:00");
    expect(formatTaskDateTime(scheduledFor, "America/New_York")).toContain("08:00");
    expect(() => formatTaskDateTime(scheduledFor, "Not/A_TimeZone")).toThrow(RangeError);
  });

  it("rejects an unusable response time zone even when the task list is empty", () => {
    expect(() => toTodayReadModel({
      studentId,
      timeZone: "Not/A_TimeZone",
      currentTaskId: null,
      tasks: [],
    })).toThrow(RangeError);
  });
});
