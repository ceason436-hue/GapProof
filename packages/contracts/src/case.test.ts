import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import { isRetestDueJobData } from "./api.ts";
import { CaseEventSchema } from "./case.ts";

describe("CaseEventSchema", () => {
  it("keeps demo clock audit events outside the Case reducer contract", () => {
    expect(
      Value.Check(CaseEventSchema, {
        eventId: "audit-demo-clock-1",
        occurredAt: "2026-08-15T00:00:00.000Z",
        type: "demo_clock_advanced",
        simulation: true,
        clockId: "0198b111-1111-7000-8000-000000000001",
      }),
    ).toBe(false);
  });

  it("rejects malformed retest.due payloads at runtime", () => {
    expect(
      isRetestDueJobData({
        caseId: "0198b111-1111-7000-8000-000000000001",
        taskId: "0198b111-1111-7000-8000-000000000002",
      }),
    ).toBe(true);
    expect(
      isRetestDueJobData({ caseId: "not-a-uuid", taskId: "not-a-uuid" }),
    ).toBe(false);
  });
});
