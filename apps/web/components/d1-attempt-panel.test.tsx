import { describe, expect, it } from "vitest";
import { d1AttemptResultCopy } from "./d1-attempt-panel";

describe("D1 attempt result mapping", () => {
  it("maps support_required to bounded human-help copy without a learning claim", () => {
    const result = d1AttemptResultCopy("support_required", false);
    expect(result.title).toBe("需要老师或家长协助");
    expect(result.detail).toContain("自动调整已达到上限");
    expect(result.detail).toContain("老师或家长");
    expect(result.detail).not.toContain("已掌握");
    expect(result.detail).not.toContain("个性化");
  });

  it("keeps the 7-day follow-up and replan result meanings in student language", () => {
    expect(d1AttemptResultCopy("d7_scheduled", true)).toEqual({ title: "7 天后巩固已安排", detail: null });
    expect(d1AttemptResultCopy("replan_required", false)).toEqual({
      title: "正在调整接下来的计划",
      detail: "新的安排还在准备中，请稍后回到今日页查看。",
    });
  });
});
