import { describe, expect, it } from "vitest";
import { resolveTodaySource } from "./today-source";

describe("Today entry source policy", () => {
  it("defaults to the live API", () => {
    expect(resolveTodaySource(undefined)).toBe("api");
  });

  it("keeps explicit API compatibility", () => {
    expect(resolveTodaySource("api")).toBe("api");
  });

  it("allows synthetic Mock only when explicitly requested", () => {
    expect(resolveTodaySource("mock")).toBe("mock");
    expect(resolveTodaySource("other")).toBe("api");
  });
});
