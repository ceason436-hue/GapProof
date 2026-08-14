import { describe, expect, it } from "vitest";

import { scoreSingleChoiceRetest } from "./retest-scoring.ts";

describe("single-choice exact-choice-v1 retest scoring", () => {
  it("passes only an exact private answer match", () => {
    expect(scoreSingleChoiceRetest({
      itemId: "synthetic-d1-item-v1",
      selectedChoiceId: "choice-written",
      expectedChoiceId: "choice-written",
      availableChoiceIds: ["choice-wrote", "choice-written"],
    })).toEqual({ passed: true, scoringMethod: "exact-choice-v1" });
    expect(scoreSingleChoiceRetest({
      itemId: "synthetic-d1-item-v1",
      selectedChoiceId: "choice-wrote",
      expectedChoiceId: "choice-written",
      availableChoiceIds: ["choice-wrote", "choice-written"],
    }).passed).toBe(false);
  });

  it("rejects choices outside the private item", () => {
    expect(() => scoreSingleChoiceRetest({
      itemId: "synthetic-d1-item-v1",
      selectedChoiceId: "choice-not-present",
      expectedChoiceId: "choice-written",
      availableChoiceIds: ["choice-wrote", "choice-written"],
    })).toThrow("INVALID_RETEST_CHOICE");
  });
});
