import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GuidedTaskCompletion, toCaseErrorState, toSubmitErrorState } from "./guided-task-completion";

const task = {
  id: "0198b111-1111-7000-8000-000000000012",
  caseId: "0198b111-1111-7000-8000-000000000002",
  studentId: "0198b111-1111-7000-8000-000000000003",
  taskType: "guided_intervention" as const,
  status: "ready" as const,
  title: "合成引导任务",
  rationale: "受控组件 fixture",
  estimatedMinutes: 8,
  scheduledFor: "2026-08-16T00:00:00.000Z",
  dueAt: "2026-08-16T12:00:00.000Z",
  completedAt: null,
  steps: [
    { id: "step-1", kind: "explain" as const, title: "看一个例子", content: "先看步骤说明。" },
    { id: "step-2", kind: "worked_example" as const, title: "做一道确认题", content: "完成确认。" },
    { id: "step-3", kind: "guided_practice" as const, title: "换一道新题", content: "独立完成。" },
  ],
};

describe("GuidedTaskCompletion", () => {
  it("renders each step as an accessible confirmation control", () => {
    const html = renderToStaticMarkup(createElement(GuidedTaskCompletion, { task, timeZone: "Asia/Shanghai" }));
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("看一个例子");
    expect(html).toContain("完成本次引导任务");
    expect(html).toContain("逐项完成后再提交");
    expect(html).not.toContain("引导任务只读");
    expect(html).not.toContain("已掌握");
    expect(html).not.toContain("/api/v1/tasks/");
    expect(html).not.toContain("请求编号");
  });

  it("keeps Case sync failures separate from an unknown submitted result", () => {
    expect(toCaseErrorState(new TypeError("case read failed"))).toMatchObject({ kind: "case_error", code: "CASE_SYNC_FAILED" });
    expect(toSubmitErrorState(new TypeError("submit result unknown"))).toMatchObject({ kind: "error", code: "NETWORK_UNKNOWN" });
  });
});
