import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  CURRENT_ACTIONABLE_TASK_TYPE_PRIORITY,
  D1RetestAttemptViewSchema,
  LearningTaskViewSchema,
  SubmitD1RetestAttemptRequestSchema,
  TodayTasksViewSchema,
} from "./api.ts";

if (!FormatRegistry.Has("uuid")) {
  FormatRegistry.Set("uuid", (value) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}
if (!FormatRegistry.Has("date-time")) {
  FormatRegistry.Set("date-time", (value) => !Number.isNaN(Date.parse(value)));
}

const baseTask = {
  id: "0198b111-1111-7000-8000-000000000001",
  caseId: "0198b111-1111-7000-8000-000000000002",
  studentId: "0198b111-1111-7000-8000-000000000003",
  status: "ready",
  title: "明天用一道新题检查",
  rationale: "合成 D1 复测。",
  estimatedMinutes: 5,
  scheduledFor: "2026-08-16T00:00:00.000Z",
  dueAt: "2026-08-16T12:00:00.000Z",
  completedAt: null,
};

describe("D1 retest HTTP contracts", () => {
  it("freezes the server-side actionable task type tie-break order", () => {
    expect(CURRENT_ACTIONABLE_TASK_TYPE_PRIORITY).toEqual([
      "d1_retest",
      "d7_retest",
      "guided_intervention",
    ]);
  });
  it("requires the frozen objective-attempt request fields", () => {
    expect(Value.Check(SubmitD1RetestAttemptRequestSchema, {
      expectedVersion: 6,
      itemId: "synthetic-d1-item-v1",
      selectedChoiceId: "choice-written",
    })).toBe(true);
    expect(Value.Check(SubmitD1RetestAttemptRequestSchema, {
      expectedVersion: 6,
      selectedChoiceId: "choice-written",
    })).toBe(false);
  });

  it("uses a discriminated retest item and rejects answer leakage", () => {
    const publicTask = {
      ...baseTask,
      taskType: "d1_retest",
      item: {
        id: "synthetic-d1-item-v1",
        prompt: "Mina has ___ three notes this week.",
        choices: [
          { id: "choice-wrote", label: "wrote" },
          { id: "choice-written", label: "written" },
        ],
      },
    };
    expect(Value.Check(LearningTaskViewSchema, publicTask)).toBe(true);
    expect(Value.Check(LearningTaskViewSchema, {
      ...publicTask,
      steps: [{ id: "fake", kind: "guided_practice", title: "x", content: "y" }],
    })).toBe(false);
    expect(Value.Check(LearningTaskViewSchema, {
      ...publicTask,
      item: { ...publicTask.item, expectedChoiceId: "choice-written" },
    })).toBe(false);
  });

  it("freezes currentTaskId and the success response without an answer key", () => {
    const d1Task = {
      ...baseTask,
      taskType: "d1_retest",
      item: {
        id: "synthetic-d1-item-v1",
        prompt: "Mina has ___ three notes this week.",
        choices: [
          { id: "choice-wrote", label: "wrote" },
          { id: "choice-written", label: "written" },
        ],
      },
    };
    expect(Value.Check(TodayTasksViewSchema, {
      studentId: baseTask.studentId,
      timeZone: "Asia/Shanghai",
      currentTaskId: baseTask.id,
      tasks: [d1Task],
    })).toBe(true);
    expect(Value.Check(TodayTasksViewSchema, {
      studentId: baseTask.studentId,
      currentTaskId: baseTask.id,
      tasks: [d1Task],
    })).toBe(false);
    expect(Value.Check(D1RetestAttemptViewSchema, {
      attemptId: "0198b111-1111-7000-8000-000000000004",
      caseId: baseTask.caseId,
      taskId: baseTask.id,
      itemId: d1Task.item.id,
      selectedChoiceId: "choice-written",
      passed: false,
      scoringMethod: "exact-choice-v1",
      state: "replan_required",
      stateVersion: 7,
      completedTask: { ...d1Task, status: "completed", completedAt: "2026-08-16T01:00:00.000Z" },
      scheduledRetest: null,
    })).toBe(true);
  });
});
