import { describe, expect, it } from "vitest";

import type { DiagnosticProbeDraft } from "@gapproof/contracts";

import { ProbeScoringError, scoreProbeAttempt } from "./probe-scoring.ts";

const probe: DiagnosticProbeDraft = {
  id: "probe-present-perfect-form-v1",
  prompt: "Mina has ___ three short notes this week.",
  choices: [
    { id: "choice-write", label: "write" },
    { id: "choice-wrote", label: "wrote" },
    { id: "choice-written", label: "written" },
  ],
  testedHypothesisIds: [
    "hyp-participle-form-gap",
    "hyp-auxiliary-meaning-confusion",
  ],
  expectedChoiceId: "choice-written",
  scoringRule: {
    method: "exact_choice_v1",
    choiceOutcomes: [
      {
        choiceId: "choice-write",
        selectedHypothesisId: "hyp-auxiliary-meaning-confusion",
      },
      {
        choiceId: "choice-wrote",
        selectedHypothesisId: "hyp-participle-form-gap",
      },
      { choiceId: "choice-written", selectedHypothesisId: null },
    ],
  },
};

describe("deterministic probe scoring", () => {
  it("scores the expected choice as passed without inventing a root cause", () => {
    expect(scoreProbeAttempt(probe, "choice-written")).toEqual({
      passed: true,
      selectedHypothesisId: null,
      scoringMethod: "exact_choice_v1",
    });
  });

  it("maps an incorrect choice to the configured competing hypothesis", () => {
    expect(scoreProbeAttempt(probe, "choice-wrote")).toEqual({
      passed: false,
      selectedHypothesisId: "hyp-participle-form-gap",
      scoringMethod: "exact_choice_v1",
    });
  });

  it("rejects choices that are not part of the stored probe", () => {
    expect(() => scoreProbeAttempt(probe, "choice-injected")).toThrowError(
      ProbeScoringError,
    );
  });
});
