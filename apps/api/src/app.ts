import Fastify, {
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { Type } from "@sinclair/typebox";
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
  D1RetestAttemptViewSchema,
  type D1RetestAttemptView,
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
  RunNextQueuedSchema,
  RunNextRequestSchema,
  type RunNextRequest,
  SubmitAttemptRequestSchema,
  type SubmitAttemptRequest,
  SubmitD1RetestAttemptRequestSchema,
  type SubmitD1RetestAttemptRequest,
  StudentIdParamsSchema,
  type StudentIdParams,
  SourceAssetIdParamsSchema,
  type SourceAssetIdParams,
  PrepareSourceAssetRequestSchema,
  type PrepareSourceAssetRequest,
  SourceAssetPrepareQueuedViewSchema,
  type SourceAssetPrepareQueuedView,
  SourceAssetProcessingViewSchema,
  type SourceAssetProcessingView,
  TaskCompletionViewSchema,
  type TaskCompletionView,
  TaskIdParamsSchema,
  type TaskIdParams,
  TodayTasksViewSchema,
  UploadedSourceAssetViewSchema,
  type UploadedSourceAssetView,
} from "@gapproof/contracts";
import {
  advanceDemoClock,
  completeInterventionTask,
  createSyntheticCaseIdempotent,
  findCurrentActionableTaskId,
  findEvidenceEventByIdempotencyKey,
  findCaseById,
  findLatestCaseEvidenceEventByType,
  findStudentById,
  findSourceAssetById,
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
  SourceAssetNotUploadedError,
  VersionConflictError,
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
  type JobQueue,
} from "@gapproof/jobs";
import {
  MAX_SOURCE_ASSET_BYTES,
  type SourceAssetStorage,
} from "./source-asset-storage.ts";
import {
  createSourceAssetUploadToken,
  verifySourceAssetUploadToken,
} from "./source-asset-token.ts";

export interface BuildApiOptions {
  readonly database: Database;
  readonly queue: JobQueue;
  readonly clock?: Clock;
  readonly demoClockEnabled?: boolean;
  readonly uploadStorage?: SourceAssetStorage;
  readonly uploadSigningSecret?: string;
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

interface PrivateRetestItem {
  readonly id: string;
  readonly prompt: string;
  readonly choices: readonly { readonly id: string; readonly label: string }[];
  readonly expectedChoiceId: string;
  readonly scoringMethod: "exact-choice-v1";
}

function privateRetestItemFromTask(row: TaskRow): PrivateRetestItem {
  const item = row.payload.item;
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
      `Stored retest task ${row.id} is invalid.`,
    );
  }
  return item as unknown as PrivateRetestItem;
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
    !["d7_scheduled", "replan_required"].includes(String(result.state)) ||
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
      state: result.state as "d7_scheduled" | "replan_required",
      stateVersion: result.stateVersion as number,
      completedTask: result.completedTask as D1RetestTaskView,
      scheduledRetest: result.scheduledRetest as D7RetestTaskView | null,
    },
    ...(typeof result.replanJobId === "string"
      ? { jobId: result.replanJobId }
      : {}),
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
    } else if (error instanceof SourceAssetIdempotencyKeyReusedError) {
      statusCode = 409;
      code = error.code;
      message = error.message;
    } else if (error instanceof SourceAssetNotUploadedError) {
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
          200: apiResponseSchema(Type.Union([SourceAssetPrepareQueuedViewSchema, SourceAssetProcessingViewSchema])),
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

      const confirmedItemIds = new Set(request.body.confirmedItemIds);
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
          replanCount: 0,
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
          replanCount: 0,
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
      return success(request, toLearningTaskView(task));
    },
  );

  api.post<{ Params: TaskIdParams; Body: SubmitD1RetestAttemptRequest }>(
    "/v1/tasks/:taskId/attempts",
    {
      schema: {
        params: TaskIdParamsSchema,
        body: SubmitD1RetestAttemptRequestSchema,
        response: {
          200: apiResponseSchema(D1RetestAttemptViewSchema),
          "4xx": ApiErrorResponseSchema,
          500: ApiErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const idempotencyKey = `d1-retest-attempt:${getIdempotencyKey(request)}`;
      const requestPayload = d1AttemptRequestPayload(request.body);
      const existing = await findEvidenceEventByIdempotencyKey(options.database, idempotencyKey);
      if (existing !== undefined) {
        if (!isMatchingD1EvaluationEvent(existing, request.params.taskId, requestPayload)) {
          throw new ApiHttpError(409, "IDEMPOTENCY_KEY_REUSED", "The idempotency key belongs to another write request.");
        }
        const replay = await d1RetestAttemptViewFromEvent(options.database, existing);
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
      const item = privateRetestItemFromTask(taskRow);
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
      const replanJobId = score.passed ? null : uuidv7();
      const interventionJobId = score.passed ? null : uuidv7();
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
          replanCount: 0,
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
          rationale: "D1 已完成；在精确 144 小时后使用新的合成题检查迁移。",
          item: {
            id: "synthetic-d7-transfer-item-v1",
            prompt: "The volunteers have ___ three notes about saving water.",
            choices: [
              { id: "choice-wrote", label: "wrote" },
              { id: "choice-written", label: "written" },
              { id: "choice-writing", label: "writing" },
            ],
            expectedChoiceId: "choice-written",
            scoringMethod: "exact-choice-v1",
          },
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
              id: String((d7Task.payload.item as Record<string, unknown>).id),
              prompt: String((d7Task.payload.item as Record<string, unknown>).prompt),
              choices: ((d7Task.payload.item as Record<string, unknown>).choices as Array<{ id: string; label: string }>).map(
                (choice) => ({ ...choice }),
              ),
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
          itemSource: "synthetic_fixture",
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
          if (replanJobId === null || interventionJobId === null) {
            throw new Error("A failed D1 evaluation requires replan job ids.");
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
          replanCount: 0,
          appliedEventIds: [],
        },
        event,
      );
      const eventPayload = {
        request: requestPayload,
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
            item: {
              id: "synthetic-d1-unseen-item-v1",
              prompt: "Mina has ___ three short notes about saving water this week.",
              choices: [
                { id: "choice-wrote", label: "wrote" },
                { id: "choice-written", label: "written" },
                { id: "choice-writing", label: "writing" },
              ],
              expectedChoiceId: "choice-written",
              scoringMethod: "exact-choice-v1",
            },
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
      const queued = await enqueueRunNextIdempotent(
        options.database,
        options.queue,
        {
          caseId: request.params.caseId,
          expectedVersion: request.body.expectedVersion,
          assetId: "asset-synthetic-paper-1",
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
