import Fastify, {
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { v7 as uuidv7 } from "uuid";

import {
  apiResponseSchema,
  ApiErrorResponseSchema,
  type ApiErrorResponse,
  AttemptViewSchema,
  type AttemptView,
  CaseIdParamsSchema,
  type CaseIdParams,
  CaseViewSchema,
  type CaseView,
  CompleteTaskRequestSchema,
  type CompleteTaskRequest,
  ConfirmExtractionRequestSchema,
  type ConfirmExtractionRequest,
  CreateCaseRequestSchema,
  type CreateCaseRequest,
  DemoClockAdvanceRequestSchema,
  type DemoClockAdvanceRequest,
  DemoClockAdvanceViewSchema,
  type D1RetestAttemptView,
  D7RetestAttemptViewSchema,
  type D7RetestAttemptView,
  RetestAttemptViewSchema,
  type D1RetestTaskView,
  type D7RetestTaskView,
  type FormHypothesesOutput,
  HypothesesViewSchema,
  type HypothesesView,
  InitiateSourceAssetUploadRequestSchema,
  type InitiateSourceAssetUploadRequest,
  InitiatedSourceAssetUploadViewSchema,
  type InitiatedSourceAssetUploadView,
  type InterventionStep,
  type LearningTaskView,
  LearningTaskViewSchema,
  CreateMistakeReviewRequestSchema,
  type CreateMistakeReviewRequest,
  CompleteMistakeReviewRequestSchema,
  type CompleteMistakeReviewRequest,
  MistakeReviewCompletionViewSchema,
  type MistakeReviewCompletionView,
  RunNextQueuedSchema,
  RunNextRequestSchema,
  type RunNextRequest,
  SubmitAttemptRequestSchema,
  type SubmitAttemptRequest,
  type SubmitD1RetestAttemptRequest,
  SubmitRetestAttemptRequestSchema,
  type SubmitRetestAttemptRequest,
  StudentIdParamsSchema,
  type StudentIdParams,
  StudentProfileViewSchema,
  type StudentProfileView,
  UpdateStudentProfileRequestSchema,
  type UpdateStudentProfileRequest,
  SourceAssetIdParamsSchema,
  type SourceAssetIdParams,
  PrepareSourceAssetRequestSchema,
  type PrepareSourceAssetRequest,
  StartSyntheticRecognitionRequestSchema,
  type StartSyntheticRecognitionRequest,
  StartSyntheticRecognitionViewSchema,
  type StartSyntheticRecognitionView,
  SyntheticExtractionViewSchema,
  type SyntheticExtractionView,
  ExtractionViewSchema,
  type ExtractionView,
  SourceAssetPrepareQueuedViewSchema,
  type SourceAssetPrepareQueuedView,
  SourceAssetPrepareViewSchema,
  SourceAssetProcessingViewSchema,
  SubmitSyntheticQuickCheckRequestSchema,
  type SubmitSyntheticQuickCheckRequest,
  SyntheticQuickCheckResultSchema,
  SyntheticQuickCheckViewSchema,
  type SourceAssetProcessingView,
  TaskCompletionViewSchema,
  type TaskCompletionView,
  TaskIdParamsSchema,
  type TaskIdParams,
  TodayTasksViewSchema,
  UploadedSourceAssetViewSchema,
  type UploadedSourceAssetView,
  OcrBatchIdParamsSchema,
  type OcrBatchIdParams,
  CreateRealOcrBatchRequestSchema,
  type CreateRealOcrBatchRequest,
  RealOcrBatchViewSchema,
  type RealOcrBatchView,
  AddRealOcrBatchPageRequestSchema,
  type AddRealOcrBatchPageRequest,
  OcrBatchPageParamsSchema,
  type OcrBatchPageParams,
  AddedRealOcrBatchPageViewSchema,
  type AddedRealOcrBatchPageView,
  ReorderRealOcrBatchPagesRequestSchema,
  type ReorderRealOcrBatchPagesRequest,
  StartRealOcrBatchRequestSchema,
  type StartRealOcrBatchRequest,
  StartRealOcrBatchViewSchema,
  type StartRealOcrBatchView,
  CreateTutorTurnRequestSchema,
  TutorSessionViewSchema,
  TutorTurnViewSchema,
  TUTOR_POLICY_VERSION,
  isUuidV7,
  type CreateTutorTurnRequest,
  type SocraticTutorContext,
  type TutorSessionView,
  type TutorTurnView,
  DeletedCaseSourceAssetsViewSchema,
  type DeletedCaseSourceAssetsView,
  CaseSourceAssetsStatusViewSchema,
  type CaseSourceAssetsStatusView,
  StudentProgressViewSchema,
  StudentFactReportsViewSchema,
  QuestionArchiveViewSchema,
  QuestionArchiveEntryParamsSchema,
  type QuestionArchiveEntryParams,
  QuestionArchiveDetailViewSchema,
} from "@gapproof/contracts";
import {
  advanceDemoClock,
  completeInterventionTask,
  createSyntheticCaseIdempotent,
  findCurrentActionableTaskId,
  findEvidenceEventByIdempotencyKey,
  findCaseById,
  findLatestCaseEvidenceEventByType,
  findTaskRetestEvaluationEvent,
  readSyntheticExtractionItems,
  findStudentById,
  findStudentProfile,
  updateStudentProfileIdempotent,
  StudentProfileIdempotencyKeyReusedError,
  StudentProfileVersionConflictError,
  findSourceAssetById,
  findActiveCaseSourceAssets,
  startSyntheticRecognitionIdempotent,
  findUploadStudentAndCase,
  initiateSourceAssetUpload,
  markSourceAssetUploaded,
  findTaskById,
  findTodayOverview,
  findTasksByStudentId,
  InvalidTaskStateError,
  persistD1RetestEvaluation,
  persistCaseTransition,
  type CaseRow,
  type Database,
  type LearningEvidenceEventRow,
  type TaskRow,
  DemoCaseRequiredError,
  DemoClockIdempotencyKeyReusedError,
  DemoClockMismatchError,
  DemoClockVersionConflictError,
  ResourceNotFoundError,
  SourceAssetIdempotencyKeyReusedError,
  SourceAssetAlreadyBoundError,
  SyntheticRecognitionIdempotencyKeyReusedError,
  SyntheticRecognitionNotReadyError,
  SourceAssetNotUploadedError,
  VersionConflictError,
  createRealOcrBatch,
  findOcrBatch,
  attachOcrBatchPage,
  startRealOcrBatch,
  OcrBatchIntentError,
  OcrBatchIdempotencyError,
  removeOcrBatchPage,
  reorderOcrBatchPages,
  replaceOcrBatchPage,
  findLatestTutorTurn,
  findTutorSessionHistory,
  queueTutorTurn,
  TutorTurnRejectedError,
  scheduleCaseSourceAssetRetention,
  markSourceAssetDeleted,
  findStudentProgressAndReports,
  findStudentQuestionArchive,
  findStudentQuestionArchiveItem,
  findMistakeReviewSource,
  createMistakeReviewTask,
  completeMistakeReviewTask,
} from "@gapproof/db";
import {
  type Clock,
  CaseTransitionError,
  SystemClock,
  ProbeScoringError,
  RetestScoringError,
  scoreSingleChoiceRetest,
  scoreProbeAttempt,
  transitionCase,
} from "@gapproof/domain";
import {
  enqueueRetestDueTransactional,
  enqueueReplanTransactional,
  enqueueRunNextIdempotent,
  enqueueSourceAssetQualityCheckIdempotent,
  enqueueRunNextTransactional,
  SYNTHETIC_PARSE_ASSET_ID,
  enqueueRealOcrBatchTransactional,
  type JobQueue,
  enqueueTutorTurn,
} from "@gapproof/jobs";
import {
  MAX_SOURCE_ASSET_BYTES,
  type SourceAssetStorage,
} from "./source-asset-storage.ts";
import {
  createSourceAssetUploadToken,
  verifySourceAssetUploadToken,
} from "./source-asset-token.ts";
import {
  scoreSyntheticQuickCheck,
  SyntheticQuickCheckInputError,
  syntheticQuickCheckView,
} from "./synthetic-quick-check.ts";
import {
  DeviceSessionAuthError,
  DeviceSessionOwnershipError,
  registerDeviceOwnershipHook,
  registerDeviceSessionRoutes,
  type DeviceSessionService,
} from "./device-session-module.ts";
import {
  deleteCaseSourceAssets,
  SourceAssetDeletionNotReadyError,
} from "./source-asset-retention-module.ts";

export interface BuildApiOptions {
  readonly database: Database;
  readonly queue: JobQueue;
  readonly clock?: Clock;
  readonly demoClockEnabled?: boolean;
  readonly uploadStorage?: SourceAssetStorage;
  readonly uploadSigningSecret?: string;
  readonly deviceSession?: DeviceSessionService;
}

class ApiHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiHttpError";
  }
}

function requireUploadConfiguration(options: BuildApiOptions): {
  readonly storage: SourceAssetStorage;
  readonly secret: string;
} {
  if (
    options.uploadStorage === undefined ||
    options.uploadSigningSecret === undefined ||
    options.uploadSigningSecret.length === 0
  ) {
    throw new ApiHttpError(
      503,
      "UPLOAD_NOT_CONFIGURED",
      "Source asset uploads are not configured.",
      true,
    );
  }
  return {
    storage: options.uploadStorage,
    secret: options.uploadSigningSecret,
  };
}

function uploadedSourceAssetView(
  asset: Awaited<ReturnType<typeof findSourceAssetById>>,
): UploadedSourceAssetView {
  if (
    asset === undefined ||
    asset.processingStatus !== "uploaded" ||
    !["image/jpeg", "image/png", "image/webp"].includes(asset.mimeType)
  ) {
    throw new ApiHttpError(
      500,
      "STORED_SOURCE_ASSET_INVALID",
      "The stored source asset is invalid.",
    );
  }
  return {
    assetId: asset.id,
    processingStatus: "uploaded",
    mimeType: asset.mimeType as UploadedSourceAssetView["mimeType"],
    byteSize: asset.byteSize,
    sha256: asset.sha256,
  };
}

function sourceAssetProcessingView(
  asset: Awaited<ReturnType<typeof findSourceAssetById>>,
): SourceAssetProcessingView {
  if (
    asset === undefined ||
    asset.processingStatus === "pending_upload" ||
    !["image/jpeg", "image/png", "image/webp"].includes(asset.mimeType)
  ) {
    throw new ApiHttpError(500, "STORED_SOURCE_ASSET_INVALID", "The stored source asset is invalid.");
  }
  return {
    assetId: asset.id,
    stage: "image_quality_check",
    processingStatus: asset.processingStatus,
    mimeType: asset.mimeType as SourceAssetProcessingView["mimeType"],
    byteSize: asset.byteSize,
    quality: asset.quality as SourceAssetProcessingView["quality"],
  };
}

function toCaseView(row: CaseRow): CaseView {
  return {
    id: row.id,
    studentId: row.studentId,
    state: row.state,
    stateVersion: row.stateVersion,
    title: row.title,
    simulation: row.simulation,
    synthetic: row.synthetic,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function getIdempotencyKey(request: FastifyRequest): string {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiHttpError(
      400,
      "INVALID_INPUT",
      "Idempotency-Key header is required for write requests.",
    );
  }
  return value;
}

function extractionConfirmationPayload(
  body: ConfirmExtractionRequest,
): Record<string, unknown> {
  return {
    expectedVersion: body.expectedVersion,
    confirmedItemIds: [...body.confirmedItemIds],
    corrections: body.corrections.map((correction) => ({ ...correction })),
    ...(body.reviewedQuestions === undefined ? {} : {
      reviewedQuestions: body.reviewedQuestions.map((question) => ({
        sourceItemId: question.sourceItemId,
        prompt: question.prompt.trim(),
        studentAnswer: question.studentAnswer?.trim() || null,
      })),
    }),
  };
}

function attemptRequestPayload(
  body: SubmitAttemptRequest,
): Record<string, unknown> {
  return {
    expectedVersion: body.expectedVersion,
    probeId: body.probeId,
    selectedChoiceId: body.selectedChoiceId,
  };
}

function completionRequestPayload(
  body: CompleteTaskRequest,
): Record<string, unknown> {
  return {
    expectedVersion: body.expectedVersion,
    completedStepIds: [...body.completedStepIds].sort(),
  };
}

function requireValidStudentTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return timeZone;
  } catch (error) {
    if (error instanceof RangeError) {
      throw new ApiHttpError(
        500,
        "STORED_STUDENT_INVALID",
        "The stored student time zone is invalid.",
      );
    }
    throw error;
  }
}

function realOcrBatchView(result: NonNullable<Awaited<ReturnType<typeof findOcrBatch>>>): RealOcrBatchView {
  return {
    batchId: result.batch.id,
    caseId: result.batch.caseId,
    status: result.batch.status,
    guardianConfirmed: result.batch.guardianConfirmed,
    version: result.batch.version,
    pages: result.pages.map(({ page, asset }) => ({
      pageId: page.id,
      assetId: asset.id,
      order: page.pageOrder,
      status: page.status === "pending_upload" ? asset.processingStatus : page.status,
      retryable: asset.processingStatus === "retryable_error",
      needsReview: page.status === "needs_confirmation" || asset.processingStatus === "needs_confirmation",
    })),
  };
}

function studentProfileView(student: Awaited<ReturnType<typeof findStudentProfile>>): StudentProfileView {
  if (student === undefined) throw new Error("Student profile requires a student.");
  const grade = ["7", "8", "9"].includes(student.grade ?? "") ? student.grade as StudentProfileView["grade"] : null;
  const subject = student.subject === "english" ? student.subject : null;
  const term = ["first_term", "second_term"].includes(student.term ?? "") ? student.term as StudentProfileView["term"] : null;
  const region = student.region === "shanghai" ? student.region : null;
  const learningState = ["starting", "catching_up", "steady"].includes(student.learningState ?? "")
    ? student.learningState as StudentProfileView["learningState"]
    : null;
  const fields = [grade, subject, term, region, learningState];
  const completed = fields.every((field) => field !== null);
  return {
    studentId: student.id,
    grade,
    subject,
    term,
    region,
    learningState,
    timeZone: requireValidStudentTimeZone(student.timezone),
    version: student.profileVersion,
    completed,
  };
}

function profileRequestHash(body: UpdateStudentProfileRequest): string {
  return createHash("sha256").update(JSON.stringify({
    expectedVersion: body.expectedVersion,
    grade: body.grade,
    subject: body.subject,
    term: body.term,
    region: body.region,
    learningState: body.learningState,
  })).digest("hex");
}

