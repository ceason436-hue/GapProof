import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { QuestionArchiveViewSchema } from "./api.ts";

if (!FormatRegistry.Has("uuid")) FormatRegistry.Set("uuid", value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
if (!FormatRegistry.Has("date-time")) FormatRegistry.Set("date-time", value => !Number.isNaN(Date.parse(value)));

describe("question archive contract", () => {
  it("contains confirmed question text and task facts without private scoring fields", () => {
    const view = {
      timeZone: "Asia/Shanghai",
      items: [{
        entryRef: "0198b111-1111-7000-8000-000000000001:0",
        source: "real_uploaded_material",
        sourceTitle: "英语练习",
        confirmedAt: "2026-08-16T04:00:00.000Z",
        prompt: "Choose the correct tense.",
        studentAnswer: "go",
        tasks: [{
          taskId: "0198b111-1111-7000-8000-000000000010",
          taskType: "d1_retest",
          status: "ready",
          title: "明日复习",
          scheduledFor: "2026-08-16T04:00:00.000Z",
          dueAt: null,
          completedAt: null,
        }],
      }],
    };
    expect(Value.Check(QuestionArchiveViewSchema, view)).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/expectedChoiceId|confidence|objectKey|sha256|token/i);
  });

  it("rejects extra answer-key or confidence data", () => {
    const base = {
      entryRef: "entry:0", source: "real_uploaded_material", sourceTitle: "练习",
      confirmedAt: "2026-08-16T04:00:00.000Z", prompt: "Question", studentAnswer: null, tasks: [],
    };
    expect(Value.Check(QuestionArchiveViewSchema, { timeZone: "Asia/Shanghai", items: [{ ...base, expectedChoiceId: "a" }] })).toBe(false);
    expect(Value.Check(QuestionArchiveViewSchema, { timeZone: "Asia/Shanghai", items: [{ ...base, confidence: 0.99 }] })).toBe(false);
  });
});
