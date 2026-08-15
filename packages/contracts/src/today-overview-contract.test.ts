import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import { TodayOverviewSchema } from "./api.ts";

if (!FormatRegistry.Has("uuid")) {
  FormatRegistry.Set("uuid", (value) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}
if (!FormatRegistry.Has("date-time")) {
  FormatRegistry.Set("date-time", (value) => !Number.isNaN(Date.parse(value)));
}

const activityDays = Array.from({ length: 7 }, (_, index) => ({
  localDate: `2026-08-${String(9 + index).padStart(2, "0")}`,
  completedTaskCount: index === 6 ? 1 : 0,
}));

describe("Today overview contract", () => {
  it("accepts only factual, answer-free homepage projections", () => {
    const overview = {
      hasStartedJourney: true,
      activityDays,
      weeklyGoal: null,
      pendingConfirmationCount: 1,
      recentProgress: [{
        eventId: "0198b111-1111-7000-8000-000000000030",
        caseId: "0198b111-1111-7000-8000-000000000002",
        kind: "d1_passed",
        occurredAt: "2026-08-15T01:00:00.000Z",
      }],
      nextCheck: {
        taskId: "0198b111-1111-7000-8000-000000000021",
        taskType: "d7_retest",
        title: "D+7 延迟检查",
        scheduledFor: "2026-08-22T01:00:00.000Z",
        dueAt: "2026-08-22T13:00:00.000Z",
        estimatedMinutes: 5,
      },
    };
    expect([...Value.Errors(TodayOverviewSchema, overview)]).toEqual([]);
  });

  it("rejects invented goals, answer leakage, and non-retest next checks", () => {
    expect(Value.Check(TodayOverviewSchema, {
      hasStartedJourney: false,
      activityDays,
      weeklyGoal: { targetDays: 0, completedDays: 0 },
      pendingConfirmationCount: 0,
      recentProgress: [],
      nextCheck: null,
    })).toBe(false);

    expect(Value.Check(TodayOverviewSchema, {
      hasStartedJourney: false,
      activityDays,
      weeklyGoal: null,
      pendingConfirmationCount: 0,
      recentProgress: [{
        eventId: "0198b111-1111-7000-8000-000000000030",
        caseId: "0198b111-1111-7000-8000-000000000002",
        kind: "d1_passed",
        occurredAt: "2026-08-15T01:00:00.000Z",
        expectedChoiceId: "choice-written",
      }],
      nextCheck: null,
    })).toBe(false);

    expect(Value.Check(TodayOverviewSchema, {
      hasStartedJourney: false,
      activityDays,
      weeklyGoal: null,
      pendingConfirmationCount: 0,
      recentProgress: [],
      nextCheck: {
        taskId: "0198b111-1111-7000-8000-000000000021",
        taskType: "guided_intervention",
        title: "继续学习",
        scheduledFor: "2026-08-15T01:00:00.000Z",
        dueAt: null,
        estimatedMinutes: 5,
      },
    })).toBe(false);
  });
});
