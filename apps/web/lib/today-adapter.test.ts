import type { LearningTaskView, TodayTasksView } from "@gapproof/contracts";
import { describe, expect, it } from "vitest";
import { toTodayReadModel } from "./today-adapter";

const studentId = "11111111-1111-4111-8111-111111111111";

function task(
  id: string,
  taskType: LearningTaskView["taskType"],
  status: LearningTaskView["status"],
): LearningTaskView {
  return {
    id,
    caseId: "22222222-2222-4222-8222-222222222222",
    studentId,
    taskType,
    status,
    title: `${taskType}-${status}`,
    rationale: "contract fixture",
    estimatedMinutes: 5,
    scheduledFor: "2026-08-16T01:00:00.000Z",
    dueAt: taskType === "d1_retest" ? "2026-08-16T01:00:00.000Z" : null,
    completedAt: status === "completed" ? "2026-08-16T01:05:00.000Z" : null,
    steps: [{ id: "step-1", kind: "explain", title: "Read", content: "Fixture" }],
  };
}

describe("Today contract adapter", () => {
  it("keeps an API empty result empty", () => {
    expect(toTodayReadModel({ studentId, tasks: [] })).toEqual({
      studentId,
      taskCount: 0,
      hasServerSelectedCurrentTask: false,
      retests: [],
    });
  });

  it("does not infer a current task from array order or status", () => {
    const view: TodayTasksView = {
      studentId,
      tasks: [
        task("33333333-3333-4333-8333-333333333333", "guided_intervention", "ready"),
        task("44444444-4444-4444-8444-444444444444", "d1_retest", "ready"),
      ],
    };
    expect(toTodayReadModel(view).hasServerSelectedCurrentTask).toBe(false);
  });

  it.each(["scheduled", "ready", "completed"] as const)(
    "keeps a %s D+1 task read-only",
    status => {
      const view = {
        studentId,
        tasks: [task("55555555-5555-4555-8555-555555555555", "d1_retest", status)],
      } satisfies TodayTasksView;
      expect(toTodayReadModel(view).retests).toEqual([
        expect.objectContaining({ status, submitAvailable: false }),
      ]);
    },
  );
});
