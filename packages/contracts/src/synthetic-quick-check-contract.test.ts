import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  SubmitSyntheticQuickCheckRequestSchema,
  SyntheticQuickCheckResultSchema,
  SyntheticQuickCheckViewSchema,
} from "./api.ts";

describe("synthetic quick-check contracts", () => {
  it("requires exactly three public questions and answers", () => {
    const question = {
      itemId: "item-1",
      prompt: "Synthetic prompt",
      choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    };
    expect(Value.Check(SyntheticQuickCheckViewSchema, {
      mode: "synthetic_demo",
      source: "original_fixture",
      estimatedMinutes: 3,
      questions: [question, { ...question, itemId: "item-2" }, { ...question, itemId: "item-3" }],
    })).toBe(true);
    expect(Value.Check(SubmitSyntheticQuickCheckRequestSchema, {
      answers: [{ itemId: "item-1", selectedChoiceId: "a" }],
    })).toBe(false);
  });

  it("forbids learning-record and report claims", () => {
    const result = {
      mode: "synthetic_demo",
      source: "original_fixture",
      scoringMethod: "exact-choice-v1",
      correctCount: 2,
      totalCount: 3,
      finding: "past_tense",
      summary: "Synthetic summary",
      recommendation: "Synthetic next step",
      learningRecordCreated: false,
      reportReady: false,
    };
    expect(Value.Check(SyntheticQuickCheckResultSchema, result)).toBe(true);
    expect(Value.Check(SyntheticQuickCheckResultSchema, { ...result, reportReady: true })).toBe(false);
    expect(Value.Check(SyntheticQuickCheckResultSchema, { ...result, answerKey: "private" })).toBe(false);
  });
});
