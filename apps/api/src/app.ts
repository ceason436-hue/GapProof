import Fastify, {
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
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
  ConfirmExtractionRequestSchema,
  type ConfirmExtractionRequest,
  CreateCaseRequestSchema,
  type CreateCaseRequest,
  type FormHypothesesOutput,
  HypothesesViewSchema,
  type HypothesesView,
  RunNextQueuedSchema,
  RunNextRequestSchema,
  type RunNextRequest,
  SubmitAttemptRequestSchema,
  type SubmitAttemptRequest,
} from "@gapproof/contracts";
import {
  createSyntheticCaseIdempotent,
  findEvidenceEventByIdempotencyKey,
  findCaseById,
  findLatestCaseEvidenceEventByType,
  persistCaseTransition,
  type CaseRow,
  type Database,
  type LearningEvidenceEventRow,
  ResourceNotFoundError,
  VersionConflictError,
} from "@gapproof/db";
import {
  CaseTransitionError,
  ProbeScoringError,
  scoreProbeAttempt,
  transitionCase,
} from "@gapproof/domain";
import {
  enqueueRunNextIdempotent,
  type JobQueue,
} from "@gapproof/jobs";

export interface BuildApiOptions {
  readonly database: Database;
  readonly queue: JobQueue;
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

function isSamePayload(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  return isDeepStrictEqual(left, right);
}

export async function buildApi(options: BuildApiOptions) {
  const api = Fastify({ logger: false });
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
    } else if (error instanceof ResourceNotFoundError) {
      statusCode = 404;
      code = error.code;
      message = error.message;
    } else if (error instanceof VersionConflictError) {
      statusCode = 409;
      code = error.code;
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

  return api;
}
