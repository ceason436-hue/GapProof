import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import { StudentFactReportsViewSchema, StudentProgressViewSchema } from "./progress-report.ts";

const studentId = "0198b111-1111-7000-8000-000000000002";
const caseId = "0198b111-1111-7000-8000-000000000003";
if (!FormatRegistry.Has("uuid")) FormatRegistry.Set("uuid", (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
if (!FormatRegistry.Has("date-time")) FormatRegistry.Set("date-time", (value) => !Number.isNaN(Date.parse(value)));

describe("student progress and fact report contracts", () => {
  it("requires explicit provenance for progress records", () => {
    const view = {
      studentId,
      timeZone: "Asia/Shanghai",
      goals: [{ caseId, title: "一项学习目标", source: "synthetic_experience", stage: "retesting", updatedAt: "2026-08-16T00:00:00.000Z", completedTaskCount: 1, nextTask: null }],
      timeline: [],
    };
    expect(Value.Check(StudentProgressViewSchema, view)).toBe(true);
    expect(Value.Check(StudentProgressViewSchema, { ...view, goals: [{ ...view.goals[0], source: "unknown" }] })).toBe(false);
  });

  it("accepts only authoritative report conclusions", () => {
    const report = { caseId, title: "一项学习目标", source: "real_material", conclusion: "repair_verified", d1Result: "passed", d7Result: "passed", completedTaskCount: 3, evidenceThrough: "2026-08-16T00:00:00.000Z" };
    expect(Value.Check(StudentFactReportsViewSchema, { studentId, timeZone: "Asia/Shanghai", reports: [report] })).toBe(true);
    expect(Value.Check(StudentFactReportsViewSchema, { studentId, timeZone: "Asia/Shanghai", reports: [{ ...report, conclusion: "d7_scheduled" }] })).toBe(false);
  });
});
