import { describe, expect, it } from "vitest";
import { createMistakeReviewRequest, createMistakeReviewResponseRequest } from "./mistake-review";

describe("mistake review request boundary", () => {
  it("accepts only the opaque archive reference", () => {
    expect(createMistakeReviewRequest("opaque-entry-ref")).toEqual({ entryRef: "opaque-entry-ref" });
    expect(createMistakeReviewRequest("")).toBeNull();
  });

  it("requires a non-empty learner reflection and keeps it answer-key free", () => {
    expect(createMistakeReviewResponseRequest("  我会先找题目条件。 ")).toEqual({ responseText: "我会先找题目条件。" });
    expect(createMistakeReviewResponseRequest(" ")).toBeNull();
    expect(JSON.stringify(createMistakeReviewResponseRequest("我自己的想法"))).not.toMatch(/expectedChoiceId|answerKey|confidence/i);
  });
});
