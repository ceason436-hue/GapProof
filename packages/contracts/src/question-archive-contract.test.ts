import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { ConfirmExtractionRequestSchema, MistakeReviewCompletionViewSchema, MistakeReviewTaskViewSchema, QuestionArchiveViewSchema } from "./api.ts";

if (!FormatRegistry.Has("uuid")) FormatRegistry.Set("uuid", value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
if (!FormatRegistry.Has("date-time")) FormatRegistry.Set("date-time", value => !Number.isNaN(Date.parse(value)));

describe("question archive contract", () => {
  it("accepts bounded student-reviewed question splits without internal identifiers", () => {
    expect(Value.Check(ConfirmExtractionRequestSchema, {
      expectedVersion: 1,
      confirmedItemIds: ["page-1"],
      corrections: [],
      reviewedQuestions: [
        { sourceItemId: "page-1", prompt: "第一题", studentAnswer: "A" },
        { sourceItemId: "page-1", prompt: "第二题", studentAnswer: null },
      ],
    })).toBe(true);
    expect(Value.Check(ConfirmExtractionRequestSchema, {
      expectedVersion: 1,
      confirmedItemIds: ["page-1"],
      corrections: [],
      reviewedQuestions: [{ sourceItemId: "page-1", prompt: "", studentAnswer: null, answerKey: "A" }],
    })).toBe(false);
  });

  it("contains confirmed question text and task facts without private scoring fields", () => {
    const view = {
      timeZone: "Asia/Shanghai",
      items: [{
        entryRef: "opaque_question_navigation_ref",
        source: "real_uploaded_material",
        sourceTitle: "英语练习",
        confirmedAt: "2026-08-16T04:00:00.000Z",
        prompt: "Choose the correct tense.",
        studentAnswer: "go",
        reviewReady: true,
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
      confirmedAt: "2026-08-16T04:00:00.000Z", prompt: "Question", studentAnswer: null, reviewReady: false, tasks: [],
    };
    expect(Value.Check(QuestionArchiveViewSchema, { timeZone: "Asia/Shanghai", items: [{ ...base, expectedChoiceId: "a" }] })).toBe(false);
    expect(Value.Check(QuestionArchiveViewSchema, { timeZone: "Asia/Shanghai", items: [{ ...base, confidence: 0.99 }] })).toBe(false);
  });

  it("allows a review task without any answer key or internal source fields", () => {
    const task = {
      id: "0198a111-1111-7111-8111-111111111111",
      caseId: "0198a111-1111-7222-8222-222222222222",
      studentId: "0198a111-1111-7333-8333-333333333333",
      status: "ready",
      title: "重新做一道错题",
      rationale: "先独立写出自己的思路。",
      estimatedMinutes: 8,
      scheduledFor: "2026-08-16T04:00:00.000Z",
      dueAt: null,
      completedAt: null,
      taskType: "mistake_review",
      prompt: "题干",
      originalAnswer: "A",
      reflectionPrompt: "你会怎么判断？",
      submittedResponse: null,
    };
    expect(Value.Check(MistakeReviewTaskViewSchema, task)).toBe(true);
    expect(Value.Check(MistakeReviewTaskViewSchema, { ...task, expectedChoiceId: "a" })).toBe(false);
    expect(Value.Check(MistakeReviewCompletionViewSchema, {
      taskId: task.id,
      status: "completed",
      completedAt: "2026-08-16T04:05:00.000Z",
      submittedResponse: "我会先看题目要求。",
    })).toBe(true);
  });
});
