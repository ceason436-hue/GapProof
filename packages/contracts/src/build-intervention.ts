import { type Static, Type } from "@sinclair/typebox";

import { toolResultSchema } from "./tool.ts";

export const BuildInterventionInputSchema = Type.Object({
  probeEvaluationEventId: Type.String({ minLength: 1 }),
  selectedHypothesisId: Type.Union([
    Type.String({ minLength: 1 }),
    Type.Null(),
  ]),
  probePassed: Type.Boolean(),
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

export const BuildInterventionOutputSchema = Type.Object({
  title: Type.String({ minLength: 1 }),
  rationale: Type.String({ minLength: 1 }),
  estimatedMinutes: Type.Integer({ minimum: 1, maximum: 10 }),
  steps: Type.Array(InterventionStepSchema, {
    minItems: 3,
    uniqueItems: true,
  }),
});

export type BuildInterventionOutput = Static<
  typeof BuildInterventionOutputSchema
>;

export const BuildInterventionResultSchema = toolResultSchema(
  BuildInterventionOutputSchema,
);
