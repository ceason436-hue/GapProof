import { type Static, Type } from "@sinclair/typebox";

import { toolResultSchema } from "./tool.ts";

export const BuildInterventionInputSchema = Type.Object({
  contentSource: Type.Union([
    Type.Literal("synthetic_fixture"),
    Type.Literal("confirmed_real_material"),
  ]),
  probeEvaluationEventId: Type.String({ minLength: 1 }),
  selectedHypothesisId: Type.Union([
    Type.String({ minLength: 1 }),
    Type.Null(),
  ]),
  probePassed: Type.Boolean(),
  confirmedItems: Type.Optional(Type.Array(Type.Object({
    prompt: Type.String({ minLength: 1, maxLength: 4_000 }),
    studentAnswer: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 8 })),
  selectedHypothesis: Type.Optional(Type.Object({
    title: Type.String({ minLength: 1, maxLength: 120 }),
    explanation: Type.String({ minLength: 1, maxLength: 400 }),
  }, { additionalProperties: false })),
  replanStrategy: Type.Optional(Type.Union([
    Type.Literal("alternate_explanation_and_practice"),
    Type.Literal("prerequisite_skill_with_example"),
  ])),
});

export type BuildInterventionInput = Static<
  typeof BuildInterventionInputSchema
>;

export const InterventionStepSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  kind: Type.Union([
    Type.Literal("explain"),
    Type.Literal("worked_example"),
    Type.Literal("guided_practice"),
  ]),
  title: Type.String({ minLength: 1 }),
  content: Type.String({ minLength: 1 }),
});

export type InterventionStep = Static<typeof InterventionStepSchema>;

export const PrivateRetestItemDraftSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 120 }),
  prompt: Type.String({ minLength: 1, maxLength: 500 }),
  choices: Type.Array(Type.Object({
    id: Type.String({ minLength: 1, maxLength: 120 }),
    label: Type.String({ minLength: 1, maxLength: 160 }),
  }, { additionalProperties: false }), { minItems: 2, maxItems: 4 }),
  expectedChoiceId: Type.String({ minLength: 1, maxLength: 120 }),
  scoringMethod: Type.Literal("exact-choice-v1"),
}, { additionalProperties: false });

export type PrivateRetestItemDraft = Static<typeof PrivateRetestItemDraftSchema>;

export const BuildInterventionOutputSchema = Type.Object({
  title: Type.String({ minLength: 1 }),
  rationale: Type.String({ minLength: 1 }),
  knowledgeTarget: Type.String({ minLength: 1, maxLength: 160 }),
  estimatedMinutes: Type.Integer({ minimum: 1, maximum: 10 }),
  steps: Type.Array(InterventionStepSchema, {
    minItems: 3,
    uniqueItems: true,
  }),
  retests: Type.Object({
    d1: PrivateRetestItemDraftSchema,
    d7: PrivateRetestItemDraftSchema,
  }, { additionalProperties: false }),
});

export type BuildInterventionOutput = Static<
  typeof BuildInterventionOutputSchema
>;

export const BuildInterventionResultSchema = toolResultSchema(
  BuildInterventionOutputSchema,
);
