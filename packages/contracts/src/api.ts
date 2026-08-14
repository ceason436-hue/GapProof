import { type Static, type TSchema, Type } from "@sinclair/typebox";

import { CaseStatusSchema } from "./case.ts";
import {
  DiagnosticProbeDraftSchema,
  HypothesisCandidateSchema,
} from "./form-hypotheses.ts";
import { InterventionStepSchema } from "./build-intervention.ts";

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
  ["expectedChoiceId", "scoringRule"],
);

export const HypothesesViewSchema = Type.Object({
  caseId: Type.String({ format: "uuid" }),
  stateVersion: Type.Integer({ minimum: 0 }),
  candidates: Type.Array(HypothesisCandidateSchema, { minItems: 2 }),
  probe: DiagnosticProbeViewSchema,
});

export type HypothesesView = Static<typeof HypothesesViewSchema>;

export const SubmitAttemptRequestSchema = Type.Object({
  expectedVersion: Type.Integer({ minimum: 0 }),
  probeId: Type.String({ minLength: 1 }),
  selectedChoiceId: Type.String({ minLength: 1 }),
});

export type SubmitAttemptRequest = Static<typeof SubmitAttemptRequestSchema>;

export const AttemptViewSchema = Type.Object({
  attemptId: Type.String({ format: "uuid" }),
  caseId: Type.String({ format: "uuid" }),
  state: CaseStatusSchema,
  stateVersion: Type.Integer({ minimum: 0 }),
  probeId: Type.String({ minLength: 1 }),
  selectedChoiceId: Type.String({ minLength: 1 }),
  passed: Type.Boolean(),
  selectedHypothesisId: Type.Union([
    Type.String({ minLength: 1 }),
    Type.Null(),
  ]),
  scoringMethod: Type.Literal("exact_choice_v1"),
});

export type AttemptView = Static<typeof AttemptViewSchema>;

export const StudentIdParamsSchema = Type.Object({
  studentId: Type.String({ format: "uuid" }),
});

export type StudentIdParams = Static<typeof StudentIdParamsSchema>;

export const TaskIdParamsSchema = Type.Object({
  taskId: Type.String({ format: "uuid" }),
});

export type TaskIdParams = Static<typeof TaskIdParamsSchema>;

export const TaskTypeSchema = Type.Union([
  Type.Literal("guided_intervention"),
  Type.Literal("d1_retest"),
]);

export const TaskStatusSchema = Type.Union([
  Type.Literal("ready"),
  Type.Literal("scheduled"),
  Type.Literal("completed"),
]);

export const LearningTaskViewSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  caseId: Type.String({ format: "uuid" }),
  studentId: Type.String({ format: "uuid" }),
  taskType: TaskTypeSchema,
  status: TaskStatusSchema,
  title: Type.String({ minLength: 1 }),
  rationale: Type.String({ minLength: 1 }),
  estimatedMinutes: Type.Integer({ minimum: 1 }),
  scheduledFor: Type.String({ format: "date-time" }),
  dueAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  completedAt: Type.Union([
    Type.String({ format: "date-time" }),
    Type.Null(),
  ]),
  steps: Type.Array(InterventionStepSchema, { minItems: 1 }),
});

export type LearningTaskView = Static<typeof LearningTaskViewSchema>;

export const TodayTasksViewSchema = Type.Object({
  studentId: Type.String({ format: "uuid" }),
  tasks: Type.Array(LearningTaskViewSchema),
});

export type TodayTasksView = Static<typeof TodayTasksViewSchema>;

export const CompleteTaskRequestSchema = Type.Object({
  expectedVersion: Type.Integer({ minimum: 0 }),
  completedStepIds: Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1,
    uniqueItems: true,
  }),
});

export type CompleteTaskRequest = Static<typeof CompleteTaskRequestSchema>;

export const TaskCompletionViewSchema = Type.Object({
  caseId: Type.String({ format: "uuid" }),
  state: Type.Literal("d1_scheduled"),
  stateVersion: Type.Integer({ minimum: 0 }),
  completedTask: LearningTaskViewSchema,
  scheduledRetest: LearningTaskViewSchema,
});

export type TaskCompletionView = Static<typeof TaskCompletionViewSchema>;

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
