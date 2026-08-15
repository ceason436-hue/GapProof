import { describe, expect, it } from "vitest";

import {
  scoreSyntheticQuickCheck,
  SyntheticQuickCheckInputError,
  syntheticQuickCheckView,
} from "./synthetic-quick-check.ts";

describe("synthetic quick check", () => {
  it("keeps answer keys private and returns three original questions", () => {
    const view = syntheticQuickCheckView();
    expect(view.questions).toHaveLength(3);
    expect(JSON.stringify(view)).not.toContain("expectedChoiceId");
    expect(view).toMatchObject({ mode: "synthetic_demo", source: "original_fixture" });
  });

  it("scores deterministically without creating a learning record or report", () => {
    const result = scoreSyntheticQuickCheck({ answers: [
      { itemId: "quick-check-participle-v1", selectedChoiceId: "choice-wrote" },
      { itemId: "quick-check-past-v1", selectedChoiceId: "choice-went" },
      { itemId: "quick-check-passive-v1", selectedChoiceId: "choice-was-written" },
    ] });
    expect(result).toMatchObject({
      correctCount: 2,
      finding: "irregular_participle",
      learningRecordCreated: false,
      reportReady: false,
    });
  });

  it("rejects duplicate, missing, unknown-item, and unknown-choice answers", () => {
    const invalid = [
      { itemId: "quick-check-participle-v1", selectedChoiceId: "choice-written" },
      { itemId: "quick-check-participle-v1", selectedChoiceId: "choice-written" },
      { itemId: "quick-check-passive-v1", selectedChoiceId: "choice-was-written" },
    ];
    expect(() => scoreSyntheticQuickCheck({ answers: invalid })).toThrow(SyntheticQuickCheckInputError);
    expect(() => scoreSyntheticQuickCheck({ answers: [
      { itemId: "quick-check-participle-v1", selectedChoiceId: "not-a-choice" },
      { itemId: "quick-check-past-v1", selectedChoiceId: "choice-went" },
      { itemId: "quick-check-passive-v1", selectedChoiceId: "choice-was-written" },
    ] })).toThrow(SyntheticQuickCheckInputError);
  });
});
