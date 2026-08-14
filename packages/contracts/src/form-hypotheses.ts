import { type Static, Type } from "@sinclair/typebox";

import { toolResultSchema } from "./tool.ts";

export const FormHypothesesInputSchema = Type.Object({
  observedPrompt: Type.String({ minLength: 1 }),
  observedAnswer: Type.String({ minLength: 1 }),
  confirmedEvidenceRefs: Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1,
    uniqueItems: true,
  }),
});

export type FormHypothesesInput = Static<typeof FormHypothesesInputSchema>;

export const HypothesisCandidateSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  explanation: Type.String({ minLength: 1 }),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  evidenceRefs: Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1,
    uniqueItems: true,
  }),
});

export type HypothesisCandidate = Static<typeof HypothesisCandidateSchema>;

export const DiagnosticProbeScoringRuleSchema = Type.Object({
  method: Type.Literal("exact_choice_v1"),
  choiceOutcomes: Type.Array(
    Type.Object({
      choiceId: Type.String({ minLength: 1 }),
      selectedHypothesisId: Type.Union([
        Type.String({ minLength: 1 }),
        Type.Null(),
      ]),
    }),
    { minItems: 2 },
  ),
});

export type DiagnosticProbeScoringRule = Static<
  typeof DiagnosticProbeScoringRuleSchema
>;

export const DiagnosticProbeDraftSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  prompt: Type.String({ minLength: 1 }),
  choices: Type.Array(
    Type.Object({
      id: Type.String({ minLength: 1 }),
      label: Type.String({ minLength: 1 }),
    }),
    { minItems: 2 },
  ),
  testedHypothesisIds: Type.Array(Type.String({ minLength: 1 }), {
    minItems: 2,
    uniqueItems: true,
  }),
  expectedChoiceId: Type.String({ minLength: 1 }),
  scoringRule: DiagnosticProbeScoringRuleSchema,
});

export type DiagnosticProbeDraft = Static<
  typeof DiagnosticProbeDraftSchema
>;

export const FormHypothesesOutputSchema = Type.Object({
  candidates: Type.Array(HypothesisCandidateSchema, {
    minItems: 2,
  }),
  probe: DiagnosticProbeDraftSchema,
});

export type FormHypothesesOutput = Static<
  typeof FormHypothesesOutputSchema
>;

export const FormHypothesesResultSchema = toolResultSchema(
  FormHypothesesOutputSchema,
);
