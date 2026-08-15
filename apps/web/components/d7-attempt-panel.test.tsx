import { describe, expect, it } from "vitest";
import { d7AttemptResultCopy } from "./d7-attempt-panel";

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
});
