import type { D1RetestTaskView, D7RetestTaskView, TodayOverview } from "@gapproof/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FirstUseToday, OverviewNextCheck, RetestCard, TodayOverviewPanel } from "./live-today";

vi.mock("server-only", () => ({}));
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => createElement("img", { alt }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/student/today" }));

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

describe("D+1/D+7 status cards", () => {
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

  it("labels ready D1 and D7 as available in the current task area", () => {
    const d1 = renderToStaticMarkup(createElement(RetestCard, {
      retest: retest("d1_retest", "ready"), timeZone: "Asia/Tokyo",
    }));
    const d7 = renderToStaticMarkup(createElement(RetestCard, {
      retest: retest("d7_retest", "ready"), timeZone: "Asia/Tokyo",
    }));
    expect(d1).toContain("可以开始");
    expect(d1).toContain("现在可以作答");
    expect(d1).toContain("开始复习");
    expect(d7).toContain("可以开始");
    expect(d7).toContain("开始巩固");
    expect(`${d1}${d7}`).not.toMatch(/D\+1|D\+7|服务端|ready D/);
  });
});

const overview: TodayOverview = {
  hasStartedJourney: true,
  activityDays: Array.from({ length: 7 }, (_, index) => ({
    localDate: `2026-08-${String(10 + index).padStart(2, "0")}`,
    completedTaskCount: index === 6 ? 2 : index === 5 ? 1 : 0,
  })),
  weeklyGoal: { targetDays: 5, completedDays: 2 },
  pendingConfirmationCount: 2,
  recentProgress: [{
    eventId: "0198b111-1111-7000-8000-000000000030",
    caseId: "22222222-2222-4222-8222-222222222222",
    kind: "practice_completed",
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

describe("Today overview projection", () => {
  it("renders only service facts and neutral progress copy", () => {
    const html = renderToStaticMarkup(createElement(TodayOverviewPanel, { overview }));
    expect(html).toContain('data-local-date="2026-08-16"');
    expect(html).toContain('data-pending-confirmations="2"');
    expect(html).toContain("2 / 5 天");
    expect(html).toContain("完成了一次练习");
    expect(html).not.toContain("eventId");
    expect(html).not.toContain("caseId");
    expect(html).not.toContain("已掌握");
  });

  it("keeps a D7 next check read-only and handles no check", () => {
    const d7 = renderToStaticMarkup(createElement(OverviewNextCheck, { nextCheck: overview.nextCheck, timeZone: "Asia/Tokyo" }));
    expect(d7).toContain("7 天后巩固");
    expect(d7).toContain("disabled");
    const none = renderToStaticMarkup(createElement(OverviewNextCheck, { nextCheck: null, timeZone: "Asia/Tokyo" }));
    expect(none).toContain("暂无已安排检查");
  });

  it("does not invent activity or progress for a new-user overview", () => {
    const empty: TodayOverview = {
      ...overview,
      hasStartedJourney: false,
      activityDays: overview.activityDays.map(day => ({ ...day, completedTaskCount: 0 })),
      weeklyGoal: null,
      pendingConfirmationCount: 0,
      recentProgress: [],
      nextCheck: null,
    };
    const html = renderToStaticMarkup(createElement(TodayOverviewPanel, { overview: empty }));
    expect(html).toContain("目标待设置");
    expect(html).toContain("当前没有待确认事项");
    expect(html).toContain("暂无新的学习进展");
    expect(html).not.toContain("坚持");
    expect(html).not.toContain("2 / 5 天");
  });
});

describe("FirstUseToday", () => {
  it("offers both truthful first-use entry points", () => {
    const html = renderToStaticMarkup(createElement(FirstUseToday));
    expect(html).toContain("上传错题或作业");
    expect(html).toContain("没有材料，先做 3 道题");
    expect(html).toContain("当前上传流程使用演示识别内容");
    expect(html).toContain("不保存为正式学习记录");
    expect(html).not.toContain("服务端返回空任务列表");
    expect(html).not.toMatch(/合成 Demo|真实 API|Mock|Case/);
  });
});
