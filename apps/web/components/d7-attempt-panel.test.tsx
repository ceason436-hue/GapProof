import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { D7UnknownAttemptRecovery, d7AttemptResultCopy, refreshAuthoritativeTodayAfterUnknownD7, refreshTodayAfterConfirmedD7Submit } from "./d7-attempt-panel";

describe("D7 attempt result mapping", () => {
  it.each([
    ["repair_verified", "第 7 天新题检查已通过", "只代表本次检查"],
    ["replan_required", "正在调整接下来的计划", "还需要再练习"],
    ["support_required", "需要老师或家长协助", "自动调整已达到上限"],
  ] as const)("maps %s without claims or private data", (state, title, detail) => {
    const result = d7AttemptResultCopy(state);
    expect(result.title).toBe(title);
    expect(result.detail).toContain(detail);
    expect(`${result.title} ${result.detail}`).not.toMatch(/报告|永久掌握|真实个性化|answerKey|scoringMethod|0198b111|服务端|Case/);
  });

  it("refreshes Today after a confirmed successful submission", () => {
    const refresh = vi.fn();
    refreshTodayAfterConfirmedD7Submit(refresh);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("reloads authoritative Today after an unknown result without submitting again", () => {
    const replace = vi.fn();
    const refresh = vi.fn();
    refreshAuthoritativeTodayAfterUnknownD7(replace, refresh);
    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("/student/today?source=api");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("renders an unknown-result recovery without a completion or resubmit claim", () => {
    const html = renderToStaticMarkup(createElement(D7UnknownAttemptRecovery, { onRefresh: vi.fn() }));
    expect(html).toContain('data-attempt-recovery="network-unknown"');
    expect(html).toContain("不会再次提交");
    expect(html).toContain("重新读取今日状态");
    expect(html).toContain('href="/student/today?source=api"');
    expect(html).not.toMatch(/已保存|已完成|提交本次选择/);
  });
});
