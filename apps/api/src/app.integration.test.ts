import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  ApiErrorResponse,
  ApiResponse,
  AttemptView,
  CaseView,
  HypothesesView,
  TaskCompletionView,
  TodayTasksView,
} from "@gapproof/contracts";
import {
  apiIdempotencyRecords,
  cases,
  createDatabase,
  eq,
  learningEvidenceEvents,
  runMigrations,
  students,
  tasks,
} from "@gapproof/db";
import { createJobQueue } from "@gapproof/jobs";
import { createRunNextWorker } from "@gapproof/worker";

import { buildApi } from "./app.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl === undefined ? describe.skip : describe;

async function waitForState(
  api: Awaited<ReturnType<typeof buildApi>>,
  caseId: string,
  expectedState: CaseView["state"],
): Promise<CaseView> {
  const deadline = Date.now() + 8_000;

  while (Date.now() < deadline) {
    const response = await api.inject({
      method: "GET",
      url: `/v1/cases/${caseId}`,
    });
    const body = response.json<ApiResponse<CaseView>>();
    if (body.data.state === expectedState) {
      return body.data;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Case ${caseId} did not reach ${expectedState}.`);
}

async function createProbeRequiredCase(
  api: Awaited<ReturnType<typeof buildApi>>,
  keyPrefix: string,
) {
  const created = await api.inject({
    method: "POST",
    url: "/v1/cases",
    headers: { "idempotency-key": `${keyPrefix}-create` },
    payload: { entry: "synthetic_demo" },
  });
  const caseId = created.json<ApiResponse<CaseView>>().data.id;
  const studentId = created.json<ApiResponse<CaseView>>().data.studentId;

  await api.inject({
    method: "POST",
    url: `/v1/cases/${caseId}/commands/run-next`,
    headers: { "idempotency-key": `${keyPrefix}-ocr` },
    payload: { expectedVersion: 0 },
  });
  await waitForState(api, caseId, "awaiting_confirmation");

  await api.inject({
    method: "POST",
    url: `/v1/cases/${caseId}/extraction/confirm`,
    headers: { "idempotency-key": `${keyPrefix}-confirm` },
    payload: {
      expectedVersion: 1,
      confirmedItemIds: ["item-synthetic-irregular-participle-1"],
      corrections: [],
    },
  });
  await api.inject({
    method: "POST",
    url: `/v1/cases/${caseId}/commands/run-next`,
    headers: { "idempotency-key": `${keyPrefix}-diagnose` },
    payload: { expectedVersion: 2 },
  });
  await waitForState(api, caseId, "probe_required");

  const response = await api.inject({
    method: "GET",
    url: `/v1/cases/${caseId}/hypotheses`,
  });
  return {
    caseId,
    studentId,
    hypotheses: response.json<ApiResponse<HypothesesView>>().data,
  };
}

async function createInterventionReadyCase(
  api: Awaited<ReturnType<typeof buildApi>>,
  keyPrefix: string,
) {
  const prepared = await createProbeRequiredCase(api, keyPrefix);
  const attempted = await api.inject({
    method: "POST",
    url: `/v1/cases/${prepared.caseId}/attempts`,
    headers: { "idempotency-key": `${keyPrefix}-attempt` },
    payload: {
      expectedVersion: 3,
      probeId: prepared.hypotheses.probe.id,
      selectedChoiceId: "choice-wrote",
    },
  });
  expect(attempted.statusCode).toBe(200);
  return prepared;
}

describeWithDatabase("Fastify API and run-next worker", () => {
  const database = createDatabase(databaseUrl ?? "");
  const queue = createJobQueue(databaseUrl ?? "");
  let api: Awaited<ReturnType<typeof buildApi>>;
  let worker: ReturnType<typeof createRunNextWorker>;

  beforeAll(async () => {
    await runMigrations(database.db);
    await database.db.delete(tasks);
    await database.db.delete(learningEvidenceEvents);
    await database.db.delete(apiIdempotencyRecords);
    await database.db.delete(cases);
    await database.db.delete(students);

    await queue.start();
    worker = createRunNextWorker({ database: database.db, queue });
    await worker.start();
    api = await buildApi({ database: database.db, queue });
  });

  afterAll(async () => {
    await api.close();
    await worker.stop();
    await queue.stop();
    await database.close();
  });

  it("rejects a write request without an idempotency key", async () => {
    const response = await api.inject({
      method: "POST",
      url: "/v1/cases",
      payload: { entry: "synthetic_demo" },
    });
    const body = response.json<ApiErrorResponse>();

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.requestId).toBeTruthy();
    expect(body.traceId).toBeTruthy();
  });

  it("creates and replays the same synthetic case idempotently", async () => {
    const request = {
      method: "POST" as const,
      url: "/v1/cases",
      headers: { "idempotency-key": "create-case-integration-v1" },
      payload: { entry: "synthetic_demo" },
    };

    const first = await api.inject(request);
    const replay = await api.inject(request);
    const firstBody = first.json<ApiResponse<CaseView>>();
    const replayBody = replay.json<ApiResponse<CaseView>>();

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replayBody.data.id).toBe(firstBody.data.id);
    expect(firstBody.data.state).toBe("awaiting_evidence");
  });

  it("creates only one case when duplicate writes arrive concurrently", async () => {
    const request = {
      method: "POST" as const,
      url: "/v1/cases",
      headers: { "idempotency-key": "create-case-concurrent-v1" },
      payload: { entry: "synthetic_demo" },
    };
    const [left, right] = await Promise.all([
      api.inject(request),
      api.inject(request),
    ]);
    const leftBody = left.json<ApiResponse<CaseView>>();
    const rightBody = right.json<ApiResponse<CaseView>>();

    expect([left.statusCode, right.statusCode].sort()).toEqual([200, 201]);
    expect(leftBody.data.id).toBe(rightBody.data.id);
  });

  it("returns a unified not-found error", async () => {
    const response = await api.inject({
      method: "GET",
      url: "/v1/cases/0198a111-1111-7000-8000-999999999999",
    });
    const body = response.json<ApiErrorResponse>();

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("queues run-next and lets the worker advance the case to confirmation", async () => {
    const created = await api.inject({
      method: "POST",
      url: "/v1/cases",
      headers: { "idempotency-key": "create-case-worker-v1" },
      payload: { entry: "synthetic_demo" },
    });
    const caseId = created.json<ApiResponse<CaseView>>().data.id;

    const stale = await api.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/commands/run-next`,
      headers: { "idempotency-key": "run-next-stale-v1" },
      payload: { expectedVersion: 7 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<ApiErrorResponse>().error.code).toBe("VERSION_CONFLICT");

    const request = {
      method: "POST" as const,
      url: `/v1/cases/${caseId}/commands/run-next`,
      headers: { "idempotency-key": "run-next-worker-v1" },
      payload: { expectedVersion: 0 },
    };
    const queued = await api.inject(request);
    const replay = await api.inject(request);
    const queuedBody = queued.json<ApiResponse<{ status: string }>>();
    const replayBody = replay.json<ApiResponse<{ status: string }>>();

    expect(queued.statusCode).toBe(202);
    expect(replay.statusCode).toBe(202);
    expect(queuedBody.jobId).toBeTruthy();
    expect(replayBody.jobId).toBe(queuedBody.jobId);

    const caseView = await waitForState(api, caseId, "awaiting_confirmation");
    expect(caseView.stateVersion).toBe(1);
  }, 15_000);

  it("enqueues only one job for concurrent duplicate run-next requests", async () => {
    const created = await api.inject({
      method: "POST",
      url: "/v1/cases",
      headers: { "idempotency-key": "create-case-concurrent-worker-v1" },
      payload: { entry: "synthetic_demo" },
    });
    const caseId = created.json<ApiResponse<CaseView>>().data.id;
    const request = {
      method: "POST" as const,
      url: `/v1/cases/${caseId}/commands/run-next`,
      headers: { "idempotency-key": "run-next-concurrent-worker-v1" },
      payload: { expectedVersion: 0 },
    };

    const [left, right] = await Promise.all([
      api.inject(request),
      api.inject(request),
    ]);
    const leftBody = left.json<ApiResponse<{ status: string }>>();
    const rightBody = right.json<ApiResponse<{ status: string }>>();

    expect(left.statusCode).toBe(202);
    expect(right.statusCode).toBe(202);
    expect(leftBody.jobId).toBe(rightBody.jobId);

    const caseView = await waitForState(api, caseId, "awaiting_confirmation");
    expect(caseView.stateVersion).toBe(1);
  }, 15_000);

  it("confirms extraction idempotently and advances the case to diagnosis", async () => {
    const created = await api.inject({
      method: "POST",
      url: "/v1/cases",
      headers: { "idempotency-key": "create-case-confirm-v1" },
      payload: { entry: "synthetic_demo" },
    });
    const caseId = created.json<ApiResponse<CaseView>>().data.id;

    await api.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/commands/run-next`,
      headers: { "idempotency-key": "run-next-confirm-v1" },
      payload: { expectedVersion: 0 },
    });
    await waitForState(api, caseId, "awaiting_confirmation");

    const stale = await api.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/extraction/confirm`,
      headers: { "idempotency-key": "confirm-extraction-stale-v1" },
      payload: {
        expectedVersion: 0,
        confirmedItemIds: ["item-synthetic-irregular-participle-1"],
        corrections: [],
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<ApiErrorResponse>().error.code).toBe("VERSION_CONFLICT");

    const request = {
      method: "POST" as const,
      url: `/v1/cases/${caseId}/extraction/confirm`,
      headers: { "idempotency-key": "confirm-extraction-v1" },
      payload: {
        expectedVersion: 1,
        confirmedItemIds: ["item-synthetic-irregular-participle-1"],
        corrections: [
          {
            itemId: "item-synthetic-irregular-participle-1",
            field: "student_answer",
            value: "wrote",
          },
        ],
      },
    };
    const confirmed = await api.inject(request);
    const replay = await api.inject(request);
    const confirmedBody = confirmed.json<ApiResponse<CaseView>>();
    const replayBody = replay.json<ApiResponse<CaseView>>();

    expect(confirmed.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(confirmedBody.data.state).toBe("ready_for_diagnosis");
    expect(confirmedBody.data.stateVersion).toBe(2);
    expect(replayBody.data).toMatchObject({
      id: caseId,
      state: "ready_for_diagnosis",
      stateVersion: 2,
    });

    const changedReplay = await api.inject({
      ...request,
      payload: {
        ...request.payload,
        corrections: [
          {
            itemId: "item-synthetic-irregular-participle-1",
            field: "student_answer",
            value: "written",
          },
        ],
      },
    });
    expect(changedReplay.statusCode).toBe(409);
    expect(changedReplay.json<ApiErrorResponse>().error.code).toBe(
      "IDEMPOTENCY_KEY_REUSED",
    );

    const confirmationEvents = await database.db
      .select()
      .from(learningEvidenceEvents)
      .where(eq(learningEvidenceEvents.caseId, caseId));
    expect(
      confirmationEvents.filter(
        (event) => event.eventType === "recognition_confirmed",
      ),
    ).toHaveLength(1);

    const invalidTransition = await api.inject({
      ...request,
      headers: { "idempotency-key": "confirm-extraction-again-v1" },
      payload: { ...request.payload, expectedVersion: 2 },
    });
    expect(invalidTransition.statusCode).toBe(409);
    expect(invalidTransition.json<ApiErrorResponse>().error.code).toBe(
      "INVALID_CASE_TRANSITION",
    );
  }, 15_000);

  it("applies only one confirmation event for concurrent duplicate requests", async () => {
    const created = await api.inject({
      method: "POST",
      url: "/v1/cases",
      headers: { "idempotency-key": "create-case-confirm-concurrent-v1" },
      payload: { entry: "synthetic_demo" },
    });
    const caseId = created.json<ApiResponse<CaseView>>().data.id;

    await api.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/commands/run-next`,
      headers: { "idempotency-key": "run-next-confirm-concurrent-v1" },
      payload: { expectedVersion: 0 },
    });
    await waitForState(api, caseId, "awaiting_confirmation");

    const request = {
      method: "POST" as const,
      url: `/v1/cases/${caseId}/extraction/confirm`,
      headers: { "idempotency-key": "confirm-extraction-concurrent-v1" },
      payload: {
        expectedVersion: 1,
        confirmedItemIds: ["item-synthetic-irregular-participle-1"],
        corrections: [],
      },
    };
    const [left, right] = await Promise.all([
      api.inject(request),
      api.inject(request),
    ]);
    const leftBody = left.json<ApiResponse<CaseView>>();
    const rightBody = right.json<ApiResponse<CaseView>>();

    expect(left.statusCode).toBe(200);
    expect(right.statusCode).toBe(200);
    expect(leftBody.data).toMatchObject({
      id: caseId,
      state: "ready_for_diagnosis",
      stateVersion: 2,
    });
    expect(rightBody.data).toMatchObject(leftBody.data);

    const events = await database.db
      .select()
      .from(learningEvidenceEvents)
      .where(eq(learningEvidenceEvents.caseId, caseId));
    expect(
      events.filter((event) => event.eventType === "recognition_confirmed"),
    ).toHaveLength(1);
  }, 15_000);

  it("generates competing hypotheses and enters the confirmation-question stage", async () => {
    const created = await api.inject({
      method: "POST",
      url: "/v1/cases",
      headers: { "idempotency-key": "create-case-hypotheses-v1" },
      payload: { entry: "synthetic_demo" },
    });
    const caseId = created.json<ApiResponse<CaseView>>().data.id;

    await api.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/commands/run-next`,
      headers: { "idempotency-key": "run-next-hypotheses-ocr-v1" },
      payload: { expectedVersion: 0 },
    });
    await waitForState(api, caseId, "awaiting_confirmation");

    const confirmed = await api.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/extraction/confirm`,
      headers: { "idempotency-key": "confirm-hypotheses-v1" },
      payload: {
        expectedVersion: 1,
        confirmedItemIds: ["item-synthetic-irregular-participle-1"],
        corrections: [],
      },
    });
    expect(confirmed.statusCode).toBe(200);

    const request = {
      method: "POST" as const,
      url: `/v1/cases/${caseId}/commands/run-next`,
      headers: { "idempotency-key": "run-next-hypotheses-v1" },
      payload: { expectedVersion: 2 },
    };
    const queued = await api.inject(request);
    const replay = await api.inject(request);
    expect(queued.statusCode).toBe(202);
    expect(replay.statusCode).toBe(202);
    expect(replay.json<ApiResponse<unknown>>().jobId).toBe(
      queued.json<ApiResponse<unknown>>().jobId,
    );

    const caseView = await waitForState(api, caseId, "probe_required");
    expect(caseView.stateVersion).toBe(3);

    const hypothesesResponse = await api.inject({
      method: "GET",
      url: `/v1/cases/${caseId}/hypotheses`,
    });
    const hypotheses = hypothesesResponse.json<ApiResponse<HypothesesView>>();
    expect(hypothesesResponse.statusCode).toBe(200);
    expect(hypotheses.data.caseId).toBe(caseId);
    expect(hypotheses.data.stateVersion).toBe(3);
    expect(hypotheses.data.candidates).toHaveLength(2);
    expect(new Set(hypotheses.data.candidates.map(({ id }) => id)).size).toBe(
      2,
    );
    expect(
      hypotheses.data.candidates.every(
        ({ evidenceRefs }) => evidenceRefs.length > 0,
      ),
    ).toBe(true);
    expect(hypotheses.data.probe.testedHypothesisIds).toEqual(
      hypotheses.data.candidates.map(({ id }) => id),
    );
    expect(hypotheses.data.probe).not.toHaveProperty("expectedChoiceId");
    expect(hypotheses.data.probe).not.toHaveProperty("scoringRule");

    const events = await database.db
      .select()
      .from(learningEvidenceEvents)
      .where(eq(learningEvidenceEvents.caseId, caseId));
    expect(
      events.filter((event) => event.eventType === "hypotheses_generated"),
    ).toHaveLength(1);
  }, 15_000);

  it("scores an attempt deterministically and advances to intervention_ready", async () => {
    const { caseId, hypotheses } = await createProbeRequiredCase(
      api,
      "attempt-incorrect-v1",
    );
    const request = {
      method: "POST" as const,
      url: `/v1/cases/${caseId}/attempts`,
      headers: { "idempotency-key": "submit-attempt-incorrect-v1" },
      payload: {
        expectedVersion: 3,
        probeId: hypotheses.probe.id,
        selectedChoiceId: "choice-wrote",
      },
    };

    const submitted = await api.inject(request);
    const replay = await api.inject(request);
    const body = submitted.json<ApiResponse<AttemptView>>();
    const replayBody = replay.json<ApiResponse<AttemptView>>();

    expect(submitted.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(body.data).toMatchObject({
      caseId,
      state: "intervention_ready",
      stateVersion: 4,
      probeId: hypotheses.probe.id,
      selectedChoiceId: "choice-wrote",
      passed: false,
      selectedHypothesisId: "hyp-participle-form-gap",
      scoringMethod: "exact_choice_v1",
    });
    expect(replayBody.data).toEqual(body.data);

    const events = await database.db
      .select()
      .from(learningEvidenceEvents)
      .where(eq(learningEvidenceEvents.caseId, caseId));
    expect(
      events.filter((event) => event.eventType === "probe_evaluated"),
    ).toHaveLength(1);

    const changedReplay = await api.inject({
      ...request,
      payload: { ...request.payload, selectedChoiceId: "choice-written" },
    });
    expect(changedReplay.statusCode).toBe(409);
    expect(changedReplay.json<ApiErrorResponse>().error.code).toBe(
      "IDEMPOTENCY_KEY_REUSED",
    );
  }, 15_000);

  it("scores the correct choice without falsely selecting a misconception", async () => {
    const { caseId, hypotheses } = await createProbeRequiredCase(
      api,
      "attempt-correct-v1",
    );
    const response = await api.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/attempts`,
      headers: { "idempotency-key": "submit-attempt-correct-v1" },
      payload: {
        expectedVersion: 3,
        probeId: hypotheses.probe.id,
        selectedChoiceId: "choice-written",
      },
    });
    const body = response.json<ApiResponse<AttemptView>>();

    expect(response.statusCode).toBe(200);
    expect(body.data.state).toBe("intervention_ready");
    expect(body.data.passed).toBe(true);
    expect(body.data.selectedHypothesisId).toBeNull();
  }, 15_000);

  it("rejects stale, unknown-choice, and invalid-state attempts", async () => {
    const { caseId, hypotheses } = await createProbeRequiredCase(
      api,
      "attempt-validation-v1",
    );
    const baseRequest = {
      method: "POST" as const,
      url: `/v1/cases/${caseId}/attempts`,
      headers: { "idempotency-key": "submit-attempt-validation-v1" },
      payload: {
        expectedVersion: 3,
        probeId: hypotheses.probe.id,
        selectedChoiceId: "choice-wrote",
      },
    };

    const stale = await api.inject({
      ...baseRequest,
      headers: { "idempotency-key": "submit-attempt-stale-v1" },
      payload: { ...baseRequest.payload, expectedVersion: 2 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<ApiErrorResponse>().error.code).toBe("VERSION_CONFLICT");

    const unknownChoice = await api.inject({
      ...baseRequest,
      headers: { "idempotency-key": "submit-attempt-unknown-choice-v1" },
      payload: {
        ...baseRequest.payload,
        selectedChoiceId: "choice-injected",
      },
    });
    expect(unknownChoice.statusCode).toBe(400);
    expect(unknownChoice.json<ApiErrorResponse>().error.code).toBe(
      "INVALID_INPUT",
    );

    const created = await api.inject({
      method: "POST",
      url: "/v1/cases",
      headers: { "idempotency-key": "attempt-invalid-state-create-v1" },
      payload: { entry: "synthetic_demo" },
    });
    const freshCaseId = created.json<ApiResponse<CaseView>>().data.id;
    const invalidState = await api.inject({
      ...baseRequest,
      url: `/v1/cases/${freshCaseId}/attempts`,
      headers: { "idempotency-key": "submit-attempt-invalid-state-v1" },
      payload: { ...baseRequest.payload, expectedVersion: 0 },
    });
    expect(invalidState.statusCode).toBe(409);
    expect(invalidState.json<ApiErrorResponse>().error.code).toBe(
      "INVALID_CASE_TRANSITION",
    );
  }, 15_000);

  it("persists one probe event for concurrent duplicate attempts", async () => {
    const { caseId, hypotheses } = await createProbeRequiredCase(
      api,
      "attempt-concurrent-v1",
    );
    const request = {
      method: "POST" as const,
      url: `/v1/cases/${caseId}/attempts`,
      headers: { "idempotency-key": "submit-attempt-concurrent-v1" },
      payload: {
        expectedVersion: 3,
        probeId: hypotheses.probe.id,
        selectedChoiceId: "choice-wrote",
      },
    };
    const [left, right] = await Promise.all([
      api.inject(request),
      api.inject(request),
    ]);

    expect(left.statusCode).toBe(200);
    expect(right.statusCode).toBe(200);
    expect(left.json<ApiResponse<AttemptView>>().data).toEqual(
      right.json<ApiResponse<AttemptView>>().data,
    );

    const events = await database.db
      .select()
      .from(learningEvidenceEvents)
      .where(eq(learningEvidenceEvents.caseId, caseId));
    expect(
      events.filter((event) => event.eventType === "probe_evaluated"),
    ).toHaveLength(1);
  }, 15_000);

  it("lets the worker generate one minimal intervention task", async () => {
    const { caseId, studentId } = await createInterventionReadyCase(
      api,
      "intervention-generate-v1",
    );
    const request = {
      method: "POST" as const,
      url: `/v1/cases/${caseId}/commands/run-next`,
      headers: { "idempotency-key": "run-next-intervention-v1" },
      payload: { expectedVersion: 4 },
    };
    const queued = await api.inject(request);
    const replay = await api.inject(request);

    expect(queued.statusCode).toBe(202);
    expect(replay.statusCode).toBe(202);
    expect(replay.json<ApiResponse<unknown>>().jobId).toBe(
      queued.json<ApiResponse<unknown>>().jobId,
    );

    const activeCase = await waitForState(api, caseId, "intervention_active");
    expect(activeCase.stateVersion).toBe(5);

    const today = await api.inject({
      method: "GET",
      url: `/v1/students/${studentId}/today`,
    });
    const body = today.json<ApiResponse<TodayTasksView>>();
    expect(today.statusCode).toBe(200);
    expect(body.data.tasks).toHaveLength(1);
    expect(body.data.tasks[0]).toMatchObject({
      caseId,
      studentId,
      taskType: "guided_intervention",
      status: "ready",
      estimatedMinutes: 8,
    });
    expect(body.data.tasks[0]?.steps).toHaveLength(3);
    expect(body.data.tasks[0]).not.toHaveProperty("answerKey");
    expect(body.data.tasks[0]).not.toHaveProperty("selectedHypothesisId");

    const storedTasks = await database.db
      .select()
      .from(tasks)
      .where(eq(tasks.caseId, caseId));
    expect(storedTasks).toHaveLength(1);

    const events = await database.db
      .select()
      .from(learningEvidenceEvents)
      .where(eq(learningEvidenceEvents.caseId, caseId));
    expect(
      events.filter((event) => event.eventType === "intervention_generated"),
    ).toHaveLength(1);
  }, 15_000);

  it("completes the intervention idempotently and schedules D+1", async () => {
    const { caseId, studentId } = await createInterventionReadyCase(
      api,
      "intervention-complete-v1",
    );
    await api.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/commands/run-next`,
      headers: { "idempotency-key": "run-next-intervention-complete-v1" },
      payload: { expectedVersion: 4 },
    });
    await waitForState(api, caseId, "intervention_active");

    const today = await api.inject({
      method: "GET",
      url: `/v1/students/${studentId}/today`,
    });
    const task = today.json<ApiResponse<TodayTasksView>>().data.tasks[0];
    expect(task).toBeDefined();
    const request = {
      method: "POST" as const,
      url: `/v1/tasks/${task?.id}/submit`,
      headers: { "idempotency-key": "complete-intervention-v1" },
      payload: {
        expectedVersion: 5,
        completedStepIds: task?.steps.map(({ id }) => id),
      },
    };
    const completed = await api.inject(request);
    const replay = await api.inject(request);
    const body = completed.json<ApiResponse<TaskCompletionView>>();

    expect(completed.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.json<ApiResponse<TaskCompletionView>>().data).toEqual(
      body.data,
    );
    expect(body.data).toMatchObject({
      caseId,
      state: "d1_scheduled",
      stateVersion: 6,
    });
    expect(body.data.completedTask.status).toBe("completed");
    expect(body.data.scheduledRetest).toMatchObject({
      taskType: "d1_retest",
      status: "scheduled",
    });
    const delayMs =
      Date.parse(body.data.scheduledRetest.scheduledFor) -
      Date.parse(body.data.completedTask.completedAt ?? "");
    expect(delayMs).toBe(24 * 60 * 60 * 1_000);

    const changedReplay = await api.inject({
      ...request,
      payload: { ...request.payload, completedStepIds: ["step-injected"] },
    });
    expect(changedReplay.statusCode).toBe(409);
    expect(changedReplay.json<ApiErrorResponse>().error.code).toBe(
      "IDEMPOTENCY_KEY_REUSED",
    );

    const storedTasks = await database.db
      .select()
      .from(tasks)
      .where(eq(tasks.caseId, caseId));
    expect(storedTasks).toHaveLength(2);
    expect(storedTasks.filter(({ status }) => status === "completed")).toHaveLength(1);
    expect(storedTasks.filter(({ status }) => status === "scheduled")).toHaveLength(1);
  }, 15_000);

  it("rejects incomplete, stale, and concurrent duplicate completions safely", async () => {
    const { caseId, studentId } = await createInterventionReadyCase(
      api,
      "intervention-validation-v1",
    );
    await api.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/commands/run-next`,
      headers: { "idempotency-key": "run-next-intervention-validation-v1" },
      payload: { expectedVersion: 4 },
    });
    await waitForState(api, caseId, "intervention_active");
    const today = await api.inject({
      method: "GET",
      url: `/v1/students/${studentId}/today`,
    });
    const task = today.json<ApiResponse<TodayTasksView>>().data.tasks[0];
    expect(task).toBeDefined();

    const stale = await api.inject({
      method: "POST",
      url: `/v1/tasks/${task?.id}/submit`,
      headers: { "idempotency-key": "complete-intervention-stale-v1" },
      payload: {
        expectedVersion: 4,
        completedStepIds: task?.steps.map(({ id }) => id),
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<ApiErrorResponse>().error.code).toBe("VERSION_CONFLICT");

    const incomplete = await api.inject({
      method: "POST",
      url: `/v1/tasks/${task?.id}/submit`,
      headers: { "idempotency-key": "complete-intervention-incomplete-v1" },
      payload: { expectedVersion: 5, completedStepIds: [task?.steps[0]?.id] },
    });
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json<ApiErrorResponse>().error.code).toBe("INVALID_INPUT");

    const request = {
      method: "POST" as const,
      url: `/v1/tasks/${task?.id}/submit`,
      headers: { "idempotency-key": "complete-intervention-concurrent-v1" },
      payload: {
        expectedVersion: 5,
        completedStepIds: task?.steps.map(({ id }) => id),
      },
    };
    const [left, right] = await Promise.all([
      api.inject(request),
      api.inject(request),
    ]);
    expect(left.statusCode).toBe(200);
    expect(right.statusCode).toBe(200);
    expect(left.json<ApiResponse<TaskCompletionView>>().data).toEqual(
      right.json<ApiResponse<TaskCompletionView>>().data,
    );

    const events = await database.db
      .select()
      .from(learningEvidenceEvents)
      .where(eq(learningEvidenceEvents.caseId, caseId));
    expect(
      events.filter((event) => event.eventType === "intervention_completed"),
    ).toHaveLength(1);
  }, 15_000);
});
