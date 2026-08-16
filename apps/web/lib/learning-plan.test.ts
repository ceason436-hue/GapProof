import { describe, expect, it } from "vitest";
import type { TodayTasksView } from "@gapproof/contracts";
import { buildLearningPlan, planTaskLabel, planTaskStatus } from "./learning-plan";

const view: TodayTasksView = {
  studentId: "11111111-1111-4111-8111-111111111111",
  timeZone: "Asia/Shanghai",
  currentTaskId: "22222222-2222-4222-8222-222222222222",
  profile: { studentId: "11111111-1111-4111-8111-111111111111", version: 1, completed: true, grade: "8", subject: "english", term: "first_term", region: "shanghai", learningState: "steady", timeZone: "Asia/Shanghai" },
  tasks: [{
    id: "22222222-2222-4222-8222-222222222222",
    caseId: "33333333-3333-4333-8333-333333333333",
    studentId: "11111111-1111-4111-8111-111111111111",
    taskType: "guided_intervention",
    status: "ready",
    title: "现在完成时练习",
    rationale: "确认动词形式",
    estimatedMinutes: 8,
    scheduledFor: "2026-08-16T16:30:00.000Z",
    dueAt: null,
    completedAt: null,
    steps: [{ id: "step-1", kind: "explain", title: "先看例子", content: "比较两个句子。" }],
  }],
};

describe("learning plan projection", () => {
  it("groups authoritative tasks into the student's next seven local days", () => {
    const days = buildLearningPlan(view, new Date("2026-08-16T04:00:00.000Z"));
    expect(days).toHaveLength(7);
    expect(days[1]).toMatchObject({ localDate: "2026-08-17", totalMinutes: 8, completedCount: 0 });
    expect(days[1]?.tasks[0]?.id).toBe(view.currentTaskId);
  });

  it("uses student-facing task and status labels without claiming mastery", () => {
    const task = view.tasks[0]!;
    expect(planTaskLabel(task)).toBe("重点练习");
    expect(planTaskStatus(task)).toBe("现在可做");
  });
});
