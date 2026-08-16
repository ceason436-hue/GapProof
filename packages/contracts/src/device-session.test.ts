import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import { RecoverableOcrBatchViewSchema } from "./device-session.ts";

const id = "0198c111-1111-7000-8000-000000000001";
if (!FormatRegistry.Has("uuid")) FormatRegistry.Set("uuid", value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
if (!FormatRegistry.Has("date-time")) FormatRegistry.Set("date-time", value => !Number.isNaN(Date.parse(value)));

describe("device-session OCR recovery contract", () => {
  it("accepts a failed batch with an explicit retry recovery state", () => {
    expect(Value.Check(RecoverableOcrBatchViewSchema, {
      batchId: id,
      caseId: id,
      status: "failed",
      pageCount: 2,
      resumeKind: "retry",
      updatedAt: "2026-08-16T08:00:00.000Z",
    })).toBe(true);
  });
});
