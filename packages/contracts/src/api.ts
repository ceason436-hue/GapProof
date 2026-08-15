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

export const StudentUploadMimeTypeSchema = Type.Union([
  Type.Literal("image/jpeg"),
  Type.Literal("image/png"),
  Type.Literal("image/webp"),
]);

export const SourceAssetSha256Schema = Type.String({
  pattern: "^[0-9a-f]{64}$",
});

export const InitiateSourceAssetUploadRequestSchema = Type.Object({
  studentId: Type.String({ format: "uuid" }),
  caseId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  fileName: Type.String({
    minLength: 1,
    maxLength: 200,
    pattern: "^[^/\\\\\\u0000]+$",
  }),
  mimeType: StudentUploadMimeTypeSchema,
  byteSize: Type.Integer({ minimum: 1, maximum: 10_485_760 }),
  sha256: SourceAssetSha256Schema,
}, { additionalProperties: false });

export type InitiateSourceAssetUploadRequest = Static<
  typeof InitiateSourceAssetUploadRequestSchema
>;

export const SourceAssetUploadTargetSchema = Type.Object({
  method: Type.Literal("PUT"),
  path: Type.String({ pattern: "^/api/v1/source-assets/[0-9a-f-]+/content$" }),
  token: Type.String({ minLength: 32 }),
  expiresAt: Type.String({ format: "date-time" }),
  mimeType: StudentUploadMimeTypeSchema,
  byteSize: Type.Integer({ minimum: 1, maximum: 10_485_760 }),
}, { additionalProperties: false });

export const InitiatedSourceAssetUploadViewSchema = Type.Object({
  assetId: Type.String({ format: "uuid" }),
  processingStatus: Type.Literal("pending_upload"),
  upload: SourceAssetUploadTargetSchema,
}, { additionalProperties: false });

export type InitiatedSourceAssetUploadView = Static<
  typeof InitiatedSourceAssetUploadViewSchema
>;

export const SourceAssetIdParamsSchema = Type.Object({
  assetId: Type.String({ format: "uuid" }),
}, { additionalProperties: false });

export type SourceAssetIdParams = Static<typeof SourceAssetIdParamsSchema>;

export const UploadedSourceAssetViewSchema = Type.Object({
  assetId: Type.String({ format: "uuid" }),
  processingStatus: Type.Literal("uploaded"),
  mimeType: StudentUploadMimeTypeSchema,
  byteSize: Type.Integer({ minimum: 1, maximum: 10_485_760 }),
  sha256: SourceAssetSha256Schema,
}, { additionalProperties: false });

export type UploadedSourceAssetView = Static<
  typeof UploadedSourceAssetViewSchema
>;

export const PrepareSourceAssetRequestSchema = Type.Object(
  {},
  { additionalProperties: false },
);

export type PrepareSourceAssetRequest = Static<
  typeof PrepareSourceAssetRequestSchema
>;

export const SourceAssetInspectionProcessingStatusSchema = Type.Union([
  Type.Literal("uploaded"),
  Type.Literal("queued"),
  Type.Literal("processing"),
  Type.Literal("needs_confirmation"),
  Type.Literal("succeeded"),
  Type.Literal("retryable_error"),
  Type.Literal("failed"),
]);

export const SourceAssetQualityReasonSchema = Type.Union([
  Type.Literal("low_resolution"),
  Type.Literal("mime_mismatch"),
  Type.Literal("invalid_or_truncated_image"),
  Type.Literal("pixel_limit_exceeded"),
  Type.Literal("stored_bytes_mismatch"),
  Type.Literal("stored_bytes_missing"),
]);

export const SourceAssetQualityCheckSchema = Type.Object({
  status: Type.Union([
    Type.Literal("passed"),
    Type.Literal("needs_confirmation"),
    Type.Literal("failed"),
  ]),
  detectedMimeType: Type.Union([StudentUploadMimeTypeSchema, Type.Null()]),
  width: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  height: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  reasons: Type.Array(SourceAssetQualityReasonSchema, { uniqueItems: true }),
  checkerVersion: Type.Literal("image-header-v1"),
}, { additionalProperties: false });

export type SourceAssetQualityCheck = Static<
  typeof SourceAssetQualityCheckSchema
>;

export const SourceAssetPrepareQueuedViewSchema = Type.Object({
  assetId: Type.String({ format: "uuid" }),
  stage: Type.Literal("image_quality_check"),
  processingStatus: Type.Literal("queued"),
}, { additionalProperties: false });

export type SourceAssetPrepareQueuedView = Static<
  typeof SourceAssetPrepareQueuedViewSchema
>;

export const SourceAssetProcessingViewSchema = Type.Object({
  assetId: Type.String({ format: "uuid" }),
  stage: Type.Literal("image_quality_check"),
  processingStatus: SourceAssetInspectionProcessingStatusSchema,
  mimeType: StudentUploadMimeTypeSchema,
  byteSize: Type.Integer({ minimum: 1, maximum: 10_485_760 }),
  quality: Type.Union([SourceAssetQualityCheckSchema, Type.Null()]),
}, { additionalProperties: false });

