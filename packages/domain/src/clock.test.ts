import { describe, expect, it } from "vitest";

import { FixedClock, SystemClock } from "./clock.ts";

describe("Clock", () => {
  it("keeps a fixed instant stable and returns defensive Date values", () => {
    const clock = new FixedClock("2026-08-15T00:00:00.000Z");

    const first = clock.now();
    first.setUTCFullYear(2030);

    expect(clock.now().toISOString()).toBe("2026-08-15T00:00:00.000Z");
  });

  it("uses the system clock in production", () => {
    const before = Date.now();
    const observed = new SystemClock().now().getTime();
    const after = Date.now();

    expect(observed).toBeGreaterThanOrEqual(before);
    expect(observed).toBeLessThanOrEqual(after);
  });
});
