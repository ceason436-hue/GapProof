import type { LearningTaskView, TodayTasksView } from "@gapproof/contracts";
import { describe, expect, it } from "vitest";
import { findMistakeBookEntry, taskKindLabel, toMistakeBookEntries } from "./mistake-book";

function task(id: string, status: LearningTaskView["status"], scheduledFor: string, completedAt: string | null = null): LearningTaskView {
  return { id, caseId: "0198b111-1111-7000-8000-000000000001", studentId: "0198b111-1111-7000-8000-000000000002", taskType: "d1_retest", status, title: `task-${id}`, rationale: "retest", estimatedMinutes: 4, scheduledFor, dueAt: null, completedAt, item: { id: "item-1", prompt: "Choose one", choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }] } };
}

function view(tasks: LearningTaskView[]): TodayTasksView {
  return { studentId: "0198b111-1111-7000-8000-000000000002", timeZone: "Asia/Shanghai", currentTaskId: null, tasks, profile: { studentId: "0198b111-1111-7000-8000-000000000002", grade: "8", subject: "english", term: "first_term", region: "shanghai", learningState: "steady", timeZone: "Asia/Shanghai", version: 1, completed: true } };
}

describe("mistake book read model", () => {
  it("uses authoritative task status to expose practice, review, and waiting actions", () => {
    const entries = toMistakeBookEntries(view([
      task("0198b111-1111-7000-8000-000000000011", "scheduled", "2026-08-18T00:00:00.000Z"),
      task("0198b111-1111-7000-8000-000000000012", "completed", "2026-08-15T00:00:00.000Z", "2026-08-16T00:00:00.000Z"),
      task("0198b111-1111-7000-8000-000000000013", "ready", "2026-08-17T00:00:00.000Z"),
    ]));
    expect(entries.map(entry => [entry.task.id, entry.action])).toEqual([
      ["0198b111-1111-7000-8000-000000000013", "practice"],
      ["0198b111-1111-7000-8000-000000000012", "review"],
      ["0198b111-1111-7000-8000-000000000011", "waiting"],
    ]);
  });

  it("finds only entries present in the current student's response", () => {
    const data = view([task("0198b111-1111-7000-8000-000000000021", "completed", "2026-08-15T00:00:00.000Z")]);
    expect(findMistakeBookEntry(data, "0198b111-1111-7000-8000-000000000021")?.action).toBe("review");
    expect(findMistakeBookEntry(data, "0198b111-1111-7000-8000-000000000099")).toBeNull();
    expect(taskKindLabel(data.tasks[0]!)).toBe("明日复习");
  });
});
