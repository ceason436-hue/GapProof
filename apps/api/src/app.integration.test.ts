import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  ApiErrorResponse,
  ApiResponse,
  CaseView,
  HypothesesView,
} from "@gapproof/contracts";
import {
  apiIdempotencyRecords,
  cases,
  createDatabase,
  eq,
  learningEvidenceEvents,
  runMigrations,
  students,
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

describeWithDatabase("Fastify API and run-next worker", () => {
  const database = createDatabase(databaseUrl ?? "");
  const queue = createJobQueue(databaseUrl ?? "");
  let api: Awaited<ReturnType<typeof buildApi>>;
  let worker: ReturnType<typeof createRunNextWorker>;

  beforeAll(async () => {
    await runMigrations(database.db);
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

    const events = await database.db
      .select()
      .from(learningEvidenceEvents)
      .where(eq(learningEvidenceEvents.caseId, caseId));
    expect(
      events.filter((event) => event.eventType === "hypotheses_generated"),
    ).toHaveLength(1);
  }, 15_000);
});
