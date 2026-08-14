import { describe, expect, it } from "vitest";
import { getMockTodayView } from "./mock-adapter";

describe("today mock adapter", () => {
  it("defaults to the labelled synthetic regular state", () => {
    expect(getMockTodayView().mode).toBe("regular");
    expect(getMockTodayView().summary).toContain("合成演示");
  });
  it("does not invent history for a new user", () => {
    const view = getMockTodayView("new");
    expect(view.greeting).toBe("欢迎来到知隙");
    expect(view.summary).not.toContain("坚持");
  });
  it("falls back safely for an unknown mode", () => expect(getMockTodayView("other").mode).toBe("regular"));
});
