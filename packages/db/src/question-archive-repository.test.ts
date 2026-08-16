import { describe, expect, it } from "vitest";
import { reconstructConfirmedMaterialItems } from "./question-archive-repository.ts";

describe("question archive reconstruction", () => {
  it("keeps only confirmed real extraction items and applies student corrections", () => {
    expect(reconstructConfirmedMaterialItems(
      { extraction: { items: [{ itemId: "one", prompt: "OCR prompt" }, { itemId: "two", prompt: "excluded" }] } },
      { confirmedItemIds: ["one"], corrections: [{ itemId: "one", field: "prompt", value: "Confirmed prompt" }, { itemId: "one", field: "student_answer", value: "my answer" }] },
    )).toEqual([{ prompt: "Confirmed prompt", studentAnswer: "my answer" }]);
  });

  it("projects student-reviewed page splits as separate archive questions", () => {
    expect(reconstructConfirmedMaterialItems(
      { extraction: { items: [{ itemId: "page-1", prompt: "整页 OCR 文字" }] } },
      {
        confirmedItemIds: ["page-1"],
        corrections: [],
        reviewedQuestions: [
          { sourceItemId: "page-1", prompt: "  第一题  ", studentAnswer: "  A  " },
          { sourceItemId: "page-1", prompt: "第二题", studentAnswer: null },
        ],
      },
    )).toEqual([
      { prompt: "第一题", studentAnswer: "A" },
      { prompt: "第二题", studentAnswer: null },
    ]);
  });

  it("fails closed on unknown, duplicate, or malformed confirmation data", () => {
    const extraction = { extraction: { items: [{ itemId: "one", prompt: "Prompt" }] } };
    expect(reconstructConfirmedMaterialItems(extraction, { confirmedItemIds: ["missing"], corrections: [] })).toBeUndefined();
    expect(reconstructConfirmedMaterialItems(extraction, { confirmedItemIds: ["one", "one"], corrections: [] })).toBeUndefined();
    expect(reconstructConfirmedMaterialItems(extraction, { confirmedItemIds: ["one"], corrections: [{ itemId: "other", field: "prompt", value: "x" }] })).toBeUndefined();
    expect(reconstructConfirmedMaterialItems(extraction, { confirmedItemIds: ["one"], corrections: [], reviewedQuestions: [{ sourceItemId: "other", prompt: "题目", studentAnswer: null }] })).toBeUndefined();
    expect(reconstructConfirmedMaterialItems(
      { extraction: { items: [{ itemId: "one", prompt: "One" }, { itemId: "two", prompt: "Two" }] } },
      { confirmedItemIds: ["one", "two"], corrections: [], reviewedQuestions: [{ sourceItemId: "one", prompt: "只有第一题", studentAnswer: null }] },
    )).toBeUndefined();
  });
});
