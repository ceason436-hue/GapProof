import { describe, expect, it } from "vitest";
import { reconstructConfirmedMaterialItems } from "./question-archive-repository.ts";

describe("question archive reconstruction", () => {
  it("keeps only confirmed real extraction items and applies student corrections", () => {
    expect(reconstructConfirmedMaterialItems(
      { extraction: { items: [{ itemId: "one", prompt: "OCR prompt" }, { itemId: "two", prompt: "excluded" }] } },
      { confirmedItemIds: ["one"], corrections: [{ itemId: "one", field: "prompt", value: "Confirmed prompt" }, { itemId: "one", field: "student_answer", value: "my answer" }] },
    )).toEqual([{ prompt: "Confirmed prompt", studentAnswer: "my answer" }]);
  });

  it("fails closed on unknown, duplicate, or malformed confirmation data", () => {
    const extraction = { extraction: { items: [{ itemId: "one", prompt: "Prompt" }] } };
    expect(reconstructConfirmedMaterialItems(extraction, { confirmedItemIds: ["missing"], corrections: [] })).toBeUndefined();
    expect(reconstructConfirmedMaterialItems(extraction, { confirmedItemIds: ["one", "one"], corrections: [] })).toBeUndefined();
    expect(reconstructConfirmedMaterialItems(extraction, { confirmedItemIds: ["one"], corrections: [{ itemId: "other", field: "prompt", value: "x" }] })).toBeUndefined();
  });
});