export type SourceAssetProcessingView = Static<
  typeof SourceAssetProcessingViewSchema
>;

export const SourceAssetQualityCheckJobDataSchema = Type.Object({
  assetId: Type.String({ format: "uuid" }),
}, { additionalProperties: false });

export type SourceAssetQualityCheckJobData = Static<
  typeof SourceAssetQualityCheckJobDataSchema
>;

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
  Type.Literal("d7_retest"),
]);

export const TaskStatusSchema = Type.Union([
  Type.Literal("ready"),
  Type.Literal("scheduled"),
  Type.Literal("completed"),
]);

const LearningTaskBaseSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  caseId: Type.String({ format: "uuid" }),
  studentId: Type.String({ format: "uuid" }),
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
});

export const RetestChoiceViewSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
});

export const RetestItemViewSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  prompt: Type.String({ minLength: 1 }),
  choices: Type.Array(RetestChoiceViewSchema, { minItems: 2 }),
}, { additionalProperties: false });

export const GuidedInterventionTaskViewSchema = Type.Object({
  ...LearningTaskBaseSchema.properties,
  taskType: Type.Literal("guided_intervention"),
  steps: Type.Array(InterventionStepSchema, { minItems: 1 }),
}, { additionalProperties: false });

export const D1RetestTaskViewSchema = Type.Object({
  ...LearningTaskBaseSchema.properties,
  taskType: Type.Literal("d1_retest"),
  item: RetestItemViewSchema,
}, { additionalProperties: false });

export const D7RetestTaskViewSchema = Type.Object({
  ...LearningTaskBaseSchema.properties,
  taskType: Type.Literal("d7_retest"),
  item: RetestItemViewSchema,
}, { additionalProperties: false });

export const LearningTaskViewSchema = Type.Union([
  GuidedInterventionTaskViewSchema,
  D1RetestTaskViewSchema,
  D7RetestTaskViewSchema,
]);

/**
 * Stable actionable tie-break order after dueAt ASC NULLS LAST. D7 remains
 * read-only until its attempt contract and evaluation route are implemented.
 */
export const CURRENT_ACTIONABLE_TASK_TYPE_PRIORITY = [
  "d1_retest",
  "guided_intervention",
] as const;

export type LearningTaskView = Static<typeof LearningTaskViewSchema>;
export type GuidedInterventionTaskView = Static<
  typeof GuidedInterventionTaskViewSchema
>;
export type D1RetestTaskView = Static<typeof D1RetestTaskViewSchema>;
export type D7RetestTaskView = Static<typeof D7RetestTaskViewSchema>;

export const TodayActivityDaySchema = Type.Object({
  localDate: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
  completedTaskCount: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });

export const TodayWeeklyGoalSchema = Type.Object({
  targetDays: Type.Integer({ minimum: 1, maximum: 7 }),
  completedDays: Type.Integer({ minimum: 0, maximum: 7 }),
}, { additionalProperties: false });

export const TodayRecentProgressKindSchema = Type.Union([
  Type.Literal("recognition_confirmed"),
  Type.Literal("diagnosis_checked"),
  Type.Literal("practice_completed"),
  Type.Literal("d1_passed"),
  Type.Literal("d1_needs_followup"),
  Type.Literal("plan_adjusted"),
]);

export const TodayRecentProgressSchema = Type.Object({
  eventId: Type.String({ format: "uuid" }),
  caseId: Type.String({ format: "uuid" }),
  kind: TodayRecentProgressKindSchema,
  occurredAt: Type.String({ format: "date-time" }),
}, { additionalProperties: false });

export const TodayNextCheckSchema = Type.Object({
  taskId: Type.String({ format: "uuid" }),
  taskType: Type.Union([
    Type.Literal("d1_retest"),
    Type.Literal("d7_retest"),
  ]),
  title: Type.String({ minLength: 1 }),
  scheduledFor: Type.String({ format: "date-time" }),
  dueAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  estimatedMinutes: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });

export const TodayOverviewSchema = Type.Object({
  /** Seven consecutive local calendar days ending on the server-authoritative today. */
  activityDays: Type.Array(TodayActivityDaySchema, {
    minItems: 7,
    maxItems: 7,
  }),
  /** Null until a real plan or student preference stores an explicit goal. */
  weeklyGoal: Type.Union([TodayWeeklyGoalSchema, Type.Null()]),
  pendingConfirmationCount: Type.Integer({ minimum: 0 }),
  recentProgress: Type.Array(TodayRecentProgressSchema, { maxItems: 2 }),
  nextCheck: Type.Union([TodayNextCheckSchema, Type.Null()]),
}, { additionalProperties: false });

export type TodayOverview = Static<typeof TodayOverviewSchema>;

