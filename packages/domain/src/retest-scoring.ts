export interface SingleChoiceRetestScoringInput {
  readonly itemId: string;
  readonly selectedChoiceId: string;
  readonly expectedChoiceId: string;
  readonly availableChoiceIds: readonly string[];
}

export interface SingleChoiceRetestScore {
  readonly passed: boolean;
  readonly scoringMethod: "exact-choice-v1";
}

export class RetestScoringError extends Error {
  readonly code = "INVALID_RETEST_CHOICE";

  constructor(itemId: string, choiceId: string) {
    super(`INVALID_RETEST_CHOICE: ${choiceId} is not available for ${itemId}.`);
    this.name = "RetestScoringError";
  }
}

export function scoreSingleChoiceRetest(
  input: SingleChoiceRetestScoringInput,
): SingleChoiceRetestScore {
  if (!input.availableChoiceIds.includes(input.selectedChoiceId)) {
    throw new RetestScoringError(input.itemId, input.selectedChoiceId);
  }
  return {
    passed: input.selectedChoiceId === input.expectedChoiceId,
    scoringMethod: "exact-choice-v1",
  };
}
