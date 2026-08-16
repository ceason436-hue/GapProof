import type { QuestionArchiveItem, QuestionArchiveTaskFact } from "@gapproof/contracts";
import { describe, expect, it } from "vitest";
import { archiveTaskAction, findArchiveItem, selectArchiveTask, taskKindLabel } from "./mistake-book";

function task(status: QuestionArchiveTaskFact["status"], taskType: QuestionArchiveTaskFact["taskType"] = "d1_retest"): QuestionArchiveTaskFact {
  return { taskId: `0198b111-1111-7000-8000-00000000001${status === "ready" ? 1 : status === "scheduled" ? 2 : 3}`, taskType, status, title: "复习", scheduledFor: "2026-08-16T00:00:00.000Z", dueAt: null, completedAt: status === "completed" ? "2026-08-17T00:00:00.000Z" : null };
}

describe("question archive actions", () => {
  it("prefers an authoritative ready task and maps it to the existing submit path", () => {
    const selected = selectArchiveTask([task("completed"), task("scheduled"), task("ready")]);
    expect(selected?.status).toBe("ready");
    expect(archiveTaskAction(selected!)).toBe("开始复测");
    expect(archiveTaskAction(task("ready", "guided_intervention"))).toBe("继续当前任务");
  });

  it("does not describe completed or scheduled tasks as executable", () => {
    expect(archiveTaskAction(task("scheduled"))).toBe("查看复习安排");
    expect(archiveTaskAction(task("completed"))).toBe("查看任务记录");
    expect(taskKindLabel(task("ready", "d7_retest"))).toBe("7 天后巩固");
  });

  it("finds only a reference returned by the owned archive response", () => {
    const item = { entryRef: "case:0", source: "real_uploaded_material", sourceTitle: "练习", confirmedAt: "2026-08-16T00:00:00.000Z", prompt: "Question", studentAnswer: null, reviewReady: false, tasks: [] } satisfies QuestionArchiveItem;
    expect(findArchiveItem([item], "case:0")).toBe(item);
    expect(findArchiveItem([item], "another:0")).toBeNull();
  });
});
