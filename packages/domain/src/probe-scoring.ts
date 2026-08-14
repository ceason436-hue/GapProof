import type { DiagnosticProbeDraft } from "@gapproof/contracts";

export type ProbeScoringErrorCode = "invalid_choice" | "invalid_rule";

export class ProbeScoringError extends Error {
  constructor(
    readonly code: ProbeScoringErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProbeScoringError";
  }
}

export interface ProbeScore {
  readonly passed: boolean;
  readonly selectedHypothesisId: string | null;
  readonly scoringMethod: "exact_choice_v1";
}

export function scoreProbeAttempt(
  probe: DiagnosticProbeDraft,
  selectedChoiceId: string,
): ProbeScore {
  const choiceIds = new Set(probe.choices.map(({ id }) => id));
  if (!choiceIds.has(selectedChoiceId)) {
    throw new ProbeScoringError(
      "invalid_choice",
      `Choice ${selectedChoiceId} does not belong to probe ${probe.id}.`,
    );
  }

  const outcomes = probe.scoringRule.choiceOutcomes;
  const outcomeChoiceIds = new Set(outcomes.map(({ choiceId }) => choiceId));
  const hypothesisIds = new Set(probe.testedHypothesisIds);
  const expectedOutcome = outcomes.find(
    ({ choiceId }) => choiceId === probe.expectedChoiceId,
  );

  if (
    !choiceIds.has(probe.expectedChoiceId) ||
    outcomes.length !== choiceIds.size ||
    outcomeChoiceIds.size !== choiceIds.size ||
    [...outcomeChoiceIds].some((choiceId) => !choiceIds.has(choiceId)) ||
    outcomes.some(
      ({ choiceId, selectedHypothesisId }) =>
        (choiceId === probe.expectedChoiceId
          ? selectedHypothesisId !== null
          : selectedHypothesisId === null) ||
        (selectedHypothesisId !== null &&
          !hypothesisIds.has(selectedHypothesisId)),
    ) ||
    expectedOutcome?.selectedHypothesisId !== null
  ) {
    throw new ProbeScoringError(
      "invalid_rule",
      `Probe ${probe.id} has an inconsistent deterministic scoring rule.`,
    );
  }

  const outcome = outcomes.find(
    ({ choiceId }) => choiceId === selectedChoiceId,
  );
  if (outcome === undefined) {
    throw new ProbeScoringError(
      "invalid_rule",
      `Probe ${probe.id} has no outcome for choice ${selectedChoiceId}.`,
    );
  }

  return {
    passed: selectedChoiceId === probe.expectedChoiceId,
    selectedHypothesisId: outcome.selectedHypothesisId,
    scoringMethod: probe.scoringRule.method,
  };
}
