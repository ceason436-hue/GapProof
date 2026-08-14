import type { D1RetestTaskView, D7RetestTaskView } from "@gapproof/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RetestCard } from "./live-today";

vi.mock("server-only", () => ({}));

function retest(
  taskType: "d1_retest" | "d7_retest",
  status: "scheduled" | "ready" | "completed",
): D1RetestTaskView | D7RetestTaskView {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    caseId: "22222222-2222-4222-8222-222222222222",
    studentId: "11111111-1111-4111-8111-111111111111",
    taskType,
    title: `${taskType} 检查`,
    rationale: "synthetic contract fixture",
    status,
    scheduledFor: "2026-08-16T12:00:00.000Z",
    dueAt: "2026-08-16T13:00:00.000Z",
    completedAt: status === "completed" ? "2026-08-16T13:05:00.000Z" : null,
    estimatedMinutes: 5,
    item: {
      id: "synthetic-item",
      prompt: "Synthetic prompt",
      choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    },
  } as D1RetestTaskView | D7RetestTaskView;
}

describe("D+1/D+7 read-only cards", () => {
  it.each([
    ["d1_retest", "scheduled"], ["d1_retest", "ready"], ["d1_retest", "completed"],
    ["d7_retest", "scheduled"], ["d7_retest", "ready"], ["d7_retest", "completed"],
  ] as const)("has no submission entry for %s %s", (taskType, status) => {
    const html = renderToStaticMarkup(createElement(RetestCard, {
      retest: retest(taskType, status),
      timeZone: "Asia/Tokyo",
    }));
    expect(html).toContain("disabled");
    expect(html).toContain("21:00");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("/attempts");
    expect(html).not.toContain("href=");
  });

  it("labels ready D1 as a future integration and D7 as read-only", () => {
    const d1 = renderToStaticMarkup(createElement(RetestCard, {
      retest: retest("d1_retest", "ready"), timeZone: "Asia/Tokyo",
    }));
    const d7 = renderToStaticMarkup(createElement(RetestCard, {
      retest: retest("d7_retest", "ready"), timeZone: "Asia/Tokyo",
    }));
    expect(d1).toContain("作答接入下一阶段");
    expect(d7).toContain("D+7 检查只读");
    expect(d7).toContain("只读待接入");
    expect(d7).not.toContain("可以检查");
  });
});
