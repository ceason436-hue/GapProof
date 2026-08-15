import { describe, expect, it } from "vitest";
import { d1AttemptResultCopy } from "./d1-attempt-panel";

describe("D1 attempt result mapping", () => {
  it("maps support_required to bounded human-help copy without a learning claim", () => {
    const result = d1AttemptResultCopy("support_required", false);
    expect(result.title).toBe("需要老师或家长协助");
    expect(result.detail).toContain("同一 Case 已达到最多两次自动重排上限");
    expect(result.detail).toContain("停止自动重排");
    expect(result.detail).not.toContain("已掌握");
    expect(result.detail).not.toContain("个性化");
  });

  it("keeps existing D+7 and replan result meanings", () => {
    expect(d1AttemptResultCopy("d7_scheduled", true)).toEqual({ title: "D+7 已安排", detail: null });
    expect(d1AttemptResultCopy("replan_required", false)).toEqual({
      title: "正在调整接下来的计划",
      detail: "服务端正在等待异步任务处理；当前不会宣称已形成真实个性化调整。",
    });
  });
});