function tutorRequestHash(body: CreateTutorTurnRequest, learnerText: string): string {
  return createHash("sha256").update(JSON.stringify({
    expectedVersion: body.expectedVersion,
    stepId: body.stepId,
    learnerText,
  })).digest("hex");
}

function deidentifyTutorText(value: string): string {
  return value.normalize("NFKC")
    .replace(/https?:\/\/\S+/giu, "[链接已隐藏]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, "[邮箱已隐藏]")
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/gu, "[手机号已隐藏]")
    .replace(/(?<!\d)\d{15,18}[0-9Xx]?(?!\d)/gu, "[证件号已隐藏]")
    .replace(/\s+/gu, " ").trim().slice(0, 800);
}

function tutorTurnView(turn: Awaited<ReturnType<typeof findLatestTutorTurn>>): TutorTurnView {
  if (turn === undefined) throw new ApiHttpError(404, "RESOURCE_NOT_FOUND", "Tutor turn was not found.");
  const response = turn.response;
  const learnerText = isRecord(turn.context) && typeof turn.context.learnerText === "string"
    ? turn.context.learnerText
    : null;
  if (learnerText === null || learnerText.length === 0) throw new Error("Tutor turn is missing its student-safe learner text.");
  return {
    turnId: turn.id,
    taskId: turn.taskId,
    status: turn.status,
    learnerText,
    response: response !== null && isRecord(response) && typeof response.question === "string" && (typeof response.hint === "string" || response.hint === null) && typeof response.nextAction === "string"
      ? response as TutorTurnView["response"]
      : null,
    retryable: turn.status === "queued" || turn.status === "running" || turn.status === "failed",
  };
}

function tutorSessionView(taskId: string, turns: Awaited<ReturnType<typeof findTutorSessionHistory>>): TutorSessionView {
  if (turns.length === 0) throw new ApiHttpError(404, "RESOURCE_NOT_FOUND", "Tutor session was not found.");
  return { taskId, turns: turns.map(tutorTurnView) };
}

function tutorHistoryContext(turns: Awaited<ReturnType<typeof findTutorSessionHistory>>): NonNullable<SocraticTutorContext["history"]> {
  return turns.flatMap(turn => {
    if (turn.status !== "succeeded" && turn.status !== "fallback") return [];
    const context = isRecord(turn.context) ? turn.context : undefined;
    const response = isRecord(turn.response) ? turn.response : undefined;
    if (
      typeof context?.learnerText !== "string" || context.learnerText.length === 0 ||
      typeof response?.question !== "string" || response.question.length === 0 ||
      (response.hint !== null && typeof response.hint !== "string")
    ) return [];
    return [{
      learnerText: context.learnerText,
      question: response.question,
      hint: response.hint,
    }];
  }).slice(-5);
}

function d1AttemptRequestPayload(
  body: SubmitD1RetestAttemptRequest,
): Record<string, unknown> {
  return {
    expectedVersion: body.expectedVersion,
    itemId: body.itemId,
    selectedChoiceId: body.selectedChoiceId,
  };
}

function isMatchingCompletionEvent(
  event: LearningEvidenceEventRow,
  taskId: string,
  requestPayload: Record<string, unknown>,
): boolean {
  return (
    event.eventType === "intervention_completed" &&
    event.sourceRef === taskId &&
    isRecord(event.payload.request) &&
    isSamePayload(event.payload.request, requestPayload)
  );
}

