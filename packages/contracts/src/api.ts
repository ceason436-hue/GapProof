import { type Static, type TSchema, Type } from "@sinclair/typebox";

import { CaseStatusSchema } from "./case.ts";
import {
  DiagnosticProbeDraftSchema,
  HypothesisCandidateSchema,
} from "./form-hypotheses.ts";

export function apiResponseSchema<T extends TSchema>(dataSchema: T) {
  return Type.Object({
    data: dataSchema,
    requestId: Type.String({ minLength: 1 }),
    traceId: Type.String({ minLength: 1 }),
    jobId: Type.Optional(Type.String({ format: "uuid" })),
  });
}

export const ApiErrorResponseSchema = Type.Object({
  error: Type.Object({
    code: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
    retryable: Type.Boolean(),
    details: Type.Optional(Type.Unknown()),
  }),
  requestId: Type.String({ minLength: 1 }),
  traceId: Type.String({ minLength: 1 }),
});

export interface ApiResponse<T> {
  readonly data: T;
  readonly requestId: string;
  readonly traceId: string;
  readonly jobId?: string;
}

export interface ApiErrorResponse
  extends Static<typeof ApiErrorResponseSchema> {}

export const CreateCaseRequestSchema = Type.Object({
  entry: Type.Literal("synthetic_demo"),
});

export type CreateCaseRequest = Static<typeof CreateCaseRequestSchema>;

export const CaseViewSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  studentId: Type.String({ format: "uuid" }),
  state: CaseStatusSchema,
  stateVersion: Type.Integer({ minimum: 0 }),
  title: Type.Union([Type.String(), Type.Null()]),
  simulation: Type.Boolean(),
  synthetic: Type.Boolean(),
  updatedAt: Type.String({ format: "date-time" }),
});

export type CaseView = Static<typeof CaseViewSchema>;

export const CaseIdParamsSchema = Type.Object({
  caseId: Type.String({ format: "uuid" }),
});

export type CaseIdParams = Static<typeof CaseIdParamsSchema>;

export const ExtractionCorrectionSchema = Type.Object({
  itemId: Type.String({ minLength: 1 }),
  field: Type.Union([
    Type.Literal("prompt"),
    Type.Literal("student_answer"),
  ]),
  value: Type.String({ minLength: 1 }),
});

export type ExtractionCorrection = Static<typeof ExtractionCorrectionSchema>;

export const ConfirmExtractionRequestSchema = Type.Object({
  expectedVersion: Type.Integer({ minimum: 0 }),
  confirmedItemIds: Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1,
    uniqueItems: true,
  }),
  corrections: Type.Array(ExtractionCorrectionSchema),
});

export type ConfirmExtractionRequest = Static<
  typeof ConfirmExtractionRequestSchema
>;

export const DiagnosticProbeViewSchema = Type.Omit(
  DiagnosticProbeDraftSchema,
  ["expectedChoiceId"],
);

export const HypothesesViewSchema = Type.Object({
  caseId: Type.String({ format: "uuid" }),
  stateVersion: Type.Integer({ minimum: 0 }),
  candidates: Type.Array(HypothesisCandidateSchema, { minItems: 2 }),
  probe: DiagnosticProbeViewSchema,
});

export type HypothesesView = Static<typeof HypothesesViewSchema>;

export const RunNextRequestSchema = Type.Object({
  expectedVersion: Type.Integer({ minimum: 0 }),
});

export type RunNextRequest = Static<typeof RunNextRequestSchema>;

export const RunNextQueuedSchema = Type.Object({
  caseId: Type.String({ format: "uuid" }),
  expectedVersion: Type.Integer({ minimum: 0 }),
  status: Type.Literal("queued"),
});

export type RunNextQueued = Static<typeof RunNextQueuedSchema>;

export const RunNextJobDataSchema = Type.Object({
  caseId: Type.String({ format: "uuid" }),
  expectedVersion: Type.Integer({ minimum: 0 }),
  assetId: Type.String({ minLength: 1 }),
  traceId: Type.String({ minLength: 1 }),
});

export type RunNextJobData = Static<typeof RunNextJobDataSchema>;