export const TodayTasksViewSchema = Type.Object({
  studentId: Type.String({ format: "uuid" }),
  /** Valid IANA time-zone identifier sourced from the student record. */
  timeZone: Type.String({ minLength: 1 }),
  currentTaskId: Type.Union([
    Type.String({ format: "uuid" }),
    Type.Null(),
  ]),
  tasks: Type.Array(LearningTaskViewSchema),
  /** Optional only during the contract-first rollout; the API implementation must populate it. */
  overview: Type.Optional(TodayOverviewSchema),
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
  completedTask: GuidedInterventionTaskViewSchema,
  scheduledRetest: D1RetestTaskViewSchema,
});

export type TaskCompletionView = Static<typeof TaskCompletionViewSchema>;

/**
 * Retry contract: reuse the identical key/body only after an unknown network
 * outcome or an explicitly retryable response. Refresh after VERSION_CONFLICT;
 * do not automatically resubmit schema, state, or key-reuse failures.
 */
export const SubmitD1RetestAttemptRequestSchema = Type.Object({
  expectedVersion: Type.Integer({ minimum: 0 }),
  itemId: Type.String({ minLength: 1 }),
  selectedChoiceId: Type.String({ minLength: 1 }),
});

export type SubmitD1RetestAttemptRequest = Static<
  typeof SubmitD1RetestAttemptRequestSchema
>;

export const D1RetestAttemptViewSchema = Type.Object({
  attemptId: Type.String({ format: "uuid" }),
  caseId: Type.String({ format: "uuid" }),
  taskId: Type.String({ format: "uuid" }),
  itemId: Type.String({ minLength: 1 }),
  selectedChoiceId: Type.String({ minLength: 1 }),
  passed: Type.Boolean(),
  scoringMethod: Type.Literal("exact-choice-v1"),
  state: Type.Union([
    Type.Literal("d7_scheduled"),
    Type.Literal("replan_required"),
  ]),
  stateVersion: Type.Integer({ minimum: 0 }),
  completedTask: D1RetestTaskViewSchema,
  scheduledRetest: Type.Union([D7RetestTaskViewSchema, Type.Null()]),
});

export type D1RetestAttemptView = Static<typeof D1RetestAttemptViewSchema>;

export const DemoClockAdvanceRequestSchema = Type.Object({
  caseId: Type.String({ format: "uuid" }),
  clockId: Type.String({ format: "uuid" }),
  expectedClockVersion: Type.Integer({ minimum: 0 }),
  advanceBySeconds: Type.Integer({
    minimum: 1,
    maximum: 31 * 24 * 60 * 60,
  }),
});

export type DemoClockAdvanceRequest = Static<
  typeof DemoClockAdvanceRequestSchema
>;

export const DemoClockAdvanceViewSchema = Type.Object({
  caseId: Type.String({ format: "uuid" }),
  clockId: Type.String({ format: "uuid" }),
  clockVersion: Type.Integer({ minimum: 1 }),
  previousEffectiveNow: Type.String({ format: "date-time" }),
  effectiveNow: Type.String({ format: "date-time" }),
  activatedTaskIds: Type.Array(Type.String({ format: "uuid" })),
});

export type DemoClockAdvanceView = Static<
  typeof DemoClockAdvanceViewSchema
>;

export const RetestDueJobDataSchema = Type.Object({
  caseId: Type.String({ format: "uuid" }),
  taskId: Type.String({ format: "uuid" }),
});

export type RetestDueJobData = Static<typeof RetestDueJobDataSchema>;

export const ReplanJobDataSchema = Type.Object({
  caseId: Type.String({ format: "uuid" }),
  triggerEventId: Type.String({ format: "uuid" }),
  expectedVersion: Type.Integer({ minimum: 0 }),
  traceId: Type.String({ minLength: 1 }),
  interventionJobId: Type.String({ format: "uuid" }),
});

export type ReplanJobData = Static<typeof ReplanJobDataSchema>;

export function isReplanJobData(value: unknown): value is ReplanJobData {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return (
    typeof value === "object" &&
    value !== null &&
    "caseId" in value &&
    typeof value.caseId === "string" &&
    uuidPattern.test(value.caseId) &&
    "triggerEventId" in value &&
    typeof value.triggerEventId === "string" &&
    uuidPattern.test(value.triggerEventId) &&
    "expectedVersion" in value &&
    Number.isInteger(value.expectedVersion) &&
    Number(value.expectedVersion) >= 0 &&
    "traceId" in value &&
    typeof value.traceId === "string" &&
    value.traceId.length > 0 &&
    "interventionJobId" in value &&
    typeof value.interventionJobId === "string" &&
    uuidPattern.test(value.interventionJobId)
  );
}

export function isRetestDueJobData(value: unknown): value is RetestDueJobData {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return (
    typeof value === "object" &&
    value !== null &&
    "caseId" in value &&
    typeof value.caseId === "string" &&
    uuidPattern.test(value.caseId) &&
    "taskId" in value &&
    typeof value.taskId === "string" &&
    uuidPattern.test(value.taskId)
  );
}

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