function isMatchingD1EvaluationEvent(
  event: LearningEvidenceEventRow,
  taskId: string,
  requestPayload: Record<string, unknown>,
): boolean {
  return (
    event.eventType === "retest_evaluated" &&
    event.sourceRef === taskId &&
    isRecord(event.payload.request) &&
    isSamePayload(event.payload.request, requestPayload)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function attemptViewFromEvent(
  caseRow: CaseRow,
  event: LearningEvidenceEventRow,
): AttemptView {
  const result = event.payload.result;
  if (
    !isRecord(result) ||
    typeof result.probeId !== "string" ||
    typeof result.selectedChoiceId !== "string" ||
    typeof result.passed !== "boolean" ||
    !(
      typeof result.selectedHypothesisId === "string" ||
      result.selectedHypothesisId === null
    ) ||
    result.scoringMethod !== "exact_choice_v1"
  ) {
    throw new ApiHttpError(
      500,
      "STORED_EVENT_INVALID",
      "The stored probe evaluation event is invalid.",
    );
  }

  return {
    attemptId: event.id,
    caseId: caseRow.id,
    state: caseRow.state,
    stateVersion: caseRow.stateVersion,
    probeId: result.probeId,
    selectedChoiceId: result.selectedChoiceId,
    passed: result.passed,
    selectedHypothesisId: result.selectedHypothesisId,
    scoringMethod: result.scoringMethod,
  };
}

function toLearningTaskView(row: TaskRow): LearningTaskView {
  const rationale = row.payload.rationale;
  if (typeof rationale !== "string") {
    throw new ApiHttpError(
      500,
      "STORED_TASK_INVALID",
      `Stored task ${row.id} is invalid.`,
    );
  }
  const base = {
    id: row.id,
    caseId: row.caseId,
    studentId: row.studentId,
    status: row.status,
    title: row.title,
    rationale,
    estimatedMinutes: row.estimatedMinutes,
    scheduledFor: row.scheduledFor.toISOString(),
    dueAt: row.dueAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  } as const;

  if (row.taskType === "guided_intervention") {
    const steps = row.payload.steps;
    if (
    !Array.isArray(steps) ||
    steps.length === 0 ||
    steps.some(
      (step) =>
        !isRecord(step) ||
        typeof step.id !== "string" ||
        !["explain", "worked_example", "guided_practice"].includes(
          String(step.kind),
        ) ||
        typeof step.title !== "string" ||
        typeof step.content !== "string",
    )
    ) {
      throw new ApiHttpError(
        500,
        "STORED_TASK_INVALID",
        `Stored task ${row.id} is invalid.`,
      );
    }
    return {
      ...base,
      taskType: "guided_intervention",
      steps: steps as InterventionStep[],
    };
  }

  if (row.taskType === "mistake_review") {
    const prompt = row.payload.prompt;
    const originalAnswer = row.payload.originalAnswer;
    const reflectionPrompt = row.payload.reflectionPrompt;
    const submittedResponse = row.payload.submittedResponse;
    if (
      typeof prompt !== "string" || prompt.trim().length === 0 ||
      (originalAnswer !== null && typeof originalAnswer !== "string") ||
      typeof reflectionPrompt !== "string" || reflectionPrompt.trim().length === 0 ||
      (submittedResponse !== null && typeof submittedResponse !== "string")
    ) {
      throw new ApiHttpError(500, "STORED_TASK_INVALID", `Stored mistake review ${row.id} is invalid.`);
    }
    return {
      ...base,
      taskType: "mistake_review",
      prompt: prompt.trim(),
      originalAnswer: typeof originalAnswer === "string" ? originalAnswer : null,
      reflectionPrompt: reflectionPrompt.trim(),
      submittedResponse: typeof submittedResponse === "string" ? submittedResponse : null,
    };
  }

  const item = privateRetestItemFromTask(row);
  return {
    ...base,
    taskType: row.taskType,
    item: {
      id: item.id,
      prompt: item.prompt,
      choices: item.choices.map((choice) => ({ ...choice })),
    },
  };
}

function withRetestAttemptSummary(
  task: LearningTaskView,
  event: LearningEvidenceEventRow | undefined,
): LearningTaskView {
  if ((task.taskType !== "d1_retest" && task.taskType !== "d7_retest") || event === undefined) return task;
  const result = isRecord(event.payload.result) ? event.payload.result : undefined;
  const expectedKind = task.taskType === "d1_retest" ? "d1" : "d7";
  if (event.payload.kind !== expectedKind || result === undefined || typeof result.selectedChoiceId !== "string" || typeof result.passed !== "boolean") return task;
  const selectedChoice = task.item.choices.find(choice => choice.id === result.selectedChoiceId);
  if (selectedChoice === undefined) return task;
  const state = typeof result.state === "string" ? result.state : "";
  const summaryResult = result.passed
    ? "passed" as const
    : state === "support_required" ? "support_required" as const : "needs_follow_up" as const;
  return {
    ...task,
    attemptSummary: {
      selectedChoiceLabel: selectedChoice.label,
      result: summaryResult,
      evaluatedAt: event.occurredAt.toISOString(),
    },
  };
}

interface PrivateRetestItem {
  readonly id: string;
  readonly prompt: string;
  readonly choices: readonly { readonly id: string; readonly label: string }[];
  readonly expectedChoiceId: string;
  readonly scoringMethod: "exact-choice-v1";
}

function privateRetestItem(value: unknown, storedLabel: string): PrivateRetestItem {
  const item = value;
  if (
    !isRecord(item) ||
    typeof item.id !== "string" ||
    typeof item.prompt !== "string" ||
    !Array.isArray(item.choices) ||
    item.choices.length < 2 ||
    item.choices.some(
      (choice) =>
        !isRecord(choice) ||
        typeof choice.id !== "string" ||
        typeof choice.label !== "string",
    ) ||
    typeof item.expectedChoiceId !== "string" ||
    item.scoringMethod !== "exact-choice-v1" ||
    !item.choices.some(
      (choice) => isRecord(choice) && choice.id === item.expectedChoiceId,
    )
  ) {
    throw new ApiHttpError(
      500,
      "STORED_TASK_INVALID",
      `Stored retest content ${storedLabel} is invalid.`,
    );
  }
  return item as unknown as PrivateRetestItem;
}

function privateRetestItemFromTask(row: TaskRow): PrivateRetestItem {
  return privateRetestItem(row.payload.item, row.id);
}

interface TaskContentAuthenticity {
  readonly contentSource: "synthetic_fixture" | "confirmed_real_material";
  readonly knowledgeTarget: string;
  readonly contentBasisEventId: string;
}

function taskContentAuthenticity(row: TaskRow, caseIsReal: boolean): TaskContentAuthenticity {
  const contentSource = row.payload.contentSource;
  const knowledgeTarget = row.payload.knowledgeTarget;
  const contentBasisEventId = row.payload.contentBasisEventId ?? row.sourceEventId;
  if (
    (contentSource !== "synthetic_fixture" && contentSource !== "confirmed_real_material") ||
    typeof knowledgeTarget !== "string" || knowledgeTarget.trim().length === 0 ||
    typeof contentBasisEventId !== "string"
  ) {
    if (!caseIsReal) {
      return {
        contentSource: "synthetic_fixture",
        knowledgeTarget: "synthetic_fixture_target",
        contentBasisEventId: row.sourceEventId,
      };
    }
    throw new ApiHttpError(409, "REAL_LEARNING_CONTENT_REQUIRED", "This real-material task does not have verified content-bound practice.", false);
  }
  if (caseIsReal && contentSource !== "confirmed_real_material") {
    throw new ApiHttpError(409, "REAL_LEARNING_CONTENT_REQUIRED", "Synthetic practice cannot be used for a real-material case.", false);
  }
  return { contentSource, knowledgeTarget: knowledgeTarget.trim(), contentBasisEventId };
}

function plannedRetestsFromGuidedTask(row: TaskRow, caseIsReal: boolean) {
  const authenticity = taskContentAuthenticity(row, caseIsReal);
  const retests = row.payload.retests;
  if (!isRecord(retests)) {
    if (caseIsReal) throw new ApiHttpError(409, "REAL_LEARNING_CONTENT_REQUIRED", "This real-material task has no verified retest plan.", false);
    return undefined;
  }
  return {
    ...authenticity,
    d1: privateRetestItem(retests.d1, `${row.id}:d1`),
    d7: privateRetestItem(retests.d7, `${row.id}:d7`),
  };
}

async function taskCompletionViewFromEvent(
  database: Database,
  event: LearningEvidenceEventRow,
): Promise<TaskCompletionView> {
  const result = event.payload.result;
  if (
    !isRecord(result) ||
    typeof result.completedTaskId !== "string" ||
    typeof result.d1TaskId !== "string" ||
    !Number.isInteger(result.stateVersion)
  ) {
    throw new ApiHttpError(
      500,
      "STORED_EVENT_INVALID",
      "The stored intervention completion event is invalid.",
    );
  }
  const [completedTask, scheduledRetest] = await Promise.all([
    findTaskById(database, result.completedTaskId),
    findTaskById(database, result.d1TaskId),
  ]);
  if (completedTask === undefined || scheduledRetest === undefined) {
    throw new ApiHttpError(
      500,
      "STORED_TASK_INVALID",
      "The intervention completion tasks are missing.",
    );
  }
  if (
    completedTask.taskType !== "guided_intervention" ||
    scheduledRetest.taskType !== "d1_retest"
  ) {
    throw new ApiHttpError(500, "STORED_TASK_INVALID", "The completion task types are invalid.");
  }

  return {
    caseId: event.caseId,
    state: "d1_scheduled",
    stateVersion: result.stateVersion as number,
    completedTask: toLearningTaskView(completedTask) as Extract<LearningTaskView, { taskType: "guided_intervention" }>,
    scheduledRetest: toLearningTaskView(scheduledRetest) as D1RetestTaskView,
  };
}

async function d1RetestAttemptViewFromEvent(
  _database: Database,
  event: LearningEvidenceEventRow,
): Promise<{ view: D1RetestAttemptView; jobId?: string }> {
  const result = event.payload.result;
  if (
    !isRecord(result) ||
    typeof result.taskId !== "string" ||
    typeof result.itemId !== "string" ||
    typeof result.selectedChoiceId !== "string" ||
    typeof result.passed !== "boolean" ||
    result.scoringMethod !== "exact-choice-v1" ||
    !["d7_scheduled", "replan_required", "support_required"].includes(String(result.state)) ||
    !Number.isInteger(result.stateVersion) ||
    !(typeof result.d7TaskId === "string" || result.d7TaskId === null) ||
    !(typeof result.replanJobId === "string" || result.replanJobId === null) ||
    !isRecord(result.completedTask) ||
    result.completedTask.taskType !== "d1_retest" ||
    result.completedTask.status !== "completed" ||
    !isRecord(result.completedTask.item) ||
    "expectedChoiceId" in result.completedTask.item ||
    !(
      (result.scheduledRetest === null && result.d7TaskId === null) ||
      (isRecord(result.scheduledRetest) &&
        result.scheduledRetest.taskType === "d7_retest" &&
        result.scheduledRetest.status === "scheduled" &&
        result.scheduledRetest.id === result.d7TaskId &&
        isRecord(result.scheduledRetest.item) &&
        !("expectedChoiceId" in result.scheduledRetest.item))
    )
  ) {
    throw new ApiHttpError(500, "STORED_EVENT_INVALID", "The stored D1 evaluation event is invalid.");
  }
  return {
    view: {
      attemptId: event.id,
      caseId: event.caseId,
      taskId: result.taskId,
      itemId: result.itemId,
      selectedChoiceId: result.selectedChoiceId,
      passed: result.passed,
      scoringMethod: "exact-choice-v1",
      state: result.state as "d7_scheduled" | "replan_required" | "support_required",
      stateVersion: result.stateVersion as number,
      completedTask: result.completedTask as D1RetestTaskView,
      scheduledRetest: result.scheduledRetest as D7RetestTaskView | null,
    },
    ...(typeof result.replanJobId === "string"
      ? { jobId: result.replanJobId }
      : {}),
  };
}

function isD7EvaluationEvent(event: LearningEvidenceEventRow): boolean {
  return event.eventType === "retest_evaluated" &&
    isRecord(event.payload.result) && event.payload.result.kind === "d7";
}

function isMatchingRetestEvaluationEvent(
  event: LearningEvidenceEventRow,
  taskId: string,
  requestPayload: Record<string, unknown>,
): boolean {
  return event.eventType === "retest_evaluated" &&
    event.sourceRef === taskId &&
    isRecord(event.payload.request) &&
    isSamePayload(event.payload.request, requestPayload);
}

async function d7RetestAttemptViewFromEvent(
  event: LearningEvidenceEventRow,
): Promise<{ view: D7RetestAttemptView; jobId?: string }> {
  const result = event.payload.result;
  if (
    !isRecord(result) ||
    result.kind !== "d7" ||
    typeof result.taskId !== "string" ||
    typeof result.itemId !== "string" ||
    typeof result.selectedChoiceId !== "string" ||
    typeof result.passed !== "boolean" ||
    result.scoringMethod !== "exact-choice-v1" ||
    !["repair_verified", "replan_required", "support_required"].includes(String(result.state)) ||
    !Number.isInteger(result.stateVersion) ||
    !isRecord(result.completedTask) ||
    result.completedTask.taskType !== "d7_retest" ||
    result.completedTask.status !== "completed" ||
    !isRecord(result.completedTask.item) ||
    "expectedChoiceId" in result.completedTask.item ||
    result.scheduledRetest !== null ||
    !(typeof result.replanJobId === "string" || result.replanJobId === null)
  ) {
    throw new ApiHttpError(500, "STORED_EVENT_INVALID", "The stored D7 evaluation event is invalid.");
  }
  return {
    view: {
      attemptId: event.id,
      caseId: event.caseId,
      taskId: result.taskId,
      itemId: result.itemId,
      selectedChoiceId: result.selectedChoiceId,
      passed: result.passed,
      scoringMethod: "exact-choice-v1",
      state: result.state as D7RetestAttemptView["state"],
      stateVersion: result.stateVersion as number,
      completedTask: result.completedTask as D7RetestTaskView,
      scheduledRetest: null,
    },
    ...(typeof result.replanJobId === "string" ? { jobId: result.replanJobId } : {}),
  };
}

function syntheticExtractionView(
  caseRow: CaseRow,
  event: LearningEvidenceEventRow | undefined,
): { readonly view: SyntheticExtractionView; readonly itemIds: ReadonlySet<string> } {
  if (
    caseRow.state !== "awaiting_confirmation" ||
    event === undefined ||
    event.sourceType !== "fake_ocr" ||
    event.sourceRef !== SYNTHETIC_PARSE_ASSET_ID
  ) {
    throw new ApiHttpError(
      409,
      "EXTRACTION_NOT_READY",
      "Synthetic extraction is not ready for confirmation.",
    );
  }
  const items = readSyntheticExtractionItems(event.payload);
  if (items === undefined) {
    throw new ApiHttpError(
      500,
      "STORED_EVENT_INVALID",
      "The stored synthetic extraction event is invalid.",
    );
  }
  return {
    view: {
      caseId: caseRow.id,
      state: "awaiting_confirmation",
      stateVersion: caseRow.stateVersion,
      recognitionSource: "synthetic_fixture",
      uploadedAssetUsedForRecognition: false,
      items: [...items],
    },
    itemIds: new Set(items.map(({ itemId }) => itemId)),
  };
}

function extractionView(
  caseRow: CaseRow,
  event: LearningEvidenceEventRow | undefined,
): { readonly view: ExtractionView; readonly itemIds: ReadonlySet<string> } {
  if (event?.sourceType === "fake_ocr") return syntheticExtractionView(caseRow, event);
  if (
    caseRow.state !== "awaiting_confirmation" || event === undefined ||
    event.sourceType !== "real_alibaba_ocr"
  ) {
    throw new ApiHttpError(409, "EXTRACTION_NOT_READY", "Extraction is not ready for confirmation.");
  }
  const items = readSyntheticExtractionItems(event.payload);
  if (items === undefined) throw new ApiHttpError(500, "STORED_EVENT_INVALID", "The stored extraction is invalid.");
  return {
    view: { caseId: caseRow.id, state: "awaiting_confirmation", stateVersion: caseRow.stateVersion, recognitionSource: "real_alibaba", uploadedAssetUsedForRecognition: true, items: [...items] },
    itemIds: new Set(items.map(({ itemId }) => itemId)),
  };
}

function isSamePayload(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  return isDeepStrictEqual(left, right);
}

export async function buildApi(options: BuildApiOptions) {
  const api = Fastify({ logger: false, bodyLimit: MAX_SOURCE_ASSET_BYTES });
  if (options.deviceSession !== undefined) {
    registerDeviceOwnershipHook(api, options.deviceSession, options.database);
    await registerDeviceSessionRoutes(api, options.deviceSession);
  }
  api.addContentTypeParser(
    ["image/jpeg", "image/png", "image/webp", "application/octet-stream"],
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );
  const traceIds = new WeakMap<object, string>();

  api.addHook("onRequest", async (request) => {
    traceIds.set(request, uuidv7());
  });

  function traceId(request: FastifyRequest): string {
    return traceIds.get(request) ?? uuidv7();
  }

  function success<T>(
    request: FastifyRequest,
    data: T,
    jobId?: string,
  ) {
    return {
      data,
      requestId: request.id,
      traceId: traceId(request),
      ...(jobId === undefined ? {} : { jobId }),
    };
  }

  api.setErrorHandler((error, request, reply) => {
    let statusCode = 500;
    let code = "INTERNAL_ERROR";
    let message = "An unexpected error occurred.";
    let retryable = false;
    let details: unknown;

    if (error instanceof ApiHttpError) {
      ({ statusCode, code, message, retryable, details } = error);
    } else if (error instanceof DeviceSessionAuthError || error instanceof DeviceSessionOwnershipError) {
      statusCode = error.statusCode;
      code = error.code;
      message = error.message;
    } else if (error instanceof TutorTurnRejectedError) {
      statusCode = 409;
      code = error.code;
      message = error.message;
    } else if (error instanceof SourceAssetDeletionNotReadyError) {
      statusCode = 409;
      code = error.code;
      message = error.message;
    } else if (error instanceof SourceAssetIdempotencyKeyReusedError) {
      statusCode = 409;
      code = error.code;
      message = error.message;
    } else if (error instanceof SourceAssetNotUploadedError) {
      statusCode = 409;
      code = error.code;
      message = error.message;
    } else if (error instanceof OcrBatchIntentError || error instanceof OcrBatchIdempotencyError) {
      statusCode = 409;
      code = error.code;
      message = error.message;
    } else if (
      error instanceof SyntheticRecognitionIdempotencyKeyReusedError ||
      error instanceof SourceAssetAlreadyBoundError
    ) {
      statusCode = 409;
      code = error.code;
      message = error.message;
    } else if (error instanceof SyntheticRecognitionNotReadyError) {
      statusCode = 409;
      code = error.code;
      message = error.message;
    } else if (error instanceof DemoClockVersionConflictError) {
      statusCode = 409;
      code = error.code;
      message = error.message;
      details = error.details;
    } else if (
      error instanceof DemoClockIdempotencyKeyReusedError ||
      error instanceof DemoClockMismatchError
    ) {
      statusCode = 409;
      code = error.code;
      message = error.message;
    } else if (error instanceof DemoCaseRequiredError) {
      statusCode = 403;
      code = error.code;
      message = error.message;
    } else if (error instanceof ResourceNotFoundError) {
      statusCode = 404;
      code = error.code;
      message = error.message;
    } else if (error instanceof VersionConflictError) {
      statusCode = 409;
      code = error.code;
      message = error.message;
    } else if (error instanceof InvalidTaskStateError) {
      statusCode = 409;
      code = error.code;
      message = error.message;
    } else if (error instanceof RetestScoringError) {
      statusCode = 400;
      code = "INVALID_INPUT";
      message = error.message;
    } else if (error instanceof CaseTransitionError) {
      statusCode = error.code === "invalid_transition" ? 409 : 422;
      code =
        error.code === "invalid_transition"
          ? "INVALID_CASE_TRANSITION"
          : "CASE_INVARIANT_VIOLATION";
      message = error.message;
    } else if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "FST_ERR_CTP_BODY_TOO_LARGE" ||
        error.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE")
    ) {
      statusCode = 400;
      code = "UPLOAD_CONTENT_MISMATCH";
      message = "The uploaded content exceeds the maximum allowed size.";
    } else if (
      typeof error === "object" &&
      error !== null &&
      "validation" in error &&
      error.validation !== undefined
    ) {
      statusCode = 400;
      code = "SCHEMA_INVALID";
      message = "The request does not match the required schema.";
      details = error.validation;
    }

    const body: ApiErrorResponse = {
      error: {
        code,
        message,
        retryable,
        ...(details === undefined ? {} : { details }),
      },
      requestId: request.id,
      traceId: traceId(request),
    };
    void reply.status(statusCode).send(body);
  });

  const clock = options.clock ?? new SystemClock();

  api.get<{ Params: CaseIdParams }>(
    "/v1/cases/:caseId/source-assets",
    {
      schema: {
        params: CaseIdParamsSchema,
        response: { 200: apiResponseSchema(CaseSourceAssetsStatusViewSchema), "4xx": ApiErrorResponseSchema, 500: ApiErrorResponseSchema },
      },
    },
    async (request) => {
      const caseRow = await findCaseById(options.database, request.params.caseId);
      if (caseRow === undefined) throw new ResourceNotFoundError("Case", request.params.caseId);
      if (caseRow.state === "awaiting_evidence") throw new SourceAssetDeletionNotReadyError();
      const activeAssets = await findActiveCaseSourceAssets(options.database, caseRow.id);
      const data: CaseSourceAssetsStatusView = {
        caseId: caseRow.id,
        originalImagesDeleted: activeAssets.length === 0,
        extractedContentRetained: true,
      };
      return success(request, data);
    },
  );

  api.delete<{ Params: CaseIdParams }>(
    "/v1/cases/:caseId/source-assets",
    {
      schema: {
        params: CaseIdParamsSchema,
        response: { 200: apiResponseSchema(DeletedCaseSourceAssetsViewSchema), "4xx": ApiErrorResponseSchema, 500: ApiErrorResponseSchema },
      },
    },
    async (request) => {
      getIdempotencyKey(request);
      if (options.uploadStorage === undefined) throw new ApiHttpError(503, "UPLOAD_NOT_CONFIGURED", "Source asset storage is not configured.", true);
      const result = await deleteCaseSourceAssets({ database: options.database, storage: options.uploadStorage, caseId: request.params.caseId });
      if (result === undefined) throw new ResourceNotFoundError("Case", request.params.caseId);
      const data: DeletedCaseSourceAssetsView = {
        ...result,
        originalImagesDeleted: true,
        extractedContentRetained: true,
      };
      return success(request, data);
    },
  );

  api.get(
    "/v1/quick-checks/synthetic",
    {
      schema: {
        response: {
          200: apiResponseSchema(SyntheticQuickCheckViewSchema),
          "4xx": ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
        },
      },
    },
    async (request) => success(request, syntheticQuickCheckView()),
  );

  api.post<{ Body: SubmitSyntheticQuickCheckRequest }>(
    "/v1/quick-checks/synthetic/attempts",
    {
      schema: {
        body: SubmitSyntheticQuickCheckRequestSchema,
        response: {
          200: apiResponseSchema(SyntheticQuickCheckResultSchema),
          "4xx": ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
        },
      },
    },
    async (request) => {
      getIdempotencyKey(request);
      try {
        return success(request, scoreSyntheticQuickCheck(request.body));
      } catch (error) {
        if (error instanceof SyntheticQuickCheckInputError) {
          throw new ApiHttpError(
            400,
            "INVALID_INPUT",
            "The synthetic quick-check answers are incomplete or invalid.",
          );
        }
        throw error;
      }
    },
  );

  api.post<{ Body: InitiateSourceAssetUploadRequest }>(
    "/v1/source-assets/uploads",
    {
      schema: {
        body: InitiateSourceAssetUploadRequestSchema,
        response: {
          200: apiResponseSchema(InitiatedSourceAssetUploadViewSchema),
          201: apiResponseSchema(InitiatedSourceAssetUploadViewSchema),
          "4xx": ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      requireUploadConfiguration(options);
      const idempotencyKey = getIdempotencyKey(request);
      const ownership = await findUploadStudentAndCase(options.database, {
        studentId: request.body.studentId,
        caseId: request.body.caseId,
      });
      if (
        ownership.student === undefined ||
        ownership.student.status === "deleted" ||
        ownership.student.deletedAt !== null
      ) {
        throw new ResourceNotFoundError("Student", request.body.studentId);
      }
      if (
        request.body.caseId !== null &&
        (ownership.caseRow === undefined ||
          ownership.caseRow.deletedAt !== null ||
          ownership.caseRow.studentId !== ownership.student.id ||
          ownership.caseRow.tenantId !== ownership.student.tenantId)
      ) {
        throw new ApiHttpError(
          403,
          "FORBIDDEN",
          "The case does not belong to the requested student.",
        );
      }

      const result = await initiateSourceAssetUpload(options.database, {
        assetId: uuidv7(),
        idempotencyRecordId: uuidv7(),
        idempotencyKey,
        studentId: ownership.student.id,
        caseId: request.body.caseId,
        mimeType: request.body.mimeType,
        byteSize: request.body.byteSize,
        sha256: request.body.sha256,
        tenantId: ownership.student.tenantId,
        createdAt: clock.now(),
      });
      const expiresAt = Date.now() + 10 * 60 * 1000;
      const token = createSourceAssetUploadToken(
        options.uploadSigningSecret ?? "",
        {
          assetId: result.asset.id,
          studentId: result.asset.studentId ?? ownership.student.id,
          sha256: result.asset.sha256,
          byteSize: result.asset.byteSize,
          mimeType: result.asset.mimeType,
          expiresAt,
        },
      );
      const data: InitiatedSourceAssetUploadView = {
        assetId: result.asset.id,
        processingStatus: "pending_upload",
        upload: {
          method: "PUT",
          path: `/api/v1/source-assets/${result.asset.id}/content`,
          token,
          expiresAt: new Date(expiresAt).toISOString(),
          mimeType: result.asset.mimeType as InitiatedSourceAssetUploadView["upload"]["mimeType"],
          byteSize: result.asset.byteSize,
        },
      };
      return reply.status(result.replayed ? 200 : 201).send(success(request, data));
    },
  );

  api.put<{ Params: SourceAssetIdParams; Body: Buffer }>(
    "/v1/source-assets/:assetId/content",
    {
      schema: {
        params: SourceAssetIdParamsSchema,
        response: {
          200: apiResponseSchema(UploadedSourceAssetViewSchema),
          "4xx": ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const { storage, secret } = requireUploadConfiguration(options);
      const asset = await findSourceAssetById(options.database, request.params.assetId);
      if (asset === undefined || asset.deletedAt !== null) {
        throw new ResourceNotFoundError("Source asset", request.params.assetId);
      }
      if (asset.studentId === null) {
        throw new ApiHttpError(500, "STORED_SOURCE_ASSET_INVALID", "The stored source asset is invalid.");
      }
      const token = request.headers["x-gapproof-upload-token"];
      if (
        typeof token !== "string" ||
        !verifySourceAssetUploadToken(
          secret,
          token,
          {
            assetId: asset.id,
            studentId: asset.studentId,
            sha256: asset.sha256,
            byteSize: asset.byteSize,
            mimeType: asset.mimeType,
          },
        )
      ) {
        throw new ApiHttpError(401, "UPLOAD_TOKEN_INVALID", "The upload token is invalid or expired.");
      }
      const contentType = String(request.headers["content-type"] ?? "").split(";", 1)[0] ?? "";
      const bytes = Buffer.isBuffer(request.body)
        ? request.body
        : Buffer.from(request.body as unknown as Uint8Array);
      const actualSha256 = createHash("sha256").update(bytes).digest("hex");
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(contentType) ||
        contentType !== asset.mimeType ||
        bytes.byteLength < 1 ||
        bytes.byteLength > MAX_SOURCE_ASSET_BYTES ||
        bytes.byteLength !== asset.byteSize ||
        actualSha256 !== asset.sha256
      ) {
        throw new ApiHttpError(
          400,
          "UPLOAD_CONTENT_MISMATCH",
          "The uploaded content does not match the upload intent.",
        );
      }

      if (asset.processingStatus === "uploaded") {
        return success(request, uploadedSourceAssetView(asset));
      }
      if (asset.processingStatus !== "pending_upload") {
        throw new ApiHttpError(
          409,
          "UPLOAD_NOT_READY",
          "The source asset is not accepting content.",
        );
      }

      let stored: { readonly created: boolean } | undefined;
      try {
        stored = await storage.put({
          assetId: asset.id,
          objectKey: asset.objectKey,
          bytes,
        });
        const updated = await markSourceAssetUploaded(options.database, asset.id);
        if (updated === undefined || updated.processingStatus !== "uploaded") {
          throw new Error("The source asset upload status was not persisted.");
        }
        return success(request, uploadedSourceAssetView(updated));
      } catch (error) {
        if (stored?.created === true) {
          await storage.remove({ assetId: asset.id, objectKey: asset.objectKey }).catch(() => undefined);
        }
        throw error;
      }
    },
  );

  api.post<{ Params: SourceAssetIdParams; Body: PrepareSourceAssetRequest }>(
    "/v1/source-assets/:assetId/commands/prepare",
    {
      schema: {
        params: SourceAssetIdParamsSchema,
        body: PrepareSourceAssetRequestSchema,
        response: {
          200: apiResponseSchema(SourceAssetPrepareViewSchema),
          202: apiResponseSchema(SourceAssetPrepareQueuedViewSchema),
          "4xx": ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const idempotencyKey = getIdempotencyKey(request);
      requireUploadConfiguration(options);
      const result = await enqueueSourceAssetQualityCheckIdempotent(options.database, options.queue, {
        assetId: request.params.assetId,
        idempotencyKey,
      });
      if (result.asset === undefined) throw new ResourceNotFoundError("Source asset", request.params.assetId);
      if (result.asset.processingStatus === "queued") {
        const data: SourceAssetPrepareQueuedView = {
          assetId: result.asset.id,
          stage: "image_quality_check",
          processingStatus: "queued",
        };
        return reply.status(result.replayed ? 200 : 202).send(success(request, data, result.jobId));
      }
      return success(request, sourceAssetProcessingView(result.asset));
    },
  );

  api.get<{ Params: SourceAssetIdParams }>(
    "/v1/source-assets/:assetId",
    {
      schema: {
        params: SourceAssetIdParamsSchema,
        response: {
          200: apiResponseSchema(SourceAssetProcessingViewSchema),
          "4xx": ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const asset = await findSourceAssetById(options.database, request.params.assetId);
      if (asset === undefined || asset.deletedAt !== null) throw new ResourceNotFoundError("Source asset", request.params.assetId);
      return success(request, sourceAssetProcessingView(asset));
    },
  );

  api.post<{
    Params: SourceAssetIdParams;
    Body: StartSyntheticRecognitionRequest;
  }>(
    "/v1/source-assets/:assetId/commands/start-recognition",
    {
      schema: {
        params: SourceAssetIdParamsSchema,
        body: StartSyntheticRecognitionRequestSchema,
        response: {
          200: apiResponseSchema(StartSyntheticRecognitionViewSchema),
          202: apiResponseSchema(StartSyntheticRecognitionViewSchema),
          "4xx": ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const idempotencyKey = getIdempotencyKey(request);
      const result = await startSyntheticRecognitionIdempotent(options.database, {
        assetId: request.params.assetId,
        caseId: uuidv7(),
        idempotencyKey,
        idempotencyRecordId: uuidv7(),
        enqueueRunNext: async (transaction, caseId) =>
          enqueueRunNextTransactional(transaction, options.queue, {
            jobId: uuidv7(),
            caseId,
            expectedVersion: 0,
            assetId: SYNTHETIC_PARSE_ASSET_ID,
            traceId: traceId(request),
          }),
      });
      const data: StartSyntheticRecognitionView = {
        assetId: result.asset.id,
        caseId: result.case.id,
        state: "awaiting_evidence",
        stateVersion: 0,
        recognitionMode: "synthetic_demo",
        recognitionSource: "synthetic_fixture",
        uploadedAssetUsedForRecognition: false,
        processingStatus: "queued",
      };
      return reply
        .status(result.replayed ? 200 : 202)
        .send(success(request, data, result.jobId));
    },
  );

  api.post<{ Body: CreateCaseRequest }>(
    "/v1/cases",
    {
      schema: {
        body: CreateCaseRequestSchema,
        response: {
          200: apiResponseSchema(CaseViewSchema),
          201: apiResponseSchema(CaseViewSchema),
          "4xx": ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const idempotencyKey = getIdempotencyKey(request);
      const result = await createSyntheticCaseIdempotent(options.database, {
        idempotencyRecordId: uuidv7(),
        idempotencyKey,
        tenantId: uuidv7(),
        studentId: uuidv7(),
        caseId: uuidv7(),
      });

      return reply
        .status(result.replayed ? 200 : 201)
        .send(success(request, toCaseView(result.case)));
    },
  );

  api.get<{ Params: CaseIdParams }>(
    "/v1/cases/:caseId",
    {
      schema: {
        params: CaseIdParamsSchema,
        response: {
          200: apiResponseSchema(CaseViewSchema),
          "4xx": ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const row = await findCaseById(options.database, request.params.caseId);
      if (row === undefined) {
        throw new ResourceNotFoundError("Case", request.params.caseId);
      }
      return success(request, toCaseView(row));
    },
  );

  api.get<{ Params: CaseIdParams }>(
    "/v1/cases/:caseId/hypotheses",
    {
      schema: {
        params: CaseIdParamsSchema,
        response: {
          200: apiResponseSchema(HypothesesViewSchema),
          "4xx": ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const caseRow = await findCaseById(
        options.database,
        request.params.caseId,
      );
      if (caseRow === undefined) {
        throw new ResourceNotFoundError("Case", request.params.caseId);
      }

      const event = await findLatestCaseEvidenceEventByType(
        options.database,
        caseRow.id,
        "hypotheses_generated",
      );
      if (event === undefined) {
        throw new ResourceNotFoundError(
          "Hypotheses for case",
          request.params.caseId,
        );
      }

      const generated = event.payload as unknown as FormHypothesesOutput;
      if (
        !Array.isArray(generated.candidates) ||
        generated.candidates.length < 2 ||
        typeof generated.probe !== "object" ||
        generated.probe === null
      ) {
        throw new ApiHttpError(
          500,
          "STORED_EVENT_INVALID",
          "The stored hypotheses event is invalid.",
        );
      }
      const {
        expectedChoiceId: _expectedChoiceId,
        scoringRule: _scoringRule,
        ...probe
      } = generated.probe;
      const view: HypothesesView = {
        caseId: caseRow.id,
        stateVersion: caseRow.stateVersion,
        candidates: generated.candidates,
        probe,
      };
      return success(request, view);
    },
  );

  api.get<{ Params: CaseIdParams }>(
    "/v1/cases/:caseId/extraction",
    {
      schema: {
        params: CaseIdParamsSchema,
        response: {
          200: apiResponseSchema(ExtractionViewSchema),
          "4xx": ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const caseRow = await findCaseById(options.database, request.params.caseId);
      if (caseRow === undefined) {
        throw new ResourceNotFoundError("Case", request.params.caseId);
      }
      const event = await findLatestCaseEvidenceEventByType(
        options.database,
        caseRow.id,
        "evidence_ingested",
      );
      return success(request, extractionView(caseRow, event).view);
    },
  );

  api.post<{ Params: CaseIdParams; Body: ConfirmExtractionRequest }>(
    "/v1/cases/:caseId/extraction/confirm",
    {
      schema: {
        params: CaseIdParamsSchema,
        body: ConfirmExtractionRequestSchema,
        response: {
          200: apiResponseSchema(CaseViewSchema),
          "4xx": ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const idempotencyKey = `confirm-extraction:${getIdempotencyKey(request)}`;
      const eventPayload = extractionConfirmationPayload(request.body);
      const existingEvent = await findEvidenceEventByIdempotencyKey(
        options.database,
        idempotencyKey,
      );

      if (existingEvent !== undefined) {
        if (
          existingEvent.caseId !== request.params.caseId ||
          existingEvent.eventType !== "recognition_confirmed" ||
          !isSamePayload(existingEvent.payload, eventPayload)
        ) {
          throw new ApiHttpError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "The idempotency key belongs to another write request.",
          );
        }
        const replayedCase = await findCaseById(
          options.database,
          request.params.caseId,
        );
        if (replayedCase === undefined) {
          throw new ResourceNotFoundError("Case", request.params.caseId);
        }
        await scheduleCaseSourceAssetRetention(options.database, request.params.caseId, existingEvent.occurredAt);
        return success(request, toCaseView(replayedCase));
      }

      const caseRow = await findCaseById(
        options.database,
        request.params.caseId,
      );
      if (caseRow === undefined) {
        throw new ResourceNotFoundError("Case", request.params.caseId);
      }
      if (caseRow.stateVersion !== request.body.expectedVersion) {
        throw new VersionConflictError(
          request.params.caseId,
          request.body.expectedVersion,
        );
      }

      const extraction = caseRow.state === "awaiting_confirmation"
        ? extractionView(
            caseRow,
            await findLatestCaseEvidenceEventByType(
              options.database,
              caseRow.id,
              "evidence_ingested",
            ),
        )
        : undefined;
      const confirmedItemIds = new Set(request.body.confirmedItemIds);
      if (extraction !== undefined) {
        const hasUnknownItem =
          [...confirmedItemIds].some((itemId) => !extraction.itemIds.has(itemId)) ||
          request.body.corrections.some(
            (correction) => !extraction.itemIds.has(correction.itemId),
          );
        if (hasUnknownItem) {
          throw new ApiHttpError(
            400,
            "INVALID_INPUT",
            "Every confirmed item must belong to the stored extraction.",
          );
        }
      }
      if (
        request.body.corrections.some(
          (correction) => !confirmedItemIds.has(correction.itemId),
        )
      ) {
        throw new ApiHttpError(
          400,
          "INVALID_INPUT",
          "Every correction must refer to a confirmed item.",
        );
      }
      const realExtraction = extraction?.view.recognitionSource === "real_alibaba";
      if (realExtraction && request.body.reviewedQuestions === undefined) {
        throw new ApiHttpError(
          400,
          "INVALID_INPUT",
          "Real extraction confirmation requires reviewed question boundaries.",
        );
      }
      if (realExtraction && request.body.corrections.length > 0) {
        throw new ApiHttpError(
          400,
          "INVALID_INPUT",
          "Real extraction questions must use the reviewed question structure.",
        );
      }
      if (!realExtraction && request.body.reviewedQuestions !== undefined) {
        throw new ApiHttpError(
          400,
          "INVALID_INPUT",
          "Reviewed question boundaries are only accepted for real extraction.",
        );
      }
      if (request.body.reviewedQuestions?.some(
        (question) =>
          !confirmedItemIds.has(question.sourceItemId) ||
          question.prompt.trim().length === 0 ||
          (question.studentAnswer !== null && question.studentAnswer.trim().length === 0),
      )) {
        throw new ApiHttpError(
          400,
          "INVALID_INPUT",
          "Every reviewed question must belong to a confirmed extraction item.",
        );
      }
      const representedItemIds = new Set(request.body.reviewedQuestions?.map(question => question.sourceItemId) ?? []);
      if (realExtraction && [...confirmedItemIds].some(itemId => !representedItemIds.has(itemId))) {
        throw new ApiHttpError(
          400,
          "INVALID_INPUT",
          "Every confirmed extraction item must contain at least one reviewed question.",
        );
      }

      const event = {
        eventId: uuidv7(),
        occurredAt: new Date().toISOString(),
        type: "recognition_confirmed" as const,
      };
      const next = transitionCase(
        {
          id: caseRow.id,
          status: caseRow.state,
          mastery: "insufficient_evidence",
          version: caseRow.stateVersion,
          replanCount: caseRow.replanCount,
          appliedEventIds: [],
        },
        event,
      );

      const persisted = await persistCaseTransition(options.database, {
        caseId: caseRow.id,
        expectedVersion: request.body.expectedVersion,
        nextState: next.status,
        event: {
          id: event.eventId,
          tenantId: caseRow.tenantId,
          studentId: caseRow.studentId,
          caseId: caseRow.id,
          eventType: event.type,
          sourceType: "student_confirmation",
          payload: eventPayload,
          occurredAt: new Date(event.occurredAt),
          idempotencyKey,
        },
      });

      if (!persisted.applied) {
        const replayedEvent = await findEvidenceEventByIdempotencyKey(
          options.database,
          idempotencyKey,
        );
        if (
          replayedEvent === undefined ||
          replayedEvent.caseId !== request.params.caseId ||
          replayedEvent.eventType !== "recognition_confirmed" ||
          !isSamePayload(replayedEvent.payload, eventPayload)
        ) {
          throw new ApiHttpError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "The idempotency key belongs to another write request.",
          );
        }
      }

      const confirmedCase = await findCaseById(options.database, caseRow.id);
      if (confirmedCase === undefined) {
        throw new ResourceNotFoundError("Case", caseRow.id);
      }
      if (extraction?.view.recognitionSource === "real_alibaba") {
        await scheduleCaseSourceAssetRetention(options.database, caseRow.id, new Date(event.occurredAt));
      }
      return success(request, toCaseView(confirmedCase));
    },
  );

  api.post<{ Params: CaseIdParams; Body: SubmitAttemptRequest }>(
    "/v1/cases/:caseId/attempts",
    {
      schema: {
        params: CaseIdParamsSchema,
        body: SubmitAttemptRequestSchema,
        response: {
          200: apiResponseSchema(AttemptViewSchema),
          "4xx": ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const idempotencyKey = `submit-attempt:${getIdempotencyKey(request)}`;
      const requestPayload = attemptRequestPayload(request.body);
      const existingEvent = await findEvidenceEventByIdempotencyKey(
        options.database,
        idempotencyKey,
      );

      if (existingEvent !== undefined) {
        if (
          existingEvent.caseId !== request.params.caseId ||
          existingEvent.eventType !== "probe_evaluated" ||
          !isRecord(existingEvent.payload.request) ||
          !isSamePayload(existingEvent.payload.request, requestPayload)
        ) {
          throw new ApiHttpError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "The idempotency key belongs to another write request.",
          );
        }
        const replayedCase = await findCaseById(
          options.database,
          request.params.caseId,
        );
        if (replayedCase === undefined) {
          throw new ResourceNotFoundError("Case", request.params.caseId);
        }
        return success(
          request,
          attemptViewFromEvent(replayedCase, existingEvent),
        );
      }

      const caseRow = await findCaseById(
        options.database,
        request.params.caseId,
      );
      if (caseRow === undefined) {
        throw new ResourceNotFoundError("Case", request.params.caseId);
      }
      if (caseRow.stateVersion !== request.body.expectedVersion) {
        throw new VersionConflictError(
          request.params.caseId,
          request.body.expectedVersion,
        );
      }
      if (caseRow.state !== "probe_required") {
        throw new CaseTransitionError(
          "invalid_transition",
          `Event probe_evaluated requires probe_required, received ${caseRow.state}.`,
        );
      }

      const hypothesesEvent = await findLatestCaseEvidenceEventByType(
        options.database,
        caseRow.id,
        "hypotheses_generated",
      );
      if (hypothesesEvent === undefined) {
        throw new ApiHttpError(
          500,
          "STORED_EVENT_INVALID",
          "The case has no hypotheses event for its required probe.",
        );
      }
      const generated = hypothesesEvent.payload as unknown as FormHypothesesOutput;
      if (
        typeof generated.probe !== "object" ||
        generated.probe === null ||
        generated.probe.id !== request.body.probeId
      ) {
        throw new ApiHttpError(
          400,
          "INVALID_INPUT",
          "The submitted probe does not match the active case probe.",
        );
      }

      let score;
      try {
        score = scoreProbeAttempt(
          generated.probe,
          request.body.selectedChoiceId,
        );
      } catch (error) {
        if (error instanceof ProbeScoringError) {
          throw new ApiHttpError(
            error.code === "invalid_choice" ? 400 : 500,
            error.code === "invalid_choice"
              ? "INVALID_INPUT"
              : "STORED_EVENT_INVALID",
            error.message,
          );
        }
        throw error;
      }

      const event = {
        eventId: uuidv7(),
        occurredAt: new Date().toISOString(),
        type: "probe_evaluated" as const,
        selectedHypothesisId: score.selectedHypothesisId,
        passed: score.passed,
      };
      const next = transitionCase(
        {
          id: caseRow.id,
          status: caseRow.state,
          mastery: "insufficient_evidence",
          version: caseRow.stateVersion,
          replanCount: caseRow.replanCount,
          appliedEventIds: [],
        },
        event,
      );
      const eventPayload = {
        request: requestPayload,
        result: {
          probeId: request.body.probeId,
          selectedChoiceId: request.body.selectedChoiceId,
          passed: score.passed,
          selectedHypothesisId: score.selectedHypothesisId,
          scoringMethod: score.scoringMethod,
        },
        hypothesesEventId: hypothesesEvent.id,
      };
      const persisted = await persistCaseTransition(options.database, {
        caseId: caseRow.id,
        expectedVersion: request.body.expectedVersion,
        nextState: next.status,
        event: {
          id: event.eventId,
          tenantId: caseRow.tenantId,
          studentId: caseRow.studentId,
          caseId: caseRow.id,
          eventType: event.type,
          sourceType: "student_probe_attempt",
          sourceRef: request.body.probeId,
          payload: eventPayload,
          confidence: "1.0000",
          occurredAt: new Date(event.occurredAt),
          idempotencyKey,
        },
      });

      let persistedEvent: LearningEvidenceEventRow | undefined;
      if (persisted.applied) {
        persistedEvent = await findEvidenceEventByIdempotencyKey(
          options.database,
          idempotencyKey,
        );
      } else {
        persistedEvent = await findEvidenceEventByIdempotencyKey(
          options.database,
          idempotencyKey,
        );
        if (
          persistedEvent === undefined ||
          persistedEvent.caseId !== request.params.caseId ||
          persistedEvent.eventType !== "probe_evaluated" ||
          !isRecord(persistedEvent.payload.request) ||
          !isSamePayload(persistedEvent.payload.request, requestPayload)
        ) {
          throw new ApiHttpError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "The idempotency key belongs to another write request.",
          );
        }
      }

      if (persistedEvent === undefined) {
        throw new ApiHttpError(
          500,
          "STORED_EVENT_INVALID",
          "The probe evaluation event was not persisted.",
        );
      }
      const attemptedCase = await findCaseById(options.database, caseRow.id);
      if (attemptedCase === undefined) {
        throw new ResourceNotFoundError("Case", caseRow.id);
      }
      return success(
        request,
        attemptViewFromEvent(attemptedCase, persistedEvent),
      );
    },
  );

  api.get<{ Params: StudentIdParams }>(
    "/v1/students/:studentId/profile",
    {
      schema: {
        params: StudentIdParamsSchema,
        response: { 200: apiResponseSchema(StudentProfileViewSchema), "4xx": ApiErrorResponseSchema, 500: ApiErrorResponseSchema },
      },
    },
    async (request) => {
      const student = await findStudentProfile(options.database, request.params.studentId);
      if (student === undefined) throw new ResourceNotFoundError("Student", request.params.studentId);
      return success(request, studentProfileView(student));
    },
  );

  api.post<{ Body: CreateRealOcrBatchRequest }>(
    "/v1/ocr-batches",
    { schema: { body: CreateRealOcrBatchRequestSchema, response: { 200: apiResponseSchema(RealOcrBatchViewSchema), 201: apiResponseSchema(RealOcrBatchViewSchema), "4xx": ApiErrorResponseSchema, 500: ApiErrorResponseSchema } } },
    async (request, reply) => {
      const result = await createRealOcrBatch(options.database, { idempotencyKey: getIdempotencyKey(request), batchId: uuidv7(), caseId: uuidv7(), studentId: request.body.studentId });
      const batch = await findOcrBatch(options.database, result.batch.id);
      if (batch === undefined) throw new ResourceNotFoundError("OCR batch", result.batch.id);
      return reply.status(result.replayed ? 200 : 201).send(success(request, realOcrBatchView(batch)));
    },
  );

  api.get<{ Params: OcrBatchIdParams }>(
    "/v1/ocr-batches/:batchId",
    { schema: { params: OcrBatchIdParamsSchema, response: { 200: apiResponseSchema(RealOcrBatchViewSchema), "4xx": ApiErrorResponseSchema, 500: ApiErrorResponseSchema } } },
    async (request) => {
      const batch = await findOcrBatch(options.database, request.params.batchId);
      if (batch === undefined) throw new ResourceNotFoundError("OCR batch", request.params.batchId);
      return success(request, realOcrBatchView(batch));
    },
  );

  api.post<{ Params: OcrBatchIdParams; Body: AddRealOcrBatchPageRequest }>(
    "/v1/ocr-batches/:batchId/pages/uploads",
    { schema: { params: OcrBatchIdParamsSchema, body: AddRealOcrBatchPageRequestSchema, response: { 200: apiResponseSchema(AddedRealOcrBatchPageViewSchema), 201: apiResponseSchema(AddedRealOcrBatchPageViewSchema), "4xx": ApiErrorResponseSchema, 500: ApiErrorResponseSchema } } },
    async (request, reply) => {
      const { secret } = requireUploadConfiguration(options);
      const batch = await findOcrBatch(options.database, request.params.batchId);
      if (batch === undefined) throw new ResourceNotFoundError("OCR batch", request.params.batchId);
      const key = getIdempotencyKey(request);
      const assetResult = await initiateSourceAssetUpload(options.database, {
        assetId: uuidv7(), idempotencyRecordId: uuidv7(), idempotencyKey: `ocr-page-asset:${key}`,
        studentId: batch.batch.studentId, caseId: batch.batch.caseId, mimeType: request.body.mimeType, byteSize: request.body.byteSize, sha256: request.body.sha256, tenantId: batch.batch.tenantId,
      });
      const pageResult = await attachOcrBatchPage(options.database, { batchId: batch.batch.id, pageId: uuidv7(), asset: assetResult.asset, idempotencyKey: key });
      const expiresAt = Date.now() + 10 * 60 * 1000;
      const token = createSourceAssetUploadToken(secret, { assetId: assetResult.asset.id, studentId: batch.batch.studentId, sha256: assetResult.asset.sha256, byteSize: assetResult.asset.byteSize, mimeType: assetResult.asset.mimeType, expiresAt });
      const data: AddedRealOcrBatchPageView = { page: { pageId: pageResult.page.id, assetId: assetResult.asset.id, order: pageResult.page.pageOrder, status: "pending_upload", retryable: false, needsReview: false }, upload: { method: "PUT", path: `/api/v1/source-assets/${assetResult.asset.id}/content`, token, expiresAt: new Date(expiresAt).toISOString(), mimeType: assetResult.asset.mimeType as AddedRealOcrBatchPageView["upload"]["mimeType"], byteSize: assetResult.asset.byteSize } };
      return reply.status(assetResult.replayed || pageResult.replayed ? 200 : 201).send(success(request, data));
    },
  );

  api.post<{ Params: OcrBatchIdParams; Body: StartRealOcrBatchRequest }>(
    "/v1/ocr-batches/:batchId/commands/start-recognition",
    { schema: { params: OcrBatchIdParamsSchema, body: StartRealOcrBatchRequestSchema, response: { 200: apiResponseSchema(StartRealOcrBatchViewSchema), 202: apiResponseSchema(StartRealOcrBatchViewSchema), "4xx": ApiErrorResponseSchema, 500: ApiErrorResponseSchema } } },
    async (request, reply) => {
      const result = await startRealOcrBatch(options.database, { batchId: request.params.batchId, idempotencyKey: getIdempotencyKey(request), guardianConfirmed: request.body.guardianConfirmed, enqueue: (transaction) => enqueueRealOcrBatchTransactional(transaction, options.queue, { jobId: uuidv7(), batchId: request.params.batchId, traceId: traceId(request) }) });
      const data: StartRealOcrBatchView = { batchId: result.batch.id, caseId: result.batch.caseId, status: "processing", processingNoticeAccepted: true };
      return reply.status(result.replayed ? 200 : 202).send(success(request, data, result.jobId));
    },
  );

  api.delete<{ Params: OcrBatchPageParams }>(
    "/v1/ocr-batches/:batchId/pages/:pageId",
    { schema: { params: OcrBatchPageParamsSchema, response: { 200: apiResponseSchema(RealOcrBatchViewSchema), "4xx": ApiErrorResponseSchema, 500: ApiErrorResponseSchema } } },
    async (request) => {
      if (options.uploadStorage === undefined) throw new ApiHttpError(503, "UPLOAD_NOT_CONFIGURED", "Source asset storage is not configured.", true);
      const key = getIdempotencyKey(request);
      const existing = await findOcrBatch(options.database, request.params.batchId);
      const asset = existing?.pages.find(({ page }) => page.id === request.params.pageId)?.asset;
      if (asset !== undefined) await options.uploadStorage.remove({ assetId: asset.id, objectKey: asset.objectKey });
      await removeOcrBatchPage(options.database, {
        ...request.params,
        idempotencyKey: key,
      });
      if (asset !== undefined) await markSourceAssetDeleted(options.database, asset.id, new Date());
      const batch = await findOcrBatch(options.database, request.params.batchId);
      if (batch === undefined) throw new ResourceNotFoundError("OCR batch", request.params.batchId);
      return success(request, realOcrBatchView(batch));
    },
  );

  api.post<{ Params: OcrBatchIdParams; Body: ReorderRealOcrBatchPagesRequest }>(
    "/v1/ocr-batches/:batchId/commands/reorder-pages",
    {
      schema: {
        params: OcrBatchIdParamsSchema,
        body: ReorderRealOcrBatchPagesRequestSchema,
        response: {
          200: apiResponseSchema(RealOcrBatchViewSchema),
          "4xx": ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
        },
      },
    },
    async (request) => {
      await reorderOcrBatchPages(options.database, {
        batchId: request.params.batchId,
        pageIds: request.body.pageIds,
        idempotencyKey: getIdempotencyKey(request),
      });
      const batch = await findOcrBatch(options.database, request.params.batchId);
      if (batch === undefined) throw new ResourceNotFoundError("OCR batch", request.params.batchId);
      return success(request, realOcrBatchView(batch));
    },
  );

  api.post<{ Params: OcrBatchPageParams; Body: AddRealOcrBatchPageRequest }>(
    "/v1/ocr-batches/:batchId/pages/:pageId/commands/replace",
    { schema: { params: OcrBatchPageParamsSchema, body: AddRealOcrBatchPageRequestSchema, response: { 200: apiResponseSchema(AddedRealOcrBatchPageViewSchema), 201: apiResponseSchema(AddedRealOcrBatchPageViewSchema), "4xx": ApiErrorResponseSchema, 500: ApiErrorResponseSchema } } },
    async (request, reply) => {
      const { secret } = requireUploadConfiguration(options);
      const batch = await findOcrBatch(options.database, request.params.batchId);
      if (batch === undefined) throw new ResourceNotFoundError("OCR batch", request.params.batchId);
      const key = getIdempotencyKey(request);
      const assetResult = await initiateSourceAssetUpload(options.database, { assetId: uuidv7(), idempotencyRecordId: uuidv7(), idempotencyKey: `ocr-page-replace-asset:${key}`, studentId: batch.batch.studentId, caseId: batch.batch.caseId, mimeType: request.body.mimeType, byteSize: request.body.byteSize, sha256: request.body.sha256, tenantId: batch.batch.tenantId });
      const page = await replaceOcrBatchPage(options.database, { batchId: batch.batch.id, pageId: request.params.pageId, asset: assetResult.asset });
      const expiresAt = Date.now() + 10 * 60 * 1000;
      const token = createSourceAssetUploadToken(secret, { assetId: assetResult.asset.id, studentId: batch.batch.studentId, sha256: assetResult.asset.sha256, byteSize: assetResult.asset.byteSize, mimeType: assetResult.asset.mimeType, expiresAt });
      const data: AddedRealOcrBatchPageView = { page: { pageId: page.id, assetId: assetResult.asset.id, order: page.pageOrder, status: "pending_upload", retryable: false, needsReview: false }, upload: { method: "PUT", path: `/api/v1/source-assets/${assetResult.asset.id}/content`, token, expiresAt: new Date(expiresAt).toISOString(), mimeType: assetResult.asset.mimeType as AddedRealOcrBatchPageView["upload"]["mimeType"], byteSize: assetResult.asset.byteSize } };
      return reply.status(assetResult.replayed ? 200 : 201).send(success(request, data));
    },
  );

  api.post<{ Params: OcrBatchIdParams; Body: StartRealOcrBatchRequest }>(
    "/v1/ocr-batches/:batchId/commands/retry-recognition",
    { schema: { params: OcrBatchIdParamsSchema, body: StartRealOcrBatchRequestSchema, response: { 200: apiResponseSchema(StartRealOcrBatchViewSchema), 202: apiResponseSchema(StartRealOcrBatchViewSchema), "4xx": ApiErrorResponseSchema, 500: ApiErrorResponseSchema } } },
    async (request, reply) => {
      const current = await findOcrBatch(options.database, request.params.batchId);
      if (current === undefined) throw new ResourceNotFoundError("OCR batch", request.params.batchId);
      if (current.batch.status !== "retryable_error") throw new OcrBatchIntentError("Only a retryable recognition failure can be retried.");
      const result = await startRealOcrBatch(options.database, { batchId: request.params.batchId, idempotencyKey: getIdempotencyKey(request), guardianConfirmed: request.body.guardianConfirmed, retry: true, enqueue: (transaction) => enqueueRealOcrBatchTransactional(transaction, options.queue, { jobId: uuidv7(), batchId: request.params.batchId, traceId: traceId(request) }) });
      const data: StartRealOcrBatchView = { batchId: result.batch.id, caseId: result.batch.caseId, status: "processing", processingNoticeAccepted: true };
      return reply.status(result.replayed ? 200 : 202).send(success(request, data, result.jobId));
    },
  );

  api.put<{ Params: StudentIdParams; Body: UpdateStudentProfileRequest }>(
    "/v1/students/:studentId/profile",
    {
      schema: {
        params: StudentIdParamsSchema,
        body: UpdateStudentProfileRequestSchema,
        response: { 200: apiResponseSchema(StudentProfileViewSchema), "4xx": ApiErrorResponseSchema, 500: ApiErrorResponseSchema },
      },
    },
    async (request) => {
      const idempotencyKey = getIdempotencyKey(request);
      try {
        const result = await updateStudentProfileIdempotent(options.database, {
          studentId: request.params.studentId,
          idempotencyKey,
          requestHash: profileRequestHash(request.body),
          ...request.body,
        });
        if (result.kind === "missing") throw new ResourceNotFoundError("Student", request.params.studentId);
        return success(request, studentProfileView(result.student));
      } catch (error) {
        if (error instanceof StudentProfileVersionConflictError) {
          throw new ApiHttpError(409, "VERSION_CONFLICT", "Your learning range was changed elsewhere. Refresh and save again.");
        }
        if (error instanceof StudentProfileIdempotencyKeyReusedError) {
          throw new ApiHttpError(409, "IDEMPOTENCY_KEY_REUSED", "This save key belongs to a different profile update.");
        }
        throw error;
      }
    },
  );

  api.get<{ Params: StudentIdParams }>(
    "/v1/students/:studentId/today",
    {
      schema: {
        params: StudentIdParamsSchema,
        response: {
          200: apiResponseSchema(TodayTasksViewSchema),
          "4xx": ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const student = await findStudentById(
        options.database,
        request.params.studentId,
      );
      if (student === undefined) {
        throw new ResourceNotFoundError(
          "Student",
          request.params.studentId,
        );
      }
      const taskRows = await findTasksByStudentId(
        options.database,
        student.id,
      );
      const currentTaskId = await findCurrentActionableTaskId(
        options.database,
        student.id,
      );
      const timeZone = requireValidStudentTimeZone(student.timezone);
      return success(request, {
        studentId: student.id,
        timeZone,
        profile: studentProfileView(student),
        currentTaskId,
        tasks: taskRows.map(toLearningTaskView),
        overview: await findTodayOverview(options.database, {
          studentId: student.id,
          timeZone,
          now: clock.now(),
        }),
      });
    },
  );

  api.get<{ Params: StudentIdParams }>(
    "/v1/students/:studentId/progress",
    {
      schema: {
        params: StudentIdParamsSchema,
        response: { 200: apiResponseSchema(StudentProgressViewSchema), "4xx": ApiErrorResponseSchema, 500: ApiErrorResponseSchema },
      },
    },
    async (request) => {
      const student = await findStudentById(options.database, request.params.studentId);
      if (student === undefined) throw new ResourceNotFoundError("Student", request.params.studentId);
      const projection = await findStudentProgressAndReports(options.database, {
        studentId: student.id,
        tenantId: student.tenantId,
        timeZone: requireValidStudentTimeZone(student.timezone),
      });
      return success(request, projection.progress);
    },
  );

  api.get<{ Params: StudentIdParams }>(
    "/v1/students/:studentId/question-archive",
    {
      schema: {
        params: StudentIdParamsSchema,
        response: { 200: apiResponseSchema(QuestionArchiveViewSchema), "4xx": ApiErrorResponseSchema, 500: ApiErrorResponseSchema },
      },
    },
    async (request) => {
      const student = await findStudentById(options.database, request.params.studentId);
      if (student === undefined) throw new ResourceNotFoundError("Student", request.params.studentId);
      return success(request, {
        timeZone: requireValidStudentTimeZone(student.timezone),
        items: await findStudentQuestionArchive(options.database, {
          studentId: student.id,
          tenantId: student.tenantId,
        }),
      });
    },
  );

  api.get<{ Params: QuestionArchiveEntryParams }>(
    "/v1/students/:studentId/question-archive/:entryRef",
    {
      schema: {
        params: QuestionArchiveEntryParamsSchema,
        response: { 200: apiResponseSchema(QuestionArchiveDetailViewSchema), "4xx": ApiErrorResponseSchema, 500: ApiErrorResponseSchema },
      },
    },
    async (request) => {
      const student = await findStudentById(options.database, request.params.studentId);
      if (student === undefined) throw new ResourceNotFoundError("Student", request.params.studentId);
      const item = await findStudentQuestionArchiveItem(options.database, {
        studentId: student.id,
        tenantId: student.tenantId,
        entryRef: request.params.entryRef,
      });
      if (item === undefined) throw new ResourceNotFoundError("Question", request.params.entryRef);
      return success(request, {
        timeZone: requireValidStudentTimeZone(student.timezone),
        item,
      });
    },
  );

  api.post<{ Params: StudentIdParams; Body: CreateMistakeReviewRequest }>(
    "/v1/students/:studentId/question-archive/reviews",
    {
      schema: {
        params: StudentIdParamsSchema,
        body: CreateMistakeReviewRequestSchema,
        response: { 200: apiResponseSchema(LearningTaskViewSchema), "4xx": ApiErrorResponseSchema, 500: ApiErrorResponseSchema },
      },
    },
    async (request) => {
      if (options.deviceSession === undefined) throw new ApiHttpError(503, "STUDENT_SESSION_REQUIRED", "A student session is required to start a review.");
      const principal = await options.deviceSession.requirePrincipal(request.headers.cookie);
      if (principal.studentId !== request.params.studentId) throw new ResourceNotFoundError("Question", request.body.entryRef);
      const source = await findMistakeReviewSource(options.database, {
        studentId: principal.studentId,
        tenantId: principal.tenantId,
        entryRef: request.body.entryRef,
      });
      if (source === undefined) throw new ResourceNotFoundError("Question", request.body.entryRef);
      const result = await createMistakeReviewTask(options.database, {
        source,
        taskId: uuidv7(),
        eventId: uuidv7(),
        idempotencyKey: `mistake-review-create:${principal.studentId}:${request.body.entryRef}:${getIdempotencyKey(request)}`,
        createdAt: clock.now(),
      });
      return success(request, toLearningTaskView(result.task));
    },
  );

  api.post<{ Params: TaskIdParams; Body: CompleteMistakeReviewRequest }>(
    "/v1/tasks/:taskId/mistake-review/complete",
    {
      schema: {
        params: TaskIdParamsSchema,
        body: CompleteMistakeReviewRequestSchema,
        response: { 200: apiResponseSchema(MistakeReviewCompletionViewSchema), "4xx": ApiErrorResponseSchema, 500: ApiErrorResponseSchema },
      },
    },
    async (request) => {
      if (options.deviceSession === undefined) throw new ApiHttpError(503, "STUDENT_SESSION_REQUIRED", "A student session is required to complete a review.");
      const principal = await options.deviceSession.requirePrincipal(request.headers.cookie);
      const task = await findTaskById(options.database, request.params.taskId);
      if (task === undefined || task.studentId !== principal.studentId || task.tenantId !== principal.tenantId || task.taskType !== "mistake_review") throw new ResourceNotFoundError("Task", request.params.taskId);
      const idempotencyKey = `mistake-review-complete:${principal.studentId}:${task.id}:${getIdempotencyKey(request)}`;
      const existingEvent = await findEvidenceEventByIdempotencyKey(options.database, idempotencyKey);
      if (existingEvent === undefined && task.status !== "ready") throw new ApiHttpError(409, "INVALID_TASK_STATE", "This review has already been completed or is not ready.");
      const responseText = request.body.responseText.trim();
      if (responseText.length === 0) throw new ApiHttpError(400, "INVALID_INPUT", "Please write your current thinking before completing the review.");
      const completedAt = clock.now();
      const result = await completeMistakeReviewTask(options.database, {
        taskId: task.id,
        studentId: principal.studentId,
        tenantId: principal.tenantId,
        responseText,
        eventId: uuidv7(),
        idempotencyKey,
        completedAt,
      });
      const eventRequest = isRecord(result.event.payload.request) && typeof result.event.payload.request.responseText === "string"
        ? result.event.payload.request.responseText
        : responseText;
      return success(request, {
        taskId: task.id,
        status: "completed" as const,
        completedAt: result.event.occurredAt.toISOString(),
        submittedResponse: eventRequest,
      } satisfies MistakeReviewCompletionView);
    },
  );

  api.get<{ Params: StudentIdParams }>(
    "/v1/students/:studentId/reports",
    {
      schema: {
        params: StudentIdParamsSchema,
        response: { 200: apiResponseSchema(StudentFactReportsViewSchema), "4xx": ApiErrorResponseSchema, 500: ApiErrorResponseSchema },
      },
    },
    async (request) => {
      const student = await findStudentById(options.database, request.params.studentId);
      if (student === undefined) throw new ResourceNotFoundError("Student", request.params.studentId);
      const projection = await findStudentProgressAndReports(options.database, {
        studentId: student.id,
        tenantId: student.tenantId,
        timeZone: requireValidStudentTimeZone(student.timezone),
      });
      return success(request, projection.reports);
    },
  );

  api.get<{ Params: TaskIdParams }>(
    "/v1/tasks/:taskId",
    {
      schema: {
        params: TaskIdParamsSchema,
        response: {
          200: apiResponseSchema(LearningTaskViewSchema),
          "4xx": ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const task = await findTaskById(options.database, request.params.taskId);
      if (task === undefined) {
        throw new ResourceNotFoundError("Task", request.params.taskId);
      }
      const taskView = toLearningTaskView(task);
      const evaluation = task.status === "completed" && (task.taskType === "d1_retest" || task.taskType === "d7_retest")
        ? await findTaskRetestEvaluationEvent(options.database, task.id)
        : undefined;
      return success(request, withRetestAttemptSummary(taskView, evaluation));
    },
  );

  api.post<{ Params: TaskIdParams; Body: CreateTutorTurnRequest }>(
    "/v1/tasks/:taskId/tutor-turns",
    {
      schema: {
        params: TaskIdParamsSchema,
        body: CreateTutorTurnRequestSchema,
        response: {
          200: apiResponseSchema(TutorTurnViewSchema),
          202: apiResponseSchema(TutorTurnViewSchema),
          "4xx": ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (options.deviceSession === undefined) throw new ApiHttpError(503, "STUDENT_SESSION_REQUIRED", "A student session is required for tutor guidance.", false);
      const principal = await options.deviceSession.requirePrincipal(request.headers.cookie);
      const task = await findTaskById(options.database, request.params.taskId);
      if (task === undefined) throw new ResourceNotFoundError("Task", request.params.taskId);
      const caseRow = await findCaseById(options.database, task.caseId);
      if (caseRow === undefined || caseRow.studentId !== principal.studentId || caseRow.tenantId !== principal.tenantId) throw new ResourceNotFoundError("Task", request.params.taskId);
      if (task.taskType !== "guided_intervention" || task.status !== "ready") throw new TutorTurnRejectedError("TASK_NOT_READY");
      if (caseRow.stateVersion !== request.body.expectedVersion) throw new VersionConflictError(task.caseId, request.body.expectedVersion);
      const rawSteps = task.payload.steps;
      const step = Array.isArray(rawSteps) ? rawSteps.find((candidate) => isRecord(candidate) && candidate.id === request.body.stepId) : undefined;
      if (!isRecord(step) || typeof step.title !== "string" || typeof step.content !== "string") throw new ApiHttpError(400, "INVALID_INPUT", "That learning step is not available.");
      const learnerText = deidentifyTutorText(request.body.learnerText);
      if (learnerText.length === 0) throw new ApiHttpError(400, "INVALID_INPUT", "Please write one short thought before asking for guidance.");
      const student = await findStudentById(options.database, principal.studentId);
      if (student === undefined) throw new ResourceNotFoundError("Student", principal.studentId);
      const idempotencyKey = getIdempotencyKey(request);
      if (!isUuidV7(idempotencyKey)) throw new ApiHttpError(400, "INVALID_INPUT", "Idempotency-Key must be a UUIDv7.");
      const previousTurns = await findTutorSessionHistory(options.database, {
        taskId: task.id,
        studentId: principal.studentId,
        tenantId: principal.tenantId,
      });
      const history = tutorHistoryContext(previousTurns);
      const turnId = uuidv7();
      const sessionId = uuidv7();
      const queued = await queueTutorTurn(options.database, {
        turnId,
        sessionId,
        tenantId: principal.tenantId,
        studentId: principal.studentId,
        caseId: task.caseId,
        taskId: task.id,
        idempotencyKey,
        requestHash: tutorRequestHash(request.body, learnerText),
        policyVersion: TUTOR_POLICY_VERSION,
        now: clock.now(),
        context: {
          subject: student.subject === "english" ? "英语" : "学习",
          grade: student.grade === null ? "当前年级" : `${student.grade}年级`,
          taskTitle: task.title,
          stepTitle: step.title,
          stepContent: step.content,
          learnerText,
          ...(history.length === 0 ? {} : { history }),
        },
      });
      if (!queued.replayed && queued.turn.status === "queued") {
        await enqueueTutorTurn(options.queue, { turnId: queued.turn.id, traceId: traceId(request) });
      }
      const view = tutorTurnView(queued.turn);
      return reply.status(view.status === "queued" || view.status === "running" ? 202 : 200).send(success(request, view));
    },
  );

  api.get<{ Params: TaskIdParams }>(
    "/v1/tasks/:taskId/tutor-session",
    {
      schema: {
        params: TaskIdParamsSchema,
        response: {
          200: apiResponseSchema(TutorSessionViewSchema),
          "4xx": ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
        },
      },
    },
    async (request) => {
      if (options.deviceSession === undefined) throw new ApiHttpError(503, "STUDENT_SESSION_REQUIRED", "A student session is required for tutor guidance.", false);
      const principal = await options.deviceSession.requirePrincipal(request.headers.cookie);
      const task = await findTaskById(options.database, request.params.taskId);
      if (task === undefined) throw new ResourceNotFoundError("Tutor session", request.params.taskId);
      const caseRow = await findCaseById(options.database, task.caseId);
      if (caseRow === undefined || task.studentId !== principal.studentId || task.tenantId !== principal.tenantId || caseRow.studentId !== principal.studentId || caseRow.tenantId !== principal.tenantId) {
        throw new ResourceNotFoundError("Tutor session", request.params.taskId);
      }
      const turns = await findTutorSessionHistory(options.database, {
        taskId: task.id,
        studentId: principal.studentId,
        tenantId: principal.tenantId,
      });
      return success(request, tutorSessionView(task.id, turns));
    },
  );

  api.post<{ Params: TaskIdParams; Body: SubmitRetestAttemptRequest }>(
    "/v1/tasks/:taskId/attempts",
    {
      schema: {
        params: TaskIdParamsSchema,
        body: SubmitRetestAttemptRequestSchema,
        response: {
          200: apiResponseSchema(RetestAttemptViewSchema),
          "4xx": ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const requestIdempotencyKey = getIdempotencyKey(request);
      const d1IdempotencyKey = `d1-retest-attempt:${requestIdempotencyKey}`;
      const d7IdempotencyKey = `d7-retest-attempt:${requestIdempotencyKey}`;
      const requestPayload = d1AttemptRequestPayload(request.body);
      const existingKeys = [d1IdempotencyKey, d7IdempotencyKey];
      for (const existingKey of existingKeys) {
        const existing = await findEvidenceEventByIdempotencyKey(options.database, existingKey);
        if (existing === undefined) continue;
        if (!isMatchingRetestEvaluationEvent(existing, request.params.taskId, requestPayload)) {
          throw new ApiHttpError(409, "IDEMPOTENCY_KEY_REUSED", "The idempotency key belongs to another write request.");
        }
        const replay = isD7EvaluationEvent(existing)
          ? await d7RetestAttemptViewFromEvent(existing)
          : await d1RetestAttemptViewFromEvent(options.database, existing);
        return success(request, replay.view, replay.jobId);
      }

      const taskRow = await findTaskById(options.database, request.params.taskId);
      if (taskRow === undefined) {
        throw new ResourceNotFoundError("Task", request.params.taskId);
      }
      const caseRow = await findCaseById(options.database, taskRow.caseId);
      if (caseRow === undefined) {
        throw new ResourceNotFoundError("Case", taskRow.caseId);
      }
      const idempotencyKey = taskRow.taskType === "d7_retest"
        ? d7IdempotencyKey
        : d1IdempotencyKey;
      if (taskRow.taskType === "d7_retest") {
        if (caseRow.stateVersion !== request.body.expectedVersion) {
          throw new VersionConflictError(caseRow.id, request.body.expectedVersion);
        }
        if (taskRow.status !== "ready" || caseRow.state !== "d7_scheduled") {
          throw new InvalidTaskStateError("Only a ready D7 retest in d7_scheduled can be submitted.");
        }
        const d7Authenticity = taskContentAuthenticity(taskRow, !caseRow.synthetic && !caseRow.simulation);
        const item = privateRetestItemFromTask(taskRow);
        if (item.id !== request.body.itemId) {
          throw new ApiHttpError(400, "INVALID_INPUT", "The submitted item does not belong to this D7 task.");
        }
        const score = scoreSingleChoiceRetest({
          itemId: item.id,
          selectedChoiceId: request.body.selectedChoiceId,
          expectedChoiceId: item.expectedChoiceId,
          availableChoiceIds: item.choices.map(({ id }) => id),
        });
        const evaluatedAt = clock.now();
        const eventId = uuidv7();
        const canReplan = !score.passed && caseRow.replanCount < 2;
        const replanJobId = canReplan ? uuidv7() : null;
        const interventionJobId = canReplan ? uuidv7() : null;
        const domainEvent = {
          eventId,
          occurredAt: evaluatedAt.toISOString(),
          type: "retest_evaluated" as const,
          kind: "d7" as const,
          passed: score.passed,
        };
        const next = transitionCase({
          id: caseRow.id,
          status: caseRow.state,
          mastery: "pending_retest",
          version: caseRow.stateVersion,
          replanCount: caseRow.replanCount,
          appliedEventIds: [],
        }, domainEvent);
        const completedTaskSnapshot: D7RetestTaskView = {
          ...(toLearningTaskView(taskRow) as D7RetestTaskView),
          status: "completed",
          completedAt: evaluatedAt.toISOString(),
        };
        const eventPayload = {
          kind: "d7" as const,
          passed: score.passed,
          request: requestPayload,
          result: {
            kind: "d7" as const,
            taskId: taskRow.id,
            itemId: item.id,
            selectedChoiceId: request.body.selectedChoiceId,
            passed: score.passed,
            scoringMethod: score.scoringMethod,
            state: next.status,
            stateVersion: next.version,
            replanJobId,
            completedTask: completedTaskSnapshot,
            scheduledRetest: null,
          },
          privateEvidence: {
            scoringRule: score.scoringMethod,
            itemSource: d7Authenticity.contentSource,
            knowledgeTarget: d7Authenticity.knowledgeTarget,
            contentBasisEventId: d7Authenticity.contentBasisEventId,
          },
        };
        const persisted = await persistD1RetestEvaluation(options.database, {
          caseId: caseRow.id,
          taskId: taskRow.id,
          expectedVersion: request.body.expectedVersion,
          nextState: next.status,
          evaluatedAt,
          kind: "d7",
          event: {
            id: eventId,
            tenantId: caseRow.tenantId,
            studentId: caseRow.studentId,
            caseId: caseRow.id,
            eventType: domainEvent.type,
            sourceType: "student_d7_retest_attempt",
            sourceRef: taskRow.id,
            payload: eventPayload,
            occurredAt: evaluatedAt,
            idempotencyKey,
          },
          enqueueFollowUp: async (transaction) => {
            if (!canReplan || replanJobId === null || interventionJobId === null) return;
            await enqueueReplanTransactional(transaction, options.queue, {
              jobId: replanJobId,
              caseId: caseRow.id,
              triggerEventId: eventId,
              expectedVersion: next.version,
              traceId: traceId(request),
              interventionJobId,
            });
          },
        });
        const persistedEvent = await findEvidenceEventByIdempotencyKey(options.database, idempotencyKey);
        if (persistedEvent === undefined || !isD7EvaluationEvent(persistedEvent)) {
          throw new ApiHttpError(
            persisted.applied ? 500 : 409,
            persisted.applied ? "STORED_EVENT_INVALID" : "IDEMPOTENCY_KEY_REUSED",
            persisted.applied ? "The D7 evaluation event could not be reconstructed." : "The idempotency key belongs to another write request.",
          );
        }
        const response = await d7RetestAttemptViewFromEvent(persistedEvent);
        return success(request, response.view, response.jobId);
      }
      if (caseRow.stateVersion !== request.body.expectedVersion) {
        const racedEvent = await findEvidenceEventByIdempotencyKey(
          options.database,
          idempotencyKey,
        );
        if (racedEvent !== undefined) {
          if (!isMatchingD1EvaluationEvent(racedEvent, taskRow.id, requestPayload)) {
            throw new ApiHttpError(
              409,
              "IDEMPOTENCY_KEY_REUSED",
              "The idempotency key belongs to another write request.",
            );
          }
          const replay = await d1RetestAttemptViewFromEvent(options.database, racedEvent);
          return success(request, replay.view, replay.jobId);
        }
        throw new VersionConflictError(caseRow.id, request.body.expectedVersion);
      }
      if (
        taskRow.taskType !== "d1_retest" ||
        taskRow.status !== "ready" ||
        caseRow.state !== "d1_scheduled"
      ) {
        throw new InvalidTaskStateError("Only a ready D1 retest in d1_scheduled can be submitted.");
      }
      const d1Authenticity = taskContentAuthenticity(taskRow, !caseRow.synthetic && !caseRow.simulation);
      const item = privateRetestItemFromTask(taskRow);
      const plannedD7Item = taskRow.payload.nextItem === undefined
        ? (!caseRow.synthetic && !caseRow.simulation
            ? (() => { throw new ApiHttpError(409, "REAL_LEARNING_CONTENT_REQUIRED", "This real-material task has no verified D7 item.", false); })()
            : {
                id: "synthetic-d7-transfer-item-v1",
                prompt: "The volunteers have ___ three notes about saving water.",
                choices: [
                  { id: "choice-wrote", label: "wrote" },
                  { id: "choice-written", label: "written" },
                  { id: "choice-writing", label: "writing" },
                ],
                expectedChoiceId: "choice-written",
                scoringMethod: "exact-choice-v1" as const,
              })
        : privateRetestItem(taskRow.payload.nextItem, `${taskRow.id}:next-d7`);
      if (item.id !== request.body.itemId) {
        throw new ApiHttpError(400, "INVALID_INPUT", "The submitted item does not belong to this D1 task.");
      }
      const score = scoreSingleChoiceRetest({
        itemId: item.id,
        selectedChoiceId: request.body.selectedChoiceId,
        expectedChoiceId: item.expectedChoiceId,
        availableChoiceIds: item.choices.map(({ id }) => id),
      });
      const evaluatedAt = clock.now();
      const eventId = uuidv7();
      const d7TaskId = score.passed ? uuidv7() : null;
      const canReplan = !score.passed && caseRow.replanCount < 2;
      const replanJobId = canReplan ? uuidv7() : null;
      const interventionJobId = canReplan ? uuidv7() : null;
      const d7ScheduledFor = new Date(evaluatedAt.getTime() + 144 * 60 * 60 * 1_000);
      const d7DueAt = new Date(d7ScheduledFor.getTime() + 12 * 60 * 60 * 1_000);
      const domainEvent = {
        eventId,
        occurredAt: evaluatedAt.toISOString(),
        type: "retest_evaluated" as const,
        kind: "d1" as const,
        passed: score.passed,
      };
      const next = transitionCase(
        {
          id: caseRow.id,
          status: caseRow.state,
          mastery: "pending_retest",
          version: caseRow.stateVersion,
          replanCount: caseRow.replanCount,
          appliedEventIds: [],
        },
        domainEvent,
      );
      const d7Task = d7TaskId === null ? undefined : {
        id: d7TaskId,
        tenantId: caseRow.tenantId,
        studentId: caseRow.studentId,
        caseId: caseRow.id,
        taskType: "d7_retest" as const,
        status: "scheduled" as const,
        title: "六天后换一道新题检查",
        estimatedMinutes: 5,
        scheduledFor: d7ScheduledFor,
        dueAt: d7DueAt,
        payload: {
          rationale: d1Authenticity.contentSource === "confirmed_real_material"
            ? "D1 已完成；六天后用同一知识目标的另一道新题检查迁移。"
            : "D1 已完成；在精确 144 小时后使用新的合成题检查迁移。",
          item: plannedD7Item,
          contentSource: d1Authenticity.contentSource,
          knowledgeTarget: d1Authenticity.knowledgeTarget,
          contentBasisEventId: d1Authenticity.contentBasisEventId,
        },
        sourceEventId: eventId,
      };
      const completedTaskSnapshot: D1RetestTaskView = {
        ...(toLearningTaskView(taskRow) as D1RetestTaskView),
        status: "completed",
        completedAt: evaluatedAt.toISOString(),
      };
      const scheduledRetestSnapshot: D7RetestTaskView | null = d7Task === undefined
        ? null
        : {
            id: d7Task.id,
            caseId: d7Task.caseId,
            studentId: d7Task.studentId,
            taskType: "d7_retest",
            status: "scheduled",
            title: d7Task.title,
            rationale: String(d7Task.payload.rationale),
            estimatedMinutes: d7Task.estimatedMinutes,
            scheduledFor: d7Task.scheduledFor.toISOString(),
            dueAt: d7Task.dueAt?.toISOString() ?? null,
            completedAt: null,
            item: {
              id: plannedD7Item.id,
              prompt: plannedD7Item.prompt,
              choices: plannedD7Item.choices.map((choice) => ({ ...choice })),
            },
          };
      const eventPayload = {
        kind: "d1" as const,
        passed: score.passed,
        request: requestPayload,
        result: {
          taskId: taskRow.id,
          itemId: item.id,
          selectedChoiceId: request.body.selectedChoiceId,
          passed: score.passed,
          scoringMethod: score.scoringMethod,
          state: next.status,
          stateVersion: next.version,
          d7TaskId,
          replanJobId,
          completedTask: completedTaskSnapshot,
          scheduledRetest: scheduledRetestSnapshot,
        },
        privateEvidence: {
          scoringRule: score.scoringMethod,
          itemSource: d1Authenticity.contentSource,
          knowledgeTarget: d1Authenticity.knowledgeTarget,
          contentBasisEventId: d1Authenticity.contentBasisEventId,
        },
      };
      const persisted = await persistD1RetestEvaluation(options.database, {
        caseId: caseRow.id,
        taskId: taskRow.id,
        expectedVersion: request.body.expectedVersion,
        nextState: next.status,
        evaluatedAt,
        event: {
          id: eventId,
          tenantId: caseRow.tenantId,
          studentId: caseRow.studentId,
          caseId: caseRow.id,
          eventType: domainEvent.type,
          sourceType: "student_d1_retest_attempt",
          sourceRef: taskRow.id,
          payload: eventPayload,
          occurredAt: evaluatedAt,
          idempotencyKey,
        },
        ...(d7Task === undefined ? {} : { d7Task }),
        enqueueFollowUp: async (transaction) => {
          if (d7Task !== undefined) {
            await enqueueRetestDueTransactional(transaction, options.queue, {
              caseId: d7Task.caseId,
              taskId: d7Task.id,
              startAfter: d7Task.scheduledFor,
            });
            return;
          }
          if (!canReplan || replanJobId === null || interventionJobId === null) {
            return;
          }
          await enqueueReplanTransactional(transaction, options.queue, {
            jobId: replanJobId,
            caseId: caseRow.id,
            triggerEventId: eventId,
            expectedVersion: next.version,
            traceId: traceId(request),
            interventionJobId,
          });
        },
      });
      const persistedEvent = await findEvidenceEventByIdempotencyKey(options.database, idempotencyKey);
      if (persistedEvent === undefined || !isMatchingD1EvaluationEvent(persistedEvent, taskRow.id, requestPayload)) {
        throw new ApiHttpError(
          persisted.applied ? 500 : 409,
          persisted.applied ? "STORED_EVENT_INVALID" : "IDEMPOTENCY_KEY_REUSED",
          persisted.applied
            ? "The D1 evaluation event could not be reconstructed."
            : "The idempotency key belongs to another write request.",
        );
      }
      const response = await d1RetestAttemptViewFromEvent(options.database, persistedEvent);
      return success(request, response.view, response.jobId);
    },
  );

  api.post<{ Params: TaskIdParams; Body: CompleteTaskRequest }>(
    "/v1/tasks/:taskId/submit",
    {
      schema: {
        params: TaskIdParamsSchema,
        body: CompleteTaskRequestSchema,
        response: {
          200: apiResponseSchema(TaskCompletionViewSchema),
          "4xx": ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const idempotencyKey = `complete-task:${getIdempotencyKey(request)}`;
      const requestPayload = completionRequestPayload(request.body);
      const existingEvent = await findEvidenceEventByIdempotencyKey(
        options.database,
        idempotencyKey,
      );
      if (existingEvent !== undefined) {
        if (!isMatchingCompletionEvent(
          existingEvent,
          request.params.taskId,
          requestPayload,
        )) {
          throw new ApiHttpError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "The idempotency key belongs to another write request.",
          );
        }
        return success(
          request,
          await taskCompletionViewFromEvent(options.database, existingEvent),
        );
      }

      const taskRow = await findTaskById(
        options.database,
        request.params.taskId,
      );
      if (taskRow === undefined) {
        throw new ResourceNotFoundError("Task", request.params.taskId);
      }
      const caseRow = await findCaseById(options.database, taskRow.caseId);
      if (caseRow === undefined) {
        throw new ResourceNotFoundError("Case", taskRow.caseId);
      }
      if (caseRow.stateVersion !== request.body.expectedVersion) {
        const racedEvent = await findEvidenceEventByIdempotencyKey(
          options.database,
          idempotencyKey,
        );
        if (racedEvent !== undefined) {
          if (!isMatchingCompletionEvent(
            racedEvent,
            request.params.taskId,
            requestPayload,
          )) {
            throw new ApiHttpError(
              409,
              "IDEMPOTENCY_KEY_REUSED",
              "The idempotency key belongs to another write request.",
            );
          }
          return success(
            request,
            await taskCompletionViewFromEvent(options.database, racedEvent),
          );
        }
        throw new VersionConflictError(
          caseRow.id,
          request.body.expectedVersion,
        );
      }
      if (caseRow.state !== "intervention_active") {
        throw new CaseTransitionError(
          "invalid_transition",
          `Event intervention_completed requires intervention_active, received ${caseRow.state}.`,
        );
      }
      if (taskRow.taskType !== "guided_intervention" || taskRow.status !== "ready") {
        throw new ApiHttpError(
          409,
          "INVALID_TASK_STATE",
          "The task is not a ready guided intervention.",
        );
      }

      const taskView = toLearningTaskView(taskRow);
      if (taskView.taskType !== "guided_intervention") {
        throw new ApiHttpError(
          409,
          "INVALID_TASK_STATE",
          "The task is not a ready guided intervention.",
        );
      }
      const requiredStepIds = [...taskView.steps.map(({ id }) => id)].sort();
      const completedStepIds = [...request.body.completedStepIds].sort();
      if (!isDeepStrictEqual(requiredStepIds, completedStepIds)) {
        throw new ApiHttpError(
          400,
          "INVALID_INPUT",
          "Every intervention step must be completed before scheduling D+1.",
        );
      }

      const caseIsReal = !caseRow.synthetic && !caseRow.simulation;
      if (caseRow.synthetic !== caseRow.simulation) {
        throw new ApiHttpError(409, "CASE_SOURCE_INVALID", "The case content source is inconsistent.", false);
      }
      const plannedRetests = plannedRetestsFromGuidedTask(taskRow, caseIsReal);
      const d1Item: PrivateRetestItem = plannedRetests?.d1 ?? {
        id: "synthetic-d1-unseen-item-v1",
        prompt: "Mina has ___ three short notes about saving water this week.",
        choices: [
          { id: "choice-wrote", label: "wrote" },
          { id: "choice-written", label: "written" },
          { id: "choice-writing", label: "writing" },
        ],
        expectedChoiceId: "choice-written",
        scoringMethod: "exact-choice-v1",
      };
      const d7Item: PrivateRetestItem = plannedRetests?.d7 ?? {
        id: "synthetic-d7-transfer-item-v1",
        prompt: "The volunteers have ___ three notes about saving water.",
        choices: [
          { id: "choice-wrote", label: "wrote" },
          { id: "choice-written", label: "written" },
          { id: "choice-writing", label: "writing" },
        ],
        expectedChoiceId: "choice-written",
        scoringMethod: "exact-choice-v1",
      };
      const contentAuthenticity = plannedRetests ?? {
        contentSource: "synthetic_fixture" as const,
        knowledgeTarget: "synthetic_fixture_target",
        contentBasisEventId: taskRow.sourceEventId,
      };

      const completedAt = clock.now();
      const d1ScheduledFor = new Date(
        completedAt.getTime() + 24 * 60 * 60 * 1_000,
      );
      const d1DueAt = new Date(
        d1ScheduledFor.getTime() + 12 * 60 * 60 * 1_000,
      );
      const d1TaskId = uuidv7();
      const event = {
        eventId: uuidv7(),
        occurredAt: completedAt.toISOString(),
        type: "intervention_completed" as const,
        taskId: taskRow.id,
        d1TaskId,
        d1ScheduledFor: d1ScheduledFor.toISOString(),
      };
      const next = transitionCase(
        {
          id: caseRow.id,
          status: caseRow.state,
          mastery: "insufficient_evidence",
          version: caseRow.stateVersion,
          replanCount: caseRow.replanCount,
          appliedEventIds: [],
        },
        event,
      );
      const eventPayload = {
        request: requestPayload,
        privateEvidence: {
          contentSource: contentAuthenticity.contentSource,
          knowledgeTarget: contentAuthenticity.knowledgeTarget,
          contentBasisEventId: contentAuthenticity.contentBasisEventId,
        },
        result: {
          completedTaskId: taskRow.id,
          d1TaskId,
          d1ScheduledFor: d1ScheduledFor.toISOString(),
          state: next.status,
          stateVersion: next.version,
        },
      };
      const persisted = await completeInterventionTask(options.database, {
        caseId: caseRow.id,
        taskId: taskRow.id,
        expectedVersion: request.body.expectedVersion,
        nextState: next.status,
        completedAt,
        event: {
          id: event.eventId,
          tenantId: caseRow.tenantId,
          studentId: caseRow.studentId,
          caseId: caseRow.id,
          eventType: event.type,
          sourceType: "student_task_completion",
          sourceRef: taskRow.id,
          payload: eventPayload,
          occurredAt: completedAt,
          idempotencyKey,
        },
        d1Task: {
          id: d1TaskId,
          tenantId: caseRow.tenantId,
          studentId: caseRow.studentId,
          caseId: caseRow.id,
          taskType: "d1_retest",
          status: "scheduled",
          title: "明天用一道新题检查",
          estimatedMinutes: 5,
          scheduledFor: d1ScheduledFor,
          dueAt: d1DueAt,
          payload: {
            rationale: "最小干预已完成；次日使用新题检查是否能独立回忆。",
            item: d1Item,
            nextItem: d7Item,
            contentSource: contentAuthenticity.contentSource,
            knowledgeTarget: contentAuthenticity.knowledgeTarget,
            contentBasisEventId: contentAuthenticity.contentBasisEventId,
          },
          sourceEventId: event.eventId,
        },
        scheduleD1Retest: async (transaction, task) => {
          await enqueueRetestDueTransactional(transaction, options.queue, {
            caseId: task.caseId,
            taskId: task.id,
            startAfter: task.scheduledFor,
          });
        },
      });

      const persistedEvent = await findEvidenceEventByIdempotencyKey(
        options.database,
        idempotencyKey,
      );
      if (
        persistedEvent === undefined ||
        !isMatchingCompletionEvent(
          persistedEvent,
          request.params.taskId,
          requestPayload,
        )
      ) {
        throw new ApiHttpError(
          persisted.applied ? 500 : 409,
          persisted.applied ? "STORED_EVENT_INVALID" : "IDEMPOTENCY_KEY_REUSED",
          persisted.applied
            ? "The intervention completion event was not persisted."
            : "The idempotency key belongs to another write request.",
        );
      }
      return success(
        request,
        await taskCompletionViewFromEvent(options.database, persistedEvent),
      );
    },
  );

  api.post<{ Params: CaseIdParams; Body: RunNextRequest }>(
    "/v1/cases/:caseId/commands/run-next",
    {
      schema: {
        params: CaseIdParamsSchema,
        body: RunNextRequestSchema,
        response: {
          202: apiResponseSchema(RunNextQueuedSchema),
          "4xx": ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const idempotencyKey = getIdempotencyKey(request);
      const caseRow = await findCaseById(options.database, request.params.caseId);
      if (caseRow === undefined) {
        throw new ResourceNotFoundError("Case", request.params.caseId);
      }
      if (
        caseRow.state === "awaiting_evidence" &&
        (!caseRow.simulation || !caseRow.synthetic)
      ) {
        throw new ApiHttpError(
          409,
          "DEMO_CASE_REQUIRED",
          "Fake parse-paper requires a synthetic simulation Case.",
        );
      }
      const queued = await enqueueRunNextIdempotent(
        options.database,
        options.queue,
        {
          caseId: request.params.caseId,
          expectedVersion: request.body.expectedVersion,
          assetId: SYNTHETIC_PARSE_ASSET_ID,
          traceId: traceId(request),
          idempotencyKey,
        },
      );

      return reply.status(202).send(
        success(
          request,
          {
            caseId: request.params.caseId,
            expectedVersion: request.body.expectedVersion,
            status: "queued" as const,
          },
          queued.jobId,
        ),
      );
    },
  );

  if (options.demoClockEnabled === true) {
    api.post<{ Body: DemoClockAdvanceRequest }>(
      "/v1/demo/clock/advance",
      {
        schema: {
          body: DemoClockAdvanceRequestSchema,
          response: {
            200: apiResponseSchema(DemoClockAdvanceViewSchema),
            "4xx": ApiErrorResponseSchema,
            500: ApiErrorResponseSchema,
          },
        },
      },
      async (request) => {
        const result = await advanceDemoClock(options.database, {
          caseId: request.body.caseId,
          eventId: uuidv7(),
          idempotencyKey: `demo-clock-advance:${getIdempotencyKey(request)}`,
          baseNow: clock.now(),
          request: { ...request.body },
        });
        return success(request, result.response);
      },
    );
  }

  return api;
}
