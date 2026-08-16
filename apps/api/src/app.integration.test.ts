import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";

import type {
  ApiErrorResponse,
  ApiResponse,
  AttemptView,
  CaseView,
  D1RetestAttemptView,
  D7RetestAttemptView,
  DemoClockAdvanceView,
  HypothesesView,
  InitiatedSourceAssetUploadView,
  LearningTaskView,
  SourceAssetProcessingView,
  StartSyntheticRecognitionView,
  StudentProfileView,
  StudentFactReportsView,
  SyntheticQuickCheckResult,
  SyntheticQuickCheckView,
  TaskCompletionView,
  TodayTasksView,
  QuestionArchiveView,
  UploadedSourceAssetView,
} from "@gapproof/contracts";
import {
  apiIdempotencyRecords,
  activateDueRetestTask,
  cases,
  createDatabase,
  demoClocks,
  deviceSessions,
  eq,
  findCurrentActionableTaskId,
  learningEvidenceEvents,
  ocrBatchPages,
  ocrBatches,
  persistD1RetestEvaluation,
  runMigrations,
  sourceAssets,
  studentProfileRevisions,
  students,
  startSyntheticRecognitionIdempotent,
  tasks,
  tutorSessions,
  tutorTurns,
} from "@gapproof/db";
import { FixedClock } from "@gapproof/domain";
import { RealFormHypothesesAdapter } from "../../../packages/tools/src/form-hypotheses/real-form-hypotheses.ts";
import { RealBuildInterventionAdapter } from "../../../packages/tools/src/build-intervention/real-build-intervention.ts";
import {
  createJobQueue,
  REPLAN_QUEUE,
  RETEST_DUE_QUEUE,
  RUN_NEXT_QUEUE,
  SOURCE_ASSET_QUALITY_CHECK_QUEUE,
} from "@gapproof/jobs";
import {
  createReplanWorker,
  createRetestDueWorker,
  createRunNextWorker,
  createSourceAssetQualityWorker,
} from "@gapproof/worker";

import { buildApi } from "./app.ts";
import { LocalDirectorySourceAssetStorage, MAX_SOURCE_ASSET_BYTES } from "./source-asset-storage.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl === undefined ? describe.skip : describe;
const fixedNow = "2026-08-15T00:00:00.000Z";

function requireGuidedTask(task: LearningTaskView | undefined) {
  expect(task).toBeDefined();
  expect(task?.taskType).toBe("guided_intervention");
  if (task?.taskType !== "guided_intervention") {
    throw new Error("Expected a guided intervention task.");
  }
  return task;
}

function pngBytes(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

async function waitForSourceAsset(
  api: Awaited<ReturnType<typeof buildApi>>,
  assetId: string,
  expected: SourceAssetProcessingView["processingStatus"],
): Promise<SourceAssetProcessingView> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const response = await api.inject({ method: "GET", url: `/v1/source-assets/${assetId}` });
    const body = response.json<ApiResponse<SourceAssetProcessingView>>();
    if (body.data.processingStatus === expected) return body.data;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Source asset ${assetId} did not reach ${expected}.`);
}

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

async function createD1ScheduledCase(
  api: Awaited<ReturnType<typeof buildApi>>,
  keyPrefix: string,
) {
  const prepared = await createInterventionReadyCase(api, keyPrefix);
  await api.inject({
    method: "POST",
    url: `/v1/cases/${prepared.caseId}/commands/run-next`,
    headers: { "idempotency-key": `${keyPrefix}-intervention` },
    payload: { expectedVersion: 4 },
  });
  await waitForState(api, prepared.caseId, "intervention_active");
  const today = await api.inject({
    method: "GET",
    url: `/v1/students/${prepared.studentId}/today`,
  });
  const intervention = requireGuidedTask(
    today.json<ApiResponse<TodayTasksView>>().data.tasks[0],
  );
  const completed = await api.inject({
    method: "POST",
    url: `/v1/tasks/${intervention?.id}/submit`,
    headers: { "idempotency-key": `${keyPrefix}-complete` },
    payload: {
      expectedVersion: 5,
      completedStepIds: intervention.steps.map(({ id }) => id),
    },
  });
  expect(completed.statusCode).toBe(200);
  const completion = completed.json<ApiResponse<TaskCompletionView>>().data;
  return { ...prepared, completion };
}

async function activatePreparedD1(
  api: Awaited<ReturnType<typeof buildApi>>,
  database: ReturnType<typeof createDatabase>["db"],
  keyPrefix: string,
) {
  const prepared = await createD1ScheduledCase(api, keyPrefix);
  const task = prepared.completion.scheduledRetest;
  await activateDueRetestTask(database, {
    caseId: prepared.caseId,
    taskId: task.id,
    effectiveNow: new Date(task.scheduledFor),
  });
  return { ...prepared, task: { ...task, status: "ready" as const } };
}

async function activatePreparedD7(
  api: Awaited<ReturnType<typeof buildApi>>,
  database: ReturnType<typeof createDatabase>["db"],
  keyPrefix: string,
) {
  const prepared = await activatePreparedD1(api, database, `${keyPrefix}-d1`);
  const d1 = await api.inject({
    method: "POST",
    url: `/v1/tasks/${prepared.task.id}/attempts`,
    headers: { "idempotency-key": `${keyPrefix}-d1-attempt` },
    payload: {
      expectedVersion: 6,
      itemId: prepared.task.item.id,
      selectedChoiceId: "choice-written",
    },
  });
  expect(d1.statusCode).toBe(200);
  const d1Body = d1.json<ApiResponse<D1RetestAttemptView>>().data;
  expect(d1Body.scheduledRetest).not.toBeNull();
  const d7 = d1Body.scheduledRetest;
  if (d7 === null) throw new Error("Expected a scheduled D7 task.");
  await activateDueRetestTask(database, {
    caseId: prepared.caseId,
    taskId: d7.id,
    effectiveNow: new Date(d7.scheduledFor),
  });
  return { ...prepared, d7: { ...d7, status: "ready" as const } };
}

describeWithDatabase("Fastify API and run-next worker", () => {
  const database = createDatabase(databaseUrl ?? "");
  const queue = createJobQueue(databaseUrl ?? "");
  let api: Awaited<ReturnType<typeof buildApi>>;
  let worker: ReturnType<typeof createRunNextWorker>;
  let retestDueWorker: ReturnType<typeof createRetestDueWorker>;
  let qualityWorker: ReturnType<typeof createSourceAssetQualityWorker>;
  let uploadRoot: string;
  let uploadStorage: LocalDirectorySourceAssetStorage;

  beforeAll(async () => {
    await runMigrations(database.db);
    await database.db.delete(tutorTurns);
    await database.db.delete(tutorSessions);
    await database.db.delete(tasks);
    await database.db.delete(ocrBatchPages);
    await database.db.delete(ocrBatches);
    await database.db.delete(sourceAssets);
    await database.db.delete(learningEvidenceEvents);
    await database.db.delete(demoClocks);
    await database.db.delete(apiIdempotencyRecords);
    await database.db.delete(cases);
    await database.db.delete(studentProfileRevisions);
    await database.db.delete(deviceSessions);
    await database.db.delete(students);

    await queue.start();
    await queue.boss.deleteAllJobs(RETEST_DUE_QUEUE);
    await queue.boss.deleteAllJobs(REPLAN_QUEUE);
    await queue.boss.deleteAllJobs(RUN_NEXT_QUEUE);
    await queue.boss.deleteAllJobs(SOURCE_ASSET_QUALITY_CHECK_QUEUE);
    worker = createRunNextWorker({
      database: database.db,
      queue,
      realFormHypotheses: new RealFormHypothesesAdapter({
        enabled: true,
        transport: {
          execute: async () => ({
            status: 200,
            payload: {
              content: JSON.stringify({
                candidates: [
                  { title: "可能遗漏题目条件", explanation: "需要确认当时是否完整读取了条件。" },
                  { title: "可能混淆相关规则", explanation: "需要确认规则适用范围是否清楚。" },
                ],
                question: "哪一种情况更接近你当时的思考？",
                choices: [
                  { label: "我漏看了一个条件", hypothesisIndex: 0 },
                  { label: "我不确定该用哪条规则", hypothesisIndex: 1 },
                  { label: "都不是", hypothesisIndex: null },
                ],
              }),
              model: "integration-fixture",
            },
          }),
        },
      }),
      realBuildIntervention: new RealBuildInterventionAdapter({
        enabled: true,
        transport: {
          execute: async () => ({
            status: 200,
            payload: {
              content: JSON.stringify({
                title: "分清现在完成时的过去分词",
                rationale: "根据已确认题目，先澄清词形，再用新题独立判断。",
                knowledgeTarget: "have 或 has 后使用过去分词",
                estimatedMinutes: 8,
                steps: [
                  { kind: "explain", title: "想规则", content: "have 或 has 后需要过去分词。" },
                  { kind: "worked_example", title: "看例子", content: "They have finished the work." },
                  { kind: "guided_practice", title: "说理由", content: "补全一个新句子，并说明选择依据。" },
                ],
                retests: {
                  d1: { prompt: "She has ___ the letter.", choices: ["write", "wrote", "written"], correctIndex: 2 },
                  d7: { prompt: "We have ___ our notes.", choices: ["review", "reviewed", "reviewing"], correctIndex: 1 },
                },
              }),
              model: "integration-fixture",
            },
          }),
        },
      }),
    });
    await worker.start();
    retestDueWorker = createRetestDueWorker({
      database: database.db,
      queue,
    });
    await retestDueWorker.start();
    uploadRoot = await mkdtemp(path.join(os.tmpdir(), "gapproof-api-upload-"));
    uploadStorage = new LocalDirectorySourceAssetStorage(uploadRoot);
    qualityWorker = createSourceAssetQualityWorker({ database: database.db, queue, storage: uploadStorage });
    await qualityWorker.start();
    api = await buildApi({
      database: database.db,
      queue,
      clock: new FixedClock(fixedNow),
      demoClockEnabled: true,
      uploadStorage,
      uploadSigningSecret: "integration-upload-secret",
    });
  });

  afterAll(async () => {
    await api?.close();
    await qualityWorker?.stop();
    await retestDueWorker?.stop();
    await worker?.stop();
    await queue.stop();
    await database.close();
    if (uploadRoot !== undefined) await rm(uploadRoot, { recursive: true, force: true });
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

  it("saves an explicit first-use profile, replays safely, and rejects stale or changed saves", async () => {
    const created = await api.inject({
      method: "POST", url: "/v1/cases", headers: { "idempotency-key": "profile-fixture-case" }, payload: { entry: "synthetic_demo" },
    });
    const studentId = created.json<ApiResponse<CaseView>>().data.studentId;
    const before = await api.inject({ method: "GET", url: `/v1/students/${studentId}/profile` });
    expect(before.json<ApiResponse<StudentProfileView>>().data).toMatchObject({ completed: false, version: 0, grade: null, subject: null });

    const request = {
      method: "PUT" as const,
      url: `/v1/students/${studentId}/profile`,
      headers: { "idempotency-key": "0198b111-1111-7000-8000-0000000000f1" },
      payload: { expectedVersion: 0, grade: "8", subject: "english", term: "first_term", region: "shanghai", learningState: "catching_up" },
    };
    const saved = await api.inject(request);
    expect(saved.statusCode).toBe(200);
    expect(saved.json<ApiResponse<StudentProfileView>>().data).toMatchObject({ completed: true, version: 1, learningState: "catching_up" });
    const replay = await api.inject(request);
    expect(replay.statusCode).toBe(200);
    expect(replay.json<ApiResponse<StudentProfileView>>().data.version).toBe(1);

    const changedReplay = await api.inject({ ...request, payload: { ...request.payload, learningState: "steady" } });
    expect(changedReplay.statusCode).toBe(409);
    expect(changedReplay.json<ApiErrorResponse>().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    const stale = await api.inject({ ...request, headers: { "idempotency-key": "0198b111-1111-7000-8000-0000000000f2" } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<ApiErrorResponse>().error.code).toBe("VERSION_CONFLICT");

    const today = await api.inject({ method: "GET", url: `/v1/students/${studentId}/today` });
    expect(today.json<ApiResponse<TodayTasksView>>().data.profile).toMatchObject({ completed: true, version: 1 });
    expect(await database.db.select().from(studentProfileRevisions).where(eq(studentProfileRevisions.studentId, studentId))).toHaveLength(1);
  });

  it("serves and scores the three-question synthetic quick check without private answers or records", async () => {
    const casesBefore = (await database.db.select({ id: cases.id }).from(cases)).length;
    const eventsBefore = (await database.db.select({ id: learningEvidenceEvents.id }).from(learningEvidenceEvents)).length;
    const idempotencyBefore = (await database.db.select({ id: apiIdempotencyRecords.id }).from(apiIdempotencyRecords)).length;
    const questionsResponse = await api.inject({
      method: "GET",
      url: "/v1/quick-checks/synthetic",
    });
    const questions = questionsResponse.json<ApiResponse<SyntheticQuickCheckView>>().data;
    expect(questionsResponse.statusCode).toBe(200);
    expect(questions.questions).toHaveLength(3);
    expect(JSON.stringify(questions)).not.toContain("expectedChoiceId");

    const resultResponse = await api.inject({
      method: "POST",
      url: "/v1/quick-checks/synthetic/attempts",
      headers: { "idempotency-key": "synthetic-quick-check-v1" },
      payload: { answers: [
        { itemId: "quick-check-participle-v1", selectedChoiceId: "choice-wrote" },
        { itemId: "quick-check-past-v1", selectedChoiceId: "choice-went" },
        { itemId: "quick-check-passive-v1", selectedChoiceId: "choice-was-written" },
      ] },
    });
    const result = resultResponse.json<ApiResponse<SyntheticQuickCheckResult>>().data;
    expect(resultResponse.statusCode).toBe(200);
    expect(result).toMatchObject({
      correctCount: 2,
      finding: "irregular_participle",
      learningRecordCreated: false,
      reportReady: false,
    });
    const replayResponse = await api.inject({
      method: "POST",
      url: "/v1/quick-checks/synthetic/attempts",
      headers: { "idempotency-key": "synthetic-quick-check-v1" },
      payload: { answers: [
        { itemId: "quick-check-participle-v1", selectedChoiceId: "choice-wrote" },
        { itemId: "quick-check-past-v1", selectedChoiceId: "choice-went" },
        { itemId: "quick-check-passive-v1", selectedChoiceId: "choice-was-written" },
      ] },
    });
    expect(replayResponse.statusCode).toBe(200);
    expect(replayResponse.json<ApiResponse<SyntheticQuickCheckResult>>().data).toEqual(result);
    expect((await database.db.select({ id: cases.id }).from(cases))).toHaveLength(casesBefore);
    expect((await database.db.select({ id: learningEvidenceEvents.id }).from(learningEvidenceEvents))).toHaveLength(eventsBefore);
    expect((await database.db.select({ id: apiIdempotencyRecords.id }).from(apiIdempotencyRecords))).toHaveLength(idempotencyBefore);

    const invalid = await api.inject({
      method: "POST",
      url: "/v1/quick-checks/synthetic/attempts",
      headers: { "idempotency-key": "synthetic-quick-check-invalid-v1" },
      payload: { answers: [
        { itemId: "quick-check-participle-v1", selectedChoiceId: "choice-written" },
        { itemId: "quick-check-past-v1", selectedChoiceId: "choice-went" },
        { itemId: "quick-check-passive-v1", selectedChoiceId: "not-a-choice" },
      ] },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json<ApiErrorResponse>().error.code).toBe("INVALID_INPUT");
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

  it("initiates and completes a source asset upload without exposing storage metadata", async () => {
    const created = await api.inject({
      method: "POST",
      url: "/v1/cases",
      headers: { "idempotency-key": "source-upload-case-v1" },
      payload: { entry: "synthetic_demo" },
    });
    const caseView = created.json<ApiResponse<CaseView>>().data;
    const bytes = Buffer.from("source upload integration bytes");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const payload = {
      studentId: caseView.studentId,
      caseId: caseView.id,
      fileName: "worksheet.png",
      mimeType: "image/png" as const,
      byteSize: bytes.byteLength,
      sha256,
    };
    const first = await api.inject({
      method: "POST",
      url: "/v1/source-assets/uploads",
      headers: { "idempotency-key": "source-upload-init-v1" },
      payload,
    });
    const firstBody = first.json<ApiResponse<InitiatedSourceAssetUploadView>>();
    expect(first.statusCode).toBe(201);
    expect(firstBody.data.upload.path).toBe(`/api/v1/source-assets/${firstBody.data.assetId}/content`);
    expect(firstBody.data.upload.token).toBeTruthy();
    expect(firstBody.data).not.toHaveProperty("objectKey");

    const replay = await api.inject({
      method: "POST",
      url: "/v1/source-assets/uploads",
      headers: { "idempotency-key": "source-upload-init-v1" },
      payload: { ...payload, fileName: "renamed-locally.png" },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json<ApiResponse<InitiatedSourceAssetUploadView>>().data.assetId).toBe(firstBody.data.assetId);

    const reused = await api.inject({
      method: "POST",
      url: "/v1/source-assets/uploads",
      headers: { "idempotency-key": "source-upload-init-v1" },
      payload: { ...payload, byteSize: payload.byteSize + 1 },
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json<ApiErrorResponse>().error.code).toBe("IDEMPOTENCY_KEY_REUSED");

    const tampered = await api.inject({
      method: "PUT",
      url: firstBody.data.upload.path.replace("/api", ""),
      headers: {
        "x-gapproof-upload-token": `${firstBody.data.upload.token}tampered`,
        "content-type": "image/png",
      },
      payload: bytes,
    });
    expect(tampered.statusCode).toBe(401);

    const mismatch = await api.inject({
      method: "PUT",
      url: firstBody.data.upload.path.replace("/api", ""),
      headers: {
        "x-gapproof-upload-token": firstBody.data.upload.token,
        "content-type": "image/png",
      },
      payload: Buffer.from("different bytes"),
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json<ApiErrorResponse>().error.code).toBe("UPLOAD_CONTENT_MISMATCH");

    const uploaded = await api.inject({
      method: "PUT",
      url: firstBody.data.upload.path.replace("/api", ""),
      headers: {
        "x-gapproof-upload-token": firstBody.data.upload.token,
        "content-type": "image/png",
      },
      payload: bytes,
    });
    const uploadedBody = uploaded.json<ApiResponse<UploadedSourceAssetView>>();
    expect(uploaded.statusCode).toBe(200);
    expect(uploadedBody.data).toEqual({
      assetId: firstBody.data.assetId,
      processingStatus: "uploaded",
      mimeType: "image/png",
      byteSize: bytes.byteLength,
      sha256,
    });
    expect(uploadedBody.data).not.toHaveProperty("token");
    expect(uploadedBody.data).not.toHaveProperty("fileName");

    const [storedAsset] = await database.db
      .select()
      .from(sourceAssets)
      .where(eq(sourceAssets.id, firstBody.data.assetId));
    expect(storedAsset?.processingStatus).toBe("uploaded");
    expect(storedAsset?.createdAt.toISOString()).toBe(fixedNow);
    expect(storedAsset?.retentionUntil?.toISOString()).toBe("2026-08-22T00:00:00.000Z");
    expect(await readFile(uploadStorage.pathFor(storedAsset!.id, storedAsset!.objectKey))).toEqual(bytes);

    const replayedPut = await api.inject({
      method: "PUT",
      url: firstBody.data.upload.path.replace("/api", ""),
      headers: {
        "x-gapproof-upload-token": firstBody.data.upload.token,
        "content-type": "image/png",
      },
      payload: bytes,
    });
    expect(replayedPut.statusCode).toBe(200);
  });

  it("accepts the exact 10 MiB upload boundary", async () => {
    const created = await api.inject({
      method: "POST",
      url: "/v1/cases",
      headers: { "idempotency-key": "source-upload-boundary-case-v1" },
      payload: { entry: "synthetic_demo" },
    });
    const caseView = created.json<ApiResponse<CaseView>>().data;
    const bytes = Buffer.alloc(MAX_SOURCE_ASSET_BYTES, 7);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const initiated = await api.inject({
      method: "POST",
      url: "/v1/source-assets/uploads",
      headers: { "idempotency-key": "source-upload-boundary-init-v1" },
      payload: {
        studentId: caseView.studentId,
        caseId: null,
        fileName: "boundary.webp",
        mimeType: "image/webp",
        byteSize: MAX_SOURCE_ASSET_BYTES,
        sha256,
      },
    });
    expect(initiated.statusCode).toBe(201);
    const upload = initiated.json<ApiResponse<InitiatedSourceAssetUploadView>>().data.upload;
    const uploaded = await api.inject({
      method: "PUT",
      url: upload.path.replace("/api", ""),
      headers: {
        "x-gapproof-upload-token": upload.token,
        "content-type": "image/webp",
      },
      payload: bytes,
    });
    expect(uploaded.statusCode).toBe(200);
  });

  it("prepares uploaded source assets once and persists deterministic image quality", async () => {
    await qualityWorker.stop();
    const created = await api.inject({
      method: "POST",
      url: "/v1/cases",
      headers: { "idempotency-key": "source-inspection-case-v1" },
      payload: { entry: "synthetic_demo" },
    });
    const caseView = created.json<ApiResponse<CaseView>>().data;
    const bytes = pngBytes(1280, 960);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const initiated = await api.inject({
      method: "POST",
      url: "/v1/source-assets/uploads",
      headers: { "idempotency-key": "source-inspection-upload-v1" },
      payload: {
        studentId: caseView.studentId,
        caseId: caseView.id,
        fileName: "worksheet.png",
        mimeType: "image/png",
        byteSize: bytes.byteLength,
        sha256,
      },
    });
    const upload = initiated.json<ApiResponse<InitiatedSourceAssetUploadView>>().data;
    const beforeUpload = await api.inject({
      method: "POST",
      url: `/v1/source-assets/${upload.assetId}/commands/prepare`,
      headers: { "idempotency-key": "source-inspection-pending-v1" },
      payload: {},
    });
    expect(beforeUpload.statusCode).toBe(409);
    expect(beforeUpload.json<ApiErrorResponse>().error.code).toBe("SOURCE_ASSET_NOT_UPLOADED");
    await api.inject({
      method: "PUT",
      url: upload.upload.path.replace("/api", ""),
      headers: { "x-gapproof-upload-token": upload.upload.token, "content-type": "image/png" },
      payload: bytes,
    });

    const prepare = await api.inject({
      method: "POST",
      url: `/v1/source-assets/${upload.assetId}/commands/prepare`,
      headers: { "idempotency-key": "source-inspection-prepare-v1" },
      payload: {},
    });
    const queued = prepare.json<ApiResponse<{ assetId: string; stage: string; processingStatus: string }>>();
    expect(prepare.statusCode).toBe(202);
    expect(queued.data).toEqual({ assetId: upload.assetId, stage: "image_quality_check", processingStatus: "queued" });
    expect(queued.jobId).toBe(upload.assetId);

    const replay = await api.inject({
      method: "POST",
      url: `/v1/source-assets/${upload.assetId}/commands/prepare`,
      headers: { "idempotency-key": "source-inspection-prepare-v1" },
      payload: {},
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json<ApiResponse<{ assetId: string }>>().jobId).toBe(upload.assetId);

    const alternateKey = await api.inject({
      method: "POST",
      url: `/v1/source-assets/${upload.assetId}/commands/prepare`,
      headers: { "idempotency-key": "source-inspection-prepare-v2" },
      payload: {},
    });
    expect(alternateKey.statusCode).toBe(200);
    expect(alternateKey.json<ApiResponse<{ assetId: string }>>().data.assetId).toBe(upload.assetId);

    await qualityWorker.start();
    const inspected = await waitForSourceAsset(api, upload.assetId, "succeeded");
    expect(inspected.quality).toMatchObject({
      status: "passed",
      detectedMimeType: "image/png",
      width: 1280,
      height: 960,
      reasons: [],
      checkerVersion: "image-header-v1",
    });
    expect(inspected).not.toHaveProperty("objectKey");
    expect(inspected).not.toHaveProperty("token");
    expect(inspected).not.toHaveProperty("fileName");
    expect(inspected).not.toHaveProperty("ocrText");
  });

  it("starts synthetic recognition from a passed upload without using its bytes", async () => {
    const created = await api.inject({
      method: "POST",
      url: "/v1/cases",
      headers: { "idempotency-key": "source-start-recognition-student-v1" },
      payload: { entry: "synthetic_demo" },
    });
    const studentId = created.json<ApiResponse<CaseView>>().data.studentId;
    const bytes = pngBytes(1280, 960);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const initiated = await api.inject({
      method: "POST",
      url: "/v1/source-assets/uploads",
      headers: { "idempotency-key": "source-start-recognition-upload-v1" },
      payload: {
        studentId,
        caseId: null,
        fileName: "worksheet.png",
        mimeType: "image/png",
        byteSize: bytes.byteLength,
        sha256,
      },
    });
    const upload = initiated.json<ApiResponse<InitiatedSourceAssetUploadView>>().data;
    await api.inject({
      method: "PUT",
      url: upload.upload.path.replace("/api", ""),
      headers: { "x-gapproof-upload-token": upload.upload.token, "content-type": "image/png" },
      payload: bytes,
    });
    await api.inject({
      method: "POST",
      url: `/v1/source-assets/${upload.assetId}/commands/prepare`,
      headers: { "idempotency-key": "source-start-recognition-prepare-v1" },
      payload: {},
    });
    const inspected = await waitForSourceAsset(api, upload.assetId, "succeeded");
    expect(inspected.quality?.status).toBe("passed");

    const startRequest = {
      method: "POST" as const,
      url: `/v1/source-assets/${upload.assetId}/commands/start-recognition`,
      headers: { "idempotency-key": "source-start-recognition-v1" },
      payload: { mode: "synthetic_demo", guardianConfirmed: true },
    };
    const [started, concurrent] = await Promise.all([
      api.inject(startRequest),
      api.inject(startRequest),
    ]);
    const startedBody = started.json<ApiResponse<StartSyntheticRecognitionView>>();
    expect([started.statusCode, concurrent.statusCode].sort()).toEqual([200, 202]);
    expect(startedBody.data).toMatchObject({
      assetId: upload.assetId,
      state: "awaiting_evidence",
      stateVersion: 0,
      recognitionMode: "synthetic_demo",
      recognitionSource: "synthetic_fixture",
      uploadedAssetUsedForRecognition: false,
      processingStatus: "queued",
    });
    expect(startedBody.jobId).toBeTruthy();
    expect(concurrent.json<ApiResponse<StartSyntheticRecognitionView>>().data).toEqual(startedBody.data);
    expect(concurrent.json<ApiResponse<StartSyntheticRecognitionView>>().jobId).toBe(startedBody.jobId);
    expect(JSON.stringify(startedBody)).not.toContain("guardian");
    const replay = await api.inject(startRequest);
    expect(replay.statusCode).toBe(200);
    expect(replay.json<ApiResponse<StartSyntheticRecognitionView>>().data).toEqual(startedBody.data);
    expect(replay.json<ApiResponse<StartSyntheticRecognitionView>>().jobId).toBe(startedBody.jobId);
    const reusedIntent = await api.inject({
      ...startRequest,
      url: "/v1/source-assets/0198b111-1111-7000-8000-000000000099/commands/start-recognition",
    });
    expect(reusedIntent.statusCode).toBe(409);
    expect(reusedIntent.json<ApiErrorResponse>().error.code).toBe("IDEMPOTENCY_KEY_REUSED");

    const completed = await waitForState(api, startedBody.data.caseId, "awaiting_confirmation");
    expect(completed.synthetic).toBe(true);
    const [boundAsset] = await database.db.select().from(sourceAssets).where(eq(sourceAssets.id, upload.assetId));
    expect(boundAsset?.caseId).toBe(startedBody.data.caseId);
    expect(boundAsset?.processingStatus).toBe("succeeded");
    expect(boundAsset?.retentionUntil?.toISOString()).toBe("2026-08-22T00:00:00.000Z");
    const events = await database.db.select().from(learningEvidenceEvents).where(eq(learningEvidenceEvents.caseId, startedBody.data.caseId));
    const evidence = events.find(({ eventType }) => eventType === "evidence_ingested");
    expect(evidence).toMatchObject({ sourceType: "fake_ocr", sourceRef: "asset-synthetic-paper-1" });
    expect(JSON.stringify(evidence?.payload)).not.toContain(upload.assetId);
    expect(JSON.stringify(evidence?.payload)).not.toContain("source-assets/");

    const extractionResponse = await api.inject({
      method: "GET",
      url: `/v1/cases/${startedBody.data.caseId}/extraction`,
    });
    const extraction = extractionResponse.json<ApiResponse<{
      caseId: string;
      state: string;
      stateVersion: number;
      recognitionSource: string;
      uploadedAssetUsedForRecognition: boolean;
      items: Array<{ itemId: string; prompt: string }>;
    }>>();
    expect(extractionResponse.statusCode).toBe(200);
    expect(extraction.data).toMatchObject({
      caseId: startedBody.data.caseId,
      state: "awaiting_confirmation",
      stateVersion: 1,
      recognitionSource: "synthetic_fixture",
      uploadedAssetUsedForRecognition: false,
    });
    expect(extraction.data.items).toEqual([
      expect.objectContaining({
        itemId: "item-synthetic-irregular-participle-1",
        prompt: expect.any(String),
      }),
    ]);
    expect(JSON.stringify(extraction)).not.toContain("studentAnswer");
    expect(JSON.stringify(extraction)).not.toContain("confidence");
    expect(JSON.stringify(extraction)).not.toContain("asset-synthetic-paper-1");

    const confirmed = await api.inject({
      method: "POST",
      url: `/v1/cases/${startedBody.data.caseId}/extraction/confirm`,
      headers: { "idempotency-key": "source-start-recognition-confirm-v1" },
      payload: {
        expectedVersion: 1,
        confirmedItemIds: ["item-synthetic-irregular-participle-1"],
        corrections: [],
      },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json<ApiResponse<CaseView>>().data).toMatchObject({
      id: startedBody.data.caseId,
      state: "ready_for_diagnosis",
      stateVersion: 2,
    });

    const next = await api.inject({
      method: "POST",
      url: `/v1/cases/${startedBody.data.caseId}/commands/run-next`,
      headers: { "idempotency-key": "source-start-recognition-next-v1" },
      payload: { expectedVersion: 2 },
    });
    expect(next.statusCode).toBe(202);
    await waitForState(api, startedBody.data.caseId, "probe_required");
  }, 35_000);

  it("requires guardian confirmation at the synthetic recognition contract boundary", async () => {
    const response = await api.inject({
      method: "POST",
      url: "/v1/source-assets/0198b111-1111-7000-8000-000000000001/commands/start-recognition",
      headers: { "idempotency-key": "source-start-recognition-guardian-required-v1" },
      payload: { mode: "synthetic_demo" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorResponse>().error.code).toBe("SCHEMA_INVALID");
  });

  it("fails closed for extraction reads before recognition and across Cases", async () => {
    const first = await api.inject({
      method: "POST",
      url: "/v1/cases",
      headers: { "idempotency-key": "extraction-read-not-ready-first-v1" },
      payload: { entry: "synthetic_demo" },
    });
    const second = await api.inject({
      method: "POST",
      url: "/v1/cases",
      headers: { "idempotency-key": "extraction-read-not-ready-second-v1" },
      payload: { entry: "synthetic_demo" },
    });
    const firstCaseId = first.json<ApiResponse<CaseView>>().data.id;
    const secondCaseId = second.json<ApiResponse<CaseView>>().data.id;
    const notReady = await api.inject({
      method: "GET",
      url: `/v1/cases/${firstCaseId}/extraction`,
    });
    expect(notReady.statusCode).toBe(409);
    expect(notReady.json<ApiErrorResponse>().error.code).toBe("EXTRACTION_NOT_READY");

    const missing = await api.inject({
      method: "GET",
      url: "/v1/cases/0198b111-1111-7000-8000-999999999999/extraction",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<ApiErrorResponse>().error.code).toBe("RESOURCE_NOT_FOUND");

    const crossCaseConfirm = await api.inject({
      method: "POST",
      url: `/v1/cases/${secondCaseId}/extraction/confirm`,
      headers: { "idempotency-key": "extraction-read-cross-case-confirm-v1" },
      payload: {
        expectedVersion: 0,
        confirmedItemIds: ["item-synthetic-irregular-participle-1"],
        corrections: [],
      },
    });
    expect(crossCaseConfirm.statusCode).toBe(409);
    expect(crossCaseConfirm.json<ApiErrorResponse>().error.code).toBe("INVALID_CASE_TRANSITION");
  });

  it("rejects unready, non-passed, and already-bound assets without creating recognition state", async () => {
    const created = await api.inject({
      method: "POST",
      url: "/v1/cases",
      headers: { "idempotency-key": "source-start-rejection-fixture-v1" },
      payload: { entry: "synthetic_demo" },
    });
    const caseView = created.json<ApiResponse<CaseView>>().data;

    const initiate = async (key: string, bytes: Buffer) => {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const response = await api.inject({
        method: "POST",
        url: "/v1/source-assets/uploads",
        headers: { "idempotency-key": `${key}-upload` },
        payload: {
          studentId: caseView.studentId,
          caseId: null,
          fileName: `${key}.png`,
          mimeType: "image/png",
          byteSize: bytes.byteLength,
          sha256,
        },
      });
      expect(response.statusCode).toBe(201);
      const asset = response.json<ApiResponse<InitiatedSourceAssetUploadView>>().data;
      const uploaded = await api.inject({
        method: "PUT",
        url: asset.upload.path.replace("/api", ""),
        headers: { "x-gapproof-upload-token": asset.upload.token, "content-type": "image/png" },
        payload: bytes,
      });
      expect(uploaded.statusCode).toBe(200);
      return asset;
    };

    const pendingResponse = await api.inject({
      method: "POST",
      url: "/v1/source-assets/uploads",
      headers: { "idempotency-key": "source-start-pending-upload-v1" },
      payload: {
        studentId: caseView.studentId,
        caseId: null,
        fileName: "pending.png",
        mimeType: "image/png",
        byteSize: 33,
        sha256: createHash("sha256").update(pngBytes(1280, 960)).digest("hex"),
      },
    });
    const pending = pendingResponse.json<ApiResponse<InitiatedSourceAssetUploadView>>().data;
    const low = await initiate("source-start-needs-confirmation-v1", pngBytes(320, 240));
    await api.inject({
      method: "POST",
      url: `/v1/source-assets/${low.assetId}/commands/prepare`,
      headers: { "idempotency-key": "source-start-needs-confirmation-prepare-v1" },
      payload: {},
    });
    await waitForSourceAsset(api, low.assetId, "needs_confirmation");

    for (const [assetId, key] of [
      [pending.assetId, "source-start-pending-reject-v1"],
      [low.assetId, "source-start-quality-reject-v1"],
    ] as const) {
      const response = await api.inject({
        method: "POST",
        url: `/v1/source-assets/${assetId}/commands/start-recognition`,
        headers: { "idempotency-key": key },
        payload: { mode: "synthetic_demo", guardianConfirmed: true },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json<ApiErrorResponse>().error.code).toBe("SOURCE_ASSET_RECOGNITION_NOT_READY");
      const [row] = await database.db.select().from(sourceAssets).where(eq(sourceAssets.id, assetId));
      expect(row?.caseId).toBeNull();
      const [record] = await database.db
        .select()
        .from(apiIdempotencyRecords)
        .where(eq(apiIdempotencyRecords.idempotencyKey, key));
      expect(record).toBeUndefined();
    }

    const bound = await initiate("source-start-bound-v1", pngBytes(1280, 960));
    await api.inject({
      method: "POST",
      url: `/v1/source-assets/${bound.assetId}/commands/prepare`,
      headers: { "idempotency-key": "source-start-bound-prepare-v1" },
      payload: {},
    });
    await waitForSourceAsset(api, bound.assetId, "succeeded");
    const firstStart = await api.inject({
      method: "POST",
      url: `/v1/source-assets/${bound.assetId}/commands/start-recognition`,
      headers: { "idempotency-key": "source-start-bound-first-v1" },
      payload: { mode: "synthetic_demo", guardianConfirmed: true },
    });
    expect(firstStart.statusCode).toBe(202);
    const secondStart = await api.inject({
      method: "POST",
      url: `/v1/source-assets/${bound.assetId}/commands/start-recognition`,
      headers: { "idempotency-key": "source-start-bound-second-v1" },
      payload: { mode: "synthetic_demo", guardianConfirmed: true },
    });
    expect(secondStart.statusCode).toBe(409);
    expect(secondStart.json<ApiErrorResponse>().error.code).toBe("SOURCE_ASSET_ALREADY_BOUND");

    const rollbackAsset = await initiate("source-start-rollback-v1", pngBytes(1280, 960));
    await api.inject({
      method: "POST",
      url: `/v1/source-assets/${rollbackAsset.assetId}/commands/prepare`,
      headers: { "idempotency-key": "source-start-rollback-prepare-v1" },
      payload: {},
    });
    await waitForSourceAsset(api, rollbackAsset.assetId, "succeeded");
    const rollbackCaseId = uuidv7();
    const rollbackKey = "source-start-rollback-enqueue-v1";
    await expect(startSyntheticRecognitionIdempotent(database.db, {
      assetId: rollbackAsset.assetId,
      caseId: rollbackCaseId,
      idempotencyKey: rollbackKey,
      idempotencyRecordId: uuidv7(),
      enqueueRunNext: async () => {
        throw new Error("controlled enqueue failure");
      },
    })).rejects.toThrow("controlled enqueue failure");
    const [rollbackRow] = await database.db.select().from(sourceAssets).where(eq(sourceAssets.id, rollbackAsset.assetId));
    expect(rollbackRow?.caseId).toBeNull();
    const [rollbackCase] = await database.db.select().from(cases).where(eq(cases.id, rollbackCaseId));
    expect(rollbackCase).toBeUndefined();
    const [rollbackRecord] = await database.db
      .select()
      .from(apiIdempotencyRecords)
      .where(eq(apiIdempotencyRecords.idempotencyKey, rollbackKey));
    expect(rollbackRecord).toBeUndefined();
  }, 35_000);

  it("fails closed for missing bytes and requests confirmation for low resolution", async () => {
    await qualityWorker.stop();
    const created = await api.inject({
      method: "POST",
      url: "/v1/cases",
      headers: { "idempotency-key": "source-inspection-edge-case-v1" },
      payload: { entry: "synthetic_demo" },
    });
    const caseView = created.json<ApiResponse<CaseView>>().data;

    const initiate = async (key: string, bytes: Buffer) => {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const response = await api.inject({
        method: "POST",
        url: "/v1/source-assets/uploads",
        headers: { "idempotency-key": `${key}-upload` },
        payload: {
          studentId: caseView.studentId,
          caseId: caseView.id,
          fileName: `${key}.png`,
          mimeType: "image/png",
          byteSize: bytes.byteLength,
          sha256,
        },
      });
      const asset = response.json<ApiResponse<InitiatedSourceAssetUploadView>>().data;
      const uploaded = await api.inject({
        method: "PUT",
        url: asset.upload.path.replace("/api", ""),
        headers: { "x-gapproof-upload-token": asset.upload.token, "content-type": "image/png" },
        payload: bytes,
      });
      expect(uploaded.statusCode).toBe(200);
      return asset;
    };

    const missing = await initiate("source-inspection-missing-v1", pngBytes(1280, 960));
    const low = await initiate("source-inspection-low-v1", pngBytes(320, 240));
    const [missingRow] = await database.db.select().from(sourceAssets).where(eq(sourceAssets.id, missing.assetId));
    await uploadStorage.remove({ assetId: missingRow!.id, objectKey: missingRow!.objectKey });

    for (const [assetId, key] of [[missing.assetId, "source-inspection-missing-prepare-v1"], [low.assetId, "source-inspection-low-prepare-v1"]] as const) {
      const prepared = await api.inject({
        method: "POST",
        url: `/v1/source-assets/${assetId}/commands/prepare`,
        headers: { "idempotency-key": key },
        payload: {},
      });
      expect(prepared.statusCode).toBe(202);
    }
    await qualityWorker.start();
    const missingView = await waitForSourceAsset(api, missing.assetId, "failed");
    expect(missingView.quality).toMatchObject({ status: "failed", reasons: ["stored_bytes_missing"] });
    const lowView = await waitForSourceAsset(api, low.assetId, "needs_confirmation");
    expect(lowView.quality).toMatchObject({ status: "needs_confirmation", reasons: ["low_resolution"], width: 320, height: 240 });
  }, 35_000);

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
    const [evidence] = await database.db
      .select()
      .from(learningEvidenceEvents)
      .where(eq(learningEvidenceEvents.caseId, caseId));
    expect(evidence?.sourceType).toBe("fake_ocr");
    expect(evidence?.sourceRef).toBe("asset-synthetic-paper-1");
    expect((evidence?.payload as Record<string, unknown>).toolVersion).toBe(
      "fake-parse-paper-v1",
    );
  }, 15_000);

  it("rejects non-demo Cases before fake OCR is enqueued", async () => {
    const fixtures = [
      { name: "synthetic-only", simulation: false, synthetic: true },
      { name: "simulation-only", simulation: true, synthetic: false },
      { name: "ordinary", simulation: false, synthetic: false },
    ] as const;

    for (const fixture of fixtures) {
      const tenantId = uuidv7();
      const studentId = uuidv7();
      const caseId = uuidv7();
      await database.db.insert(students).values({
        id: studentId,
        tenantId,
        anonymousKey: `fake-ocr-guard:${fixture.name}:${caseId}`,
      });
      await database.db.insert(cases).values({
        id: caseId,
        tenantId,
        studentId,
        simulation: fixture.simulation,
        synthetic: fixture.synthetic,
      });

      const response = await api.inject({
        method: "POST",
        url: `/v1/cases/${caseId}/commands/run-next`,
        headers: { "idempotency-key": `fake-ocr-guard:${fixture.name}` },
        payload: { expectedVersion: 0 },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json<ApiErrorResponse>().error.code).toBe(
        "DEMO_CASE_REQUIRED",
      );

      const [unchanged] = await database.db
        .select()
        .from(cases)
        .where(eq(cases.id, caseId));
      expect(unchanged?.state).toBe("awaiting_evidence");
      expect(unchanged?.stateVersion).toBe(0);
      const evidence = await database.db
        .select()
        .from(learningEvidenceEvents)
        .where(eq(learningEvidenceEvents.caseId, caseId));
      expect(evidence).toHaveLength(0);
    }
  });

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

    const invalidItem = await api.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/extraction/confirm`,
      headers: { "idempotency-key": "confirm-extraction-invalid-item-v1" },
      payload: {
        expectedVersion: 1,
        confirmedItemIds: ["item-not-in-extraction"],
        corrections: [],
      },
    });
    expect(invalidItem.statusCode).toBe(400);
    expect(invalidItem.json<ApiErrorResponse>().error.code).toBe("INVALID_INPUT");

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

  it("uses confirmed real OCR evidence for diagnosis without falling back to the Mina fixture", async () => {
    const tenantId = uuidv7();
    const studentId = uuidv7();
    const caseId = uuidv7();
    const occurredAt = new Date(fixedNow);
    await database.db.insert(students).values({ id: studentId, tenantId, anonymousKey: `real-diagnosis-${studentId}` });
    await database.db.insert(cases).values({
      id: caseId,
      tenantId,
      studentId,
      state: "ready_for_diagnosis",
      stateVersion: 2,
      title: "已确认学习材料",
      simulation: false,
      synthetic: false,
    });
    await database.db.insert(learningEvidenceEvents).values([
      {
        id: uuidv7(), tenantId, studentId, caseId,
        eventType: "evidence_ingested", sourceType: "real_alibaba_ocr", sourceRef: "integration-real-batch",
        payload: { extraction: { items: [{ itemId: "real-item-1", prompt: "原识别题干" }] }, recognitionSource: "real_alibaba", uploadedAssetUsedForRecognition: true },
        confidence: null, occurredAt, idempotencyKey: `real-evidence:${caseId}`,
      },
      {
        id: uuidv7(), tenantId, studentId, caseId,
        eventType: "recognition_confirmed", sourceType: "student_confirmation", sourceRef: null,
        payload: { confirmedItemIds: ["real-item-1"], corrections: [{ itemId: "real-item-1", field: "prompt", value: "学生确认后的真实题干" }] },
        confidence: null, occurredAt, idempotencyKey: `real-confirmation:${caseId}`,
      },
    ]);

    const queued = await api.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/commands/run-next`,
      headers: { "idempotency-key": `real-diagnosis-run:${caseId}` },
      payload: { expectedVersion: 2 },
    });
    expect(queued.statusCode).toBe(202);
    const caseView = await waitForState(api, caseId, "probe_required");
    expect(caseView).toMatchObject({ synthetic: false, simulation: false, stateVersion: 3 });

    const hypothesesResponse = await api.inject({ method: "GET", url: `/v1/cases/${caseId}/hypotheses` });
    expect(hypothesesResponse.statusCode).toBe(200);
    const hypotheses = hypothesesResponse.json<ApiResponse<HypothesesView>>();
    expect(JSON.stringify(hypotheses.data)).not.toMatch(/Mina|saving water|学生确认后的真实题干/);
    const events = await database.db.select().from(learningEvidenceEvents).where(eq(learningEvidenceEvents.caseId, caseId));
    const generated = events.find((event) => event.eventType === "hypotheses_generated");
    expect(generated?.sourceType).toBe("deepseek_diagnosis");
    expect(JSON.stringify(generated?.payload)).not.toMatch(/Mina|saving water|学生确认后的真实题干|integration-fixture/);

    const probe = await api.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/attempts`,
      headers: { "idempotency-key": `real-probe:${caseId}` },
      payload: { expectedVersion: 3, probeId: hypotheses.data.probe.id, selectedChoiceId: hypotheses.data.probe.choices[0]!.id },
    });
    expect(probe.statusCode).toBe(200);
    expect(probe.json<ApiResponse<AttemptView>>().data).toMatchObject({ state: "intervention_ready", stateVersion: 4, selectedHypothesisId: "real-hypothesis-1" });

    const interventionQueued = await api.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/commands/run-next`,
      headers: { "idempotency-key": `real-intervention:${caseId}` },
      payload: { expectedVersion: 4 },
    });
    expect(interventionQueued.statusCode).toBe(202);
    await waitForState(api, caseId, "intervention_active");
    const [guided] = await database.db.select().from(tasks).where(eq(tasks.caseId, caseId));
    expect(guided).toMatchObject({ taskType: "guided_intervention", status: "ready" });
    expect(guided?.payload).toMatchObject({
      contentSource: "confirmed_real_material",
      knowledgeTarget: "have 或 has 后使用过去分词",
      retests: {
        d1: { prompt: "She has ___ the letter.", expectedChoiceId: "d1-choice-3" },
        d7: { prompt: "We have ___ our notes.", expectedChoiceId: "d7-choice-2" },
      },
    });
    expect(JSON.stringify(guided?.payload)).not.toMatch(/Mina|volunteers|saving water/);
    const interventionEvents = await database.db.select().from(learningEvidenceEvents).where(eq(learningEvidenceEvents.caseId, caseId));
    expect(interventionEvents.find(event => event.eventType === "intervention_generated")?.sourceType).toBe("deepseek_intervention");

    const steps = (guided?.payload.steps as Array<{ id: string }>).map(step => step.id);
    const completed = await api.inject({
      method: "POST",
      url: `/v1/tasks/${guided!.id}/submit`,
      headers: { "idempotency-key": `real-complete:${caseId}` },
      payload: { expectedVersion: 5, completedStepIds: steps },
    });
    expect(completed.statusCode).toBe(200);
    const d1 = completed.json<ApiResponse<TaskCompletionView>>().data.scheduledRetest;
    expect(d1.item).toMatchObject({ prompt: "She has ___ the letter." });
    expect(d1.item).not.toHaveProperty("expectedChoiceId");
    await activateDueRetestTask(database.db, { caseId, taskId: d1.id, effectiveNow: new Date(d1.scheduledFor) });
    const d1Attempt = await api.inject({
      method: "POST",
      url: `/v1/tasks/${d1.id}/attempts`,
      headers: { "idempotency-key": `real-d1:${caseId}` },
      payload: { expectedVersion: 6, itemId: d1.item.id, selectedChoiceId: "d1-choice-3" },
    });
    expect(d1Attempt.statusCode).toBe(200);
    const d7 = d1Attempt.json<ApiResponse<D1RetestAttemptView>>().data.scheduledRetest;
    if (d7 === null) throw new Error("Expected content-bound D7 retest.");
    expect(d7.item).toMatchObject({ prompt: "We have ___ our notes." });
    await activateDueRetestTask(database.db, { caseId, taskId: d7.id, effectiveNow: new Date(d7.scheduledFor) });
    const d7Attempt = await api.inject({
      method: "POST",
      url: `/v1/tasks/${d7.id}/attempts`,
      headers: { "idempotency-key": `real-d7:${caseId}` },
      payload: { expectedVersion: 7, itemId: d7.item.id, selectedChoiceId: "d7-choice-2" },
    });
    expect(d7Attempt.statusCode).toBe(200);
    expect(d7Attempt.json<ApiResponse<D7RetestAttemptView>>().data).toMatchObject({ state: "repair_verified", stateVersion: 8, passed: true });
    const reports = await api.inject({ method: "GET", url: `/v1/students/${studentId}/reports` });
    expect(reports.statusCode).toBe(200);
    expect(reports.json<ApiResponse<StudentFactReportsView>>().data.reports).toEqual([
      expect.objectContaining({ caseId, source: "real_material", conclusion: "repair_verified", d1Result: "passed", d7Result: "passed" }),
    ]);
  }, 30_000);

  it("fails closed when a real guided task has no private D1 and D7 plan", async () => {
    const tenantId = uuidv7();
    const studentId = uuidv7();
    const caseId = uuidv7();
    const sourceEventId = uuidv7();
    const taskId = uuidv7();
    const occurredAt = new Date(fixedNow);
    const steps = [
      { id: "real-step-1", kind: "explain", title: "回想规则", content: "先说明这道题考查的规则。" },
      { id: "real-step-2", kind: "worked_example", title: "看新例子", content: "用一个新句子检查规则。" },
      { id: "real-step-3", kind: "guided_practice", title: "自己判断", content: "完成一道同知识点练习。" },
    ];
    await database.db.insert(students).values({ id: studentId, tenantId, anonymousKey: `real-missing-retests-${studentId}` });
    await database.db.insert(cases).values({
      id: caseId, tenantId, studentId, state: "intervention_active", stateVersion: 5,
      title: "真实材料干预", simulation: false, synthetic: false,
    });
    await database.db.insert(learningEvidenceEvents).values({
      id: sourceEventId, tenantId, studentId, caseId,
      eventType: "intervention_generated", sourceType: "deepseek_intervention", sourceRef: "test-real-provider",
      payload: { taskId, contentSource: "confirmed_real_material", knowledgeTarget: "现在完成时过去分词" },
      confidence: null, occurredAt, idempotencyKey: `real-missing-retests-event:${caseId}`,
    });
    await database.db.insert(tasks).values({
      id: taskId, tenantId, studentId, caseId, taskType: "guided_intervention", status: "ready",
      title: "检查现在完成时", estimatedMinutes: 8, scheduledFor: occurredAt,
      payload: {
        rationale: "根据学生确认的真实题目安排练习。",
        contentSource: "confirmed_real_material",
        knowledgeTarget: "现在完成时过去分词",
        contentBasisEventId: sourceEventId,
        steps,
      },
      sourceEventId,
    });

    const response = await api.inject({
      method: "POST",
      url: `/v1/tasks/${taskId}/submit`,
      headers: { "idempotency-key": `real-missing-retests-submit:${caseId}` },
      payload: { expectedVersion: 5, completedStepIds: steps.map(({ id }) => id) },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<ApiErrorResponse>().error.code).toBe("REAL_LEARNING_CONTENT_REQUIRED");
    const [caseAfter] = await database.db.select().from(cases).where(eq(cases.id, caseId));
    const tasksAfter = await database.db.select().from(tasks).where(eq(tasks.caseId, caseId));
    const eventsAfter = await database.db.select().from(learningEvidenceEvents).where(eq(learningEvidenceEvents.caseId, caseId));
    expect(caseAfter).toMatchObject({ state: "intervention_active", stateVersion: 5 });
    expect(tasksAfter).toHaveLength(1);
    expect(tasksAfter[0]).toMatchObject({ id: taskId, status: "ready" });
    expect(eventsAfter.filter(({ eventType }) => eventType === "intervention_completed")).toHaveLength(0);
  });

  it("persists bounded manual question splits when confirming a real OCR page", async () => {
    const tenantId = uuidv7();
    const studentId = uuidv7();
    const caseId = uuidv7();
    const occurredAt = new Date("2026-08-15T00:30:00.000Z");
    await database.db.insert(students).values({ id: studentId, tenantId, anonymousKey: `split-review-${studentId}`, timezone: "Asia/Shanghai" });
    await database.db.insert(cases).values({
      id: caseId, tenantId, studentId, state: "awaiting_confirmation", stateVersion: 1,
      title: "英语练习", simulation: false, synthetic: false,
    });
    await database.db.insert(learningEvidenceEvents).values({
      id: uuidv7(), tenantId, studentId, caseId,
      eventType: "evidence_ingested", sourceType: "real_alibaba_ocr", sourceRef: "private-source",
      payload: { extraction: { items: [{ itemId: "page-1", prompt: "整页识别文字" }] }, recognitionSource: "real_alibaba", uploadedAssetUsedForRecognition: true },
      confidence: null, occurredAt, idempotencyKey: `split-extraction:${caseId}`,
    });

    const missingSplits = await api.inject({
      method: "POST", url: `/v1/cases/${caseId}/extraction/confirm`,
      headers: { "idempotency-key": `split-confirm-missing:${caseId}` },
      payload: { expectedVersion: 1, confirmedItemIds: ["page-1"], corrections: [] },
    });
    expect(missingSplits.statusCode).toBe(400);
    expect(missingSplits.json<ApiErrorResponse>().error.code).toBe("INVALID_INPUT");

    const confirmation = await api.inject({
      method: "POST", url: `/v1/cases/${caseId}/extraction/confirm`,
      headers: { "idempotency-key": `split-confirm:${caseId}` },
      payload: {
        expectedVersion: 1,
        confirmedItemIds: ["page-1"],
        corrections: [],
        reviewedQuestions: [
          { sourceItemId: "page-1", prompt: "第一道题", studentAnswer: "A" },
          { sourceItemId: "page-1", prompt: "第二道题", studentAnswer: null },
        ],
      },
    });
    expect(confirmation.statusCode).toBe(200);
    expect(confirmation.json<ApiResponse<CaseView>>().data).toMatchObject({ state: "ready_for_diagnosis", stateVersion: 2 });

    const archive = await api.inject({ method: "GET", url: `/v1/students/${studentId}/question-archive` });
    expect(archive.statusCode).toBe(200);
    expect(archive.json<ApiResponse<QuestionArchiveView>>().data.items).toMatchObject([
      { prompt: "第一道题", studentAnswer: "A" },
      { prompt: "第二道题", studentAnswer: null },
    ]);
    expect(JSON.stringify(archive.json())).not.toMatch(/private-source|page-1|answerKey|confidence|objectKey|sha256|token/i);
  });

  it("projects only human-confirmed real OCR items into the question archive", async () => {
    const tenantId = uuidv7();
    const studentId = uuidv7();
    const caseId = uuidv7();
    const extractionEventId = uuidv7();
    const confirmationEventId = uuidv7();
    const taskId = uuidv7();
    const occurredAt = new Date("2026-08-15T01:00:00.000Z");
    await database.db.insert(students).values({ id: studentId, tenantId, anonymousKey: `question-archive-${studentId}`, timezone: "Asia/Shanghai" });
    await database.db.insert(cases).values({ id: caseId, tenantId, studentId, state: "d1_scheduled", stateVersion: 6, title: "英语周练", simulation: false, synthetic: false });
    await database.db.insert(learningEvidenceEvents).values([
      {
        id: extractionEventId, tenantId, studentId, caseId,
        eventType: "evidence_ingested", sourceType: "real_alibaba_ocr", sourceRef: "private-batch-reference",
        payload: { extraction: { items: [{ itemId: "confirmed-item", prompt: "OCR 题干" }, { itemId: "not-confirmed", prompt: "不能展示" }] }, confidence: 0.9987, objectKey: "private/object/key" },
        confidence: "0.9987", occurredAt, idempotencyKey: `archive-extraction:${caseId}`,
      },
      {
        id: confirmationEventId, tenantId, studentId, caseId,
        eventType: "recognition_confirmed", sourceType: "student_confirmation", sourceRef: null,
        payload: { confirmedItemIds: ["confirmed-item"], corrections: [{ itemId: "confirmed-item", field: "prompt", value: "学生核对后的题干" }, { itemId: "confirmed-item", field: "student_answer", value: "学生当时的答案" }] },
        confidence: null, occurredAt: new Date("2026-08-15T01:01:00.000Z"), idempotencyKey: `archive-confirmation:${caseId}`,
      },
    ]);
    await database.db.insert(tasks).values({
      id: taskId, tenantId, studentId, caseId, taskType: "d1_retest", status: "ready", title: "明日复习",
      estimatedMinutes: 4, scheduledFor: occurredAt, dueAt: null, sourceEventId: confirmationEventId,
      payload: { rationale: "检查是否能在新题中应用", item: { id: "retest-item", prompt: "A new question", choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }], expectedChoiceId: "a", scoringMethod: "exact-choice-v1" } },
    });

    const response = await api.inject({ method: "GET", url: `/v1/students/${studentId}/question-archive` });
    expect(response.statusCode).toBe(200);
    const body = response.json<ApiResponse<QuestionArchiveView>>();
    expect(body.data).toMatchObject({
      timeZone: "Asia/Shanghai",
      items: [{ source: "real_uploaded_material", sourceTitle: "英语周练", prompt: "学生核对后的题干", studentAnswer: "学生当时的答案", tasks: [{ taskId, status: "ready", taskType: "d1_retest" }] }],
    });
    expect(JSON.stringify(body.data)).not.toMatch(/不能展示|private\/object\/key|private-batch-reference|expectedChoiceId|0\.9987|confidence|objectKey|sha256|token/i);
  });

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
    expect(requireGuidedTask(body.data.tasks[0]).steps).toHaveLength(3);
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
    const task = requireGuidedTask(
      today.json<ApiResponse<TodayTasksView>>().data.tasks[0],
    );
    const request = {
      method: "POST" as const,
      url: `/v1/tasks/${task.id}/submit`,
      headers: { "idempotency-key": "complete-intervention-v1" },
      payload: {
        expectedVersion: 5,
        completedStepIds: task.steps.map(({ id }) => id),
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
    const dueJob = await queue.boss.getJobById<{
      caseId: string;
      taskId: string;
    }>(RETEST_DUE_QUEUE, body.data.scheduledRetest.id);
    expect(dueJob?.data).toEqual({
      caseId,
      taskId: body.data.scheduledRetest.id,
    });
    expect(dueJob?.startAfter.toISOString()).toBe(
      body.data.scheduledRetest.scheduledFor,
    );
  }, 15_000);

  it("returns a factual Today overview with local activity, progress, and next check", async () => {
    const prepared = await createD1ScheduledCase(api, "today-overview-v1");
    // Confirmation/probe routes use wall-clock timestamps while completion uses the injected clock.
    // Normalize this fixture explicitly so the assertion exercises the repository's
    // occurredAt DESC, eventId DESC ordering rather than the host clock.
    const progressEvents = await database.db
      .select({ id: learningEvidenceEvents.id, eventType: learningEvidenceEvents.eventType })
      .from(learningEvidenceEvents)
      .where(eq(learningEvidenceEvents.caseId, prepared.caseId));
    const occurredAtByType = {
      recognition_confirmed: new Date("2026-08-14T23:58:00.000Z"),
      probe_evaluated: new Date("2026-08-14T23:59:00.000Z"),
      intervention_completed: new Date("2026-08-15T00:00:00.000Z"),
    } as const;
    for (const event of progressEvents) {
      const occurredAt = occurredAtByType[event.eventType as keyof typeof occurredAtByType];
      if (occurredAt !== undefined) {
        await database.db
          .update(learningEvidenceEvents)
          .set({ occurredAt })
          .where(eq(learningEvidenceEvents.id, event.id));
      }
    }
    const today = await api.inject({
      method: "GET",
      url: `/v1/students/${prepared.studentId}/today`,
    });
    const todayBody = today.json<ApiResponse<TodayTasksView>>();
    const overview = todayBody.data.overview;

    expect(today.statusCode).toBe(200);
    expect(overview).toBeDefined();
    expect(overview?.activityDays).toHaveLength(7);
    expect(overview?.activityDays.at(-1)).toMatchObject({
      localDate: "2026-08-15",
      completedTaskCount: 1,
    });
    expect(overview?.weeklyGoal).toBeNull();
    expect(overview?.pendingConfirmationCount).toBe(0);
    expect(overview?.recentProgress).toHaveLength(2);
    expect(overview?.recentProgress.map(({ kind }) => kind)).toEqual([
      "practice_completed",
      "diagnosis_checked",
    ]);
    expect(overview?.nextCheck).toMatchObject({
      taskType: "d1_retest",
      scheduledFor: "2026-08-16T00:00:00.000Z",
    });
    expect(JSON.stringify(overview)).not.toContain("expectedChoiceId");
    expect(JSON.stringify(overview)).not.toContain("selectedChoiceId");

    await database.db
      .update(students)
      .set({ timezone: "America/Los_Angeles" })
      .where(eq(students.id, prepared.studentId));
    const localToday = await api.inject({
      method: "GET",
      url: `/v1/students/${prepared.studentId}/today`,
    });
    const localOverview = localToday.json<ApiResponse<TodayTasksView>>().data.overview;
    expect(localOverview?.activityDays.at(-1)).toMatchObject({
      localDate: "2026-08-14",
      completedTaskCount: 1,
    });

    const pendingCase = await api.inject({
      method: "POST",
      url: "/v1/cases",
      headers: { "idempotency-key": "today-overview-pending-v1" },
      payload: { entry: "synthetic_demo" },
    });
    const pendingCaseView = pendingCase.json<ApiResponse<CaseView>>().data;
    await api.inject({
      method: "POST",
      url: `/v1/cases/${pendingCaseView.id}/commands/run-next`,
      headers: { "idempotency-key": "today-overview-pending-ocr-v1" },
      payload: { expectedVersion: 0 },
    });
    await waitForState(api, pendingCaseView.id, "awaiting_confirmation");
    const pendingToday = await api.inject({
      method: "GET",
      url: `/v1/students/${pendingCaseView.studentId}/today`,
    });
    expect(
      pendingToday.json<ApiResponse<TodayTasksView>>().data.overview
        ?.pendingConfirmationCount,
    ).toBe(1);
    expect(
      todayBody.data.overview?.pendingConfirmationCount,
    ).toBe(0);
  }, 20_000);

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
    const task = requireGuidedTask(
      today.json<ApiResponse<TodayTasksView>>().data.tasks[0],
    );

    const stale = await api.inject({
      method: "POST",
      url: `/v1/tasks/${task.id}/submit`,
      headers: { "idempotency-key": "complete-intervention-stale-v1" },
      payload: {
        expectedVersion: 4,
        completedStepIds: task.steps.map(({ id }) => id),
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<ApiErrorResponse>().error.code).toBe("VERSION_CONFLICT");

    const incomplete = await api.inject({
      method: "POST",
      url: `/v1/tasks/${task.id}/submit`,
      headers: { "idempotency-key": "complete-intervention-incomplete-v1" },
      payload: { expectedVersion: 5, completedStepIds: [task.steps[0]?.id] },
    });
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json<ApiErrorResponse>().error.code).toBe("INVALID_INPUT");

    const request = {
      method: "POST" as const,
      url: `/v1/tasks/${task.id}/submit`,
      headers: { "idempotency-key": "complete-intervention-concurrent-v1" },
      payload: {
        expectedVersion: 5,
        completedStepIds: task.steps.map(({ id }) => id),
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

  it("keeps a D+1 task scheduled before due and activates it exactly at due", async () => {
    const prepared = await createD1ScheduledCase(api, "demo-clock-boundary-v1");
    const clockId = "0198b111-1111-7000-8000-000000000001";

    const beforeDue = await api.inject({
      method: "POST",
      url: "/v1/demo/clock/advance",
      headers: { "idempotency-key": "demo-clock-before-due-v1" },
      payload: {
        caseId: prepared.caseId,
        clockId,
        expectedClockVersion: 0,
        advanceBySeconds: 24 * 60 * 60 - 1,
      },
    });
    expect(beforeDue.statusCode).toBe(200);
    expect(beforeDue.json<ApiResponse<DemoClockAdvanceView>>().data).toMatchObject({
      caseId: prepared.caseId,
      clockId,
      clockVersion: 1,
      previousEffectiveNow: fixedNow,
      effectiveNow: "2026-08-15T23:59:59.000Z",
      activatedTaskIds: [],
    });

    const atDue = await api.inject({
      method: "POST",
      url: "/v1/demo/clock/advance",
      headers: { "idempotency-key": "demo-clock-at-due-v1" },
      payload: {
        caseId: prepared.caseId,
        clockId,
        expectedClockVersion: 1,
        advanceBySeconds: 1,
      },
    });
    const activation = atDue.json<ApiResponse<DemoClockAdvanceView>>().data;
    expect(atDue.statusCode).toBe(200);
    expect(activation.activatedTaskIds).toEqual([
      prepared.completion.scheduledRetest.id,
    ]);

    const today = await api.inject({
      method: "GET",
      url: `/v1/students/${prepared.studentId}/today`,
    });
    const retest = today
      .json<ApiResponse<TodayTasksView>>()
      .data.tasks.find(({ taskType }) => taskType === "d1_retest");
    expect(retest?.status).toBe("ready");
    expect(retest).not.toHaveProperty("simulation");
    expect(retest).not.toHaveProperty("clockId");

    const caseAfter = await api.inject({
      method: "GET",
      url: `/v1/cases/${prepared.caseId}`,
    });
    expect(caseAfter.json<ApiResponse<CaseView>>().data).toMatchObject({
      state: "d1_scheduled",
      stateVersion: 6,
    });
  }, 20_000);

  it("activates an overdue task without affecting another Case or clock", async () => {
    const left = await createD1ScheduledCase(api, "demo-clock-isolation-left-v1");
    const right = await createD1ScheduledCase(api, "demo-clock-isolation-right-v1");
    const rightRetestId = right.completion.scheduledRetest.id;
    // Keep the control task outside the real due worker's clock so this test
    // isolates the scoped demo-clock write instead of racing background work.
    await database.db
      .update(tasks)
      .set({ scheduledFor: new Date("2099-01-01T00:00:00.000Z") })
      .where(eq(tasks.id, rightRetestId));
    const response = await api.inject({
      method: "POST",
      url: "/v1/demo/clock/advance",
      headers: { "idempotency-key": "demo-clock-isolation-v1" },
      payload: {
        caseId: left.caseId,
        clockId: "0198b111-1111-7000-8000-000000000002",
        expectedClockVersion: 0,
        advanceBySeconds: 24 * 60 * 60 + 1,
      },
    });
    expect(response.statusCode).toBe(200);

    const [leftTasks, rightTasks] = await Promise.all([
      database.db.select().from(tasks).where(eq(tasks.caseId, left.caseId)),
      database.db.select().from(tasks).where(eq(tasks.caseId, right.caseId)),
    ]);
    expect(leftTasks.find(({ taskType }) => taskType === "d1_retest")?.status).toBe("ready");
    expect(rightTasks.find(({ taskType }) => taskType === "d1_retest")?.status).toBe("scheduled");
    const rightClocks = await database.db
      .select()
      .from(demoClocks)
      .where(eq(demoClocks.caseId, right.caseId));
    expect(rightClocks).toHaveLength(0);
  }, 30_000);

  it("replays sequential and concurrent advances once with stable audit data", async () => {
    const prepared = await createD1ScheduledCase(api, "demo-clock-replay-v1");
    const clockId = "0198b111-1111-7000-8000-000000000003";
    const request = {
      method: "POST" as const,
      url: "/v1/demo/clock/advance",
      headers: { "idempotency-key": "demo-clock-concurrent-v1" },
      payload: {
        caseId: prepared.caseId,
        clockId,
        expectedClockVersion: 0,
        advanceBySeconds: 24 * 60 * 60,
      },
    };
    const [left, right] = await Promise.all([api.inject(request), api.inject(request)]);
    const replay = await api.inject(request);
    expect(left.statusCode).toBe(200);
    expect(right.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(right.json<ApiResponse<DemoClockAdvanceView>>().data).toEqual(
      left.json<ApiResponse<DemoClockAdvanceView>>().data,
    );
    expect(replay.json<ApiResponse<DemoClockAdvanceView>>().data).toEqual(
      left.json<ApiResponse<DemoClockAdvanceView>>().data,
    );

    const [clock] = await database.db
      .select()
      .from(demoClocks)
      .where(eq(demoClocks.caseId, prepared.caseId));
    expect(clock).toMatchObject({ id: clockId, clockVersion: 1 });
    const events = await database.db
      .select()
      .from(learningEvidenceEvents)
      .where(eq(learningEvidenceEvents.caseId, prepared.caseId));
    const audits = events.filter(({ eventType }) => eventType === "demo_clock_advanced");
    expect(audits).toHaveLength(1);
    expect(audits[0]?.payload).toMatchObject({
      request: request.payload,
      result: left.json<ApiResponse<DemoClockAdvanceView>>().data,
      audit: {
        simulation: true,
        clockId,
        previousEffectiveNow: fixedNow,
        effectiveNow: "2026-08-16T00:00:00.000Z",
        activatedTaskIds: [prepared.completion.scheduledRetest.id],
      },
    });
  }, 20_000);

  it("lets only one distinct concurrent advance win the same clock version", async () => {
    const prepared = await createD1ScheduledCase(api, "demo-clock-race-v1");
    const payload = {
      caseId: prepared.caseId,
      clockId: "0198b111-1111-7000-8000-000000000009",
      expectedClockVersion: 0,
      advanceBySeconds: 24 * 60 * 60,
    };
    const [left, right] = await Promise.all([
      api.inject({
        method: "POST",
        url: "/v1/demo/clock/advance",
        headers: { "idempotency-key": "demo-clock-race-left-v1" },
        payload,
      }),
      api.inject({
        method: "POST",
        url: "/v1/demo/clock/advance",
        headers: { "idempotency-key": "demo-clock-race-right-v1" },
        payload,
      }),
    ]);
    expect([left.statusCode, right.statusCode].sort()).toEqual([200, 409]);
    const rejected = left.statusCode === 409 ? left : right;
    expect(rejected.json<ApiErrorResponse>().error).toMatchObject({
      code: "VERSION_CONFLICT",
      details: { resource: "demo_clock", expected: 0, actual: 1 },
    });

    const storedTasks = await database.db
      .select()
      .from(tasks)
      .where(eq(tasks.caseId, prepared.caseId));
    expect(storedTasks.filter(({ taskType, status }) =>
      taskType === "d1_retest" && status === "ready"
    )).toHaveLength(1);
    const events = await database.db
      .select()
      .from(learningEvidenceEvents)
      .where(eq(learningEvidenceEvents.caseId, prepared.caseId));
    expect(events.filter(({ eventType }) => eventType === "demo_clock_advanced")).toHaveLength(1);
  }, 20_000);

  it("rejects changed replays, stale clock versions, mismatched clocks, and invalid advances", async () => {
    const created = await api.inject({
      method: "POST",
      url: "/v1/cases",
      headers: { "idempotency-key": "demo-clock-errors-create-v1" },
      payload: { entry: "synthetic_demo" },
    });
    const caseId = created.json<ApiResponse<CaseView>>().data.id;
    const clockId = "0198b111-1111-7000-8000-000000000004";
    const first = {
      caseId,
      clockId,
      expectedClockVersion: 0,
      advanceBySeconds: 1,
    };
    expect((await api.inject({
      method: "POST",
      url: "/v1/demo/clock/advance",
      headers: { "idempotency-key": "demo-clock-errors-v1" },
      payload: first,
    })).statusCode).toBe(200);

    const changed = await api.inject({
      method: "POST",
      url: "/v1/demo/clock/advance",
      headers: { "idempotency-key": "demo-clock-errors-v1" },
      payload: { ...first, advanceBySeconds: 2 },
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json<ApiErrorResponse>().error.code).toBe("IDEMPOTENCY_KEY_REUSED");

    const stale = await api.inject({
      method: "POST",
      url: "/v1/demo/clock/advance",
      headers: { "idempotency-key": "demo-clock-stale-v1" },
      payload: first,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<ApiErrorResponse>().error).toMatchObject({
      code: "VERSION_CONFLICT",
      details: { resource: "demo_clock", expected: 0, actual: 1 },
    });

    const mismatch = await api.inject({
      method: "POST",
      url: "/v1/demo/clock/advance",
      headers: { "idempotency-key": "demo-clock-mismatch-v1" },
      payload: {
        ...first,
        clockId: "0198b111-1111-7000-8000-000000000005",
        expectedClockVersion: 1,
      },
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json<ApiErrorResponse>().error.code).toBe("DEMO_CLOCK_MISMATCH");

    for (const advanceBySeconds of [0, -1, 31 * 24 * 60 * 60 + 1]) {
      const invalid = await api.inject({
        method: "POST",
        url: "/v1/demo/clock/advance",
        headers: { "idempotency-key": `demo-clock-invalid-${advanceBySeconds}` },
        payload: { ...first, expectedClockVersion: 1, advanceBySeconds },
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json<ApiErrorResponse>().error.code).toBe("SCHEMA_INVALID");
    }
  });

  it("keeps the Demo route unavailable unless the environment-level switch is enabled", async () => {
    const disabledApi = await buildApi({
      database: database.db,
      queue,
      clock: new FixedClock(fixedNow),
      demoClockEnabled: false,
    });
    const response = await disabledApi.inject({
      method: "POST",
      url: "/v1/demo/clock/advance",
      headers: { "idempotency-key": "demo-clock-disabled-v1" },
      payload: {
        caseId: "0198b111-1111-7000-8000-000000000006",
        clockId: "0198b111-1111-7000-8000-000000000007",
        expectedClockVersion: 0,
        advanceBySeconds: 1,
      },
    });
    expect(response.statusCode).toBe(404);
    await disabledApi.close();
  });

  it("requires an idempotency key for Demo clock advances", async () => {
    const response = await api.inject({
      method: "POST",
      url: "/v1/demo/clock/advance",
      payload: {
        caseId: "0198b111-1111-7000-8000-000000000010",
        clockId: "0198b111-1111-7000-8000-000000000011",
        expectedClockVersion: 0,
        advanceBySeconds: 1,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorResponse>().error.code).toBe("INVALID_INPUT");
  });

  it("rejects a non-simulation Case even when the Demo route is enabled", async () => {
    const created = await api.inject({
      method: "POST",
      url: "/v1/cases",
      headers: { "idempotency-key": "demo-clock-real-case-create-v1" },
      payload: { entry: "synthetic_demo" },
    });
    const caseId = created.json<ApiResponse<CaseView>>().data.id;
    await database.db
      .update(cases)
      .set({ simulation: false })
      .where(eq(cases.id, caseId));

    const response = await api.inject({
      method: "POST",
      url: "/v1/demo/clock/advance",
      headers: { "idempotency-key": "demo-clock-real-case-v1" },
      payload: {
        caseId,
        clockId: "0198b111-1111-7000-8000-000000000012",
        expectedClockVersion: 0,
        advanceBySeconds: 1,
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<ApiErrorResponse>().error.code).toBe(
      "DEMO_CASE_REQUIRED",
    );
  });

  it("uses SystemClock when no test clock is injected", async () => {
    const systemApi = await buildApi({
      database: database.db,
      queue,
      demoClockEnabled: true,
    });
    const created = await systemApi.inject({
      method: "POST",
      url: "/v1/cases",
      headers: { "idempotency-key": "demo-clock-system-create-v1" },
      payload: { entry: "synthetic_demo" },
    });
    const caseId = created.json<ApiResponse<CaseView>>().data.id;
    const before = Date.now();
    const advanced = await systemApi.inject({
      method: "POST",
      url: "/v1/demo/clock/advance",
      headers: { "idempotency-key": "demo-clock-system-v1" },
      payload: {
        caseId,
        clockId: "0198b111-1111-7000-8000-000000000008",
        expectedClockVersion: 0,
        advanceBySeconds: 1,
      },
    });
    const after = Date.now();
    const body = advanced.json<ApiResponse<DemoClockAdvanceView>>().data;
    expect(Date.parse(body.previousEffectiveNow)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(body.previousEffectiveNow)).toBeLessThanOrEqual(after);
    expect(Date.parse(body.effectiveNow) - Date.parse(body.previousEffectiveNow)).toBe(1_000);
    await systemApi.close();
  });

  it("lets the retest.due Worker activate a due task with SystemClock", async () => {
    const prepared = await createD1ScheduledCase(api, "retest-due-worker-v1");
    const taskId = prepared.completion.scheduledRetest.id;
    const past = new Date(Date.now() - 1_000);
    await database.db
      .update(tasks)
      .set({ scheduledFor: past })
      .where(eq(tasks.id, taskId));
    await queue.boss.send(
      RETEST_DUE_QUEUE,
      { taskId, caseId: prepared.caseId },
      { startAfter: past },
    );

    const deadline = Date.now() + 8_000;
    let status: string | undefined;
    while (Date.now() < deadline) {
      const [row] = await database.db
        .select({ status: tasks.status })
        .from(tasks)
        .where(eq(tasks.id, taskId));
      status = row?.status;
      if (status === "ready") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(status).toBe("ready");
    const caseAfter = await api.inject({
      method: "GET",
      url: `/v1/cases/${prepared.caseId}`,
    });
    expect(caseAfter.json<ApiResponse<CaseView>>().data).toMatchObject({
      state: "d1_scheduled",
      stateVersion: 6,
    });
  }, 20_000);

  it("serializes concurrent retest.due activators without duplicate effects", async () => {
    const prepared = await createD1ScheduledCase(api, "retest-due-race-v1");
    const taskId = prepared.completion.scheduledRetest.id;
    const effectiveNow = new Date("2026-08-16T00:00:00.000Z");
    const early = await activateDueRetestTask(database.db, {
      caseId: prepared.caseId,
      taskId,
      effectiveNow: new Date(effectiveNow.getTime() - 1),
    });
    expect(early).toMatchObject({
      activated: false,
      reason: "not_due",
      taskId,
    });
    const input = { caseId: prepared.caseId, taskId, effectiveNow };
    const results = await Promise.all([
      activateDueRetestTask(database.db, input),
      activateDueRetestTask(database.db, input),
    ]);

    expect(results.map(({ activated }) => activated).sort()).toEqual([
      false,
      true,
    ]);
    const [task] = await database.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId));
    expect(task?.status).toBe("ready");
    const caseAfter = await api.inject({
      method: "GET",
      url: `/v1/cases/${prepared.caseId}`,
    });
    expect(caseAfter.json<ApiResponse<CaseView>>().data).toMatchObject({
      state: "d1_scheduled",
      stateVersion: 6,
    });
  }, 20_000);

  it("evaluates a ready D1 exactly once, redacts the answer, and schedules D7 at 144h + 12h", async () => {
    const prepared = await activatePreparedD1(api, database.db, "d1-pass-v1");
    const evaluatedAt = prepared.task.scheduledFor;
    const evaluationApi = await buildApi({
      database: database.db,
      queue,
      clock: new FixedClock(evaluatedAt),
    });
    const request = {
      method: "POST" as const,
      url: `/v1/tasks/${prepared.task.id}/attempts`,
      headers: { "idempotency-key": "d1-pass-attempt-v1" },
      payload: {
        expectedVersion: 6,
        itemId: prepared.task.item.id,
        selectedChoiceId: "choice-written",
      },
    };
    const [left, right] = await Promise.all([
      evaluationApi.inject(request),
      evaluationApi.inject(request),
    ]);
    const body = left.json<ApiResponse<D1RetestAttemptView>>();

    expect(left.statusCode).toBe(200);
    expect(right.statusCode).toBe(200);
    expect(right.json<ApiResponse<D1RetestAttemptView>>().data).toEqual(body.data);
    expect(body.data).toMatchObject({
      caseId: prepared.caseId,
      taskId: prepared.task.id,
      itemId: prepared.task.item.id,
      selectedChoiceId: "choice-written",
      passed: true,
      scoringMethod: "exact-choice-v1",
      state: "d7_scheduled",
      stateVersion: 7,
    });
    expect(body.data.completedTask.status).toBe("completed");
    expect(body.data.scheduledRetest?.status).toBe("scheduled");
    expect(
      Date.parse(body.data.scheduledRetest?.scheduledFor ?? "") -
        Date.parse(evaluatedAt),
    ).toBe(144 * 60 * 60 * 1_000);
    expect(
      Date.parse(body.data.scheduledRetest?.dueAt ?? "") -
        Date.parse(body.data.scheduledRetest?.scheduledFor ?? ""),
    ).toBe(12 * 60 * 60 * 1_000);
    expect(JSON.stringify(body)).not.toContain("expectedChoiceId");

    const today = await evaluationApi.inject({
      method: "GET",
      url: `/v1/students/${prepared.studentId}/today`,
    });
    const todayBody = today.json<ApiResponse<TodayTasksView>>();
    expect(todayBody.data.currentTaskId).toBeNull();
    expect(JSON.stringify(todayBody)).not.toContain("expectedChoiceId");

    const changedReplay = await evaluationApi.inject({
      ...request,
      payload: { ...request.payload, selectedChoiceId: "choice-wrote" },
    });
    expect(changedReplay.statusCode).toBe(409);
    expect(changedReplay.json<ApiErrorResponse>().error.code).toBe(
      "IDEMPOTENCY_KEY_REUSED",
    );

    const eventRows = await database.db
      .select()
      .from(learningEvidenceEvents)
      .where(eq(learningEvidenceEvents.caseId, prepared.caseId));
    expect(eventRows.filter(({ eventType }) => eventType === "retest_evaluated")).toHaveLength(1);
    expect(
      eventRows.find(({ eventType }) => eventType === "retest_evaluated")?.payload,
    ).toMatchObject({ kind: "d1", passed: true });
    const taskRows = await database.db
      .select()
      .from(tasks)
      .where(eq(tasks.caseId, prepared.caseId));
    expect(taskRows.filter(({ taskType }) => taskType === "d7_retest")).toHaveLength(1);
    const d7 = body.data.scheduledRetest;
    expect(d7).not.toBeNull();
    if (d7 !== null) {
      const dueJob = await queue.boss.getJobById(RETEST_DUE_QUEUE, d7.id);
      expect(dueJob?.startAfter.toISOString()).toBe(d7.scheduledFor);
      await activateDueRetestTask(database.db, {
        caseId: prepared.caseId,
        taskId: d7.id,
        effectiveNow: new Date(d7.scheduledFor),
      });
      const replayAfterActivation = await evaluationApi.inject(request);
      expect(
        replayAfterActivation.json<ApiResponse<D1RetestAttemptView>>().data,
      ).toEqual(body.data);
      expect(
        replayAfterActivation.json<ApiResponse<D1RetestAttemptView>>().data
          .scheduledRetest?.status,
      ).toBe("scheduled");
    }
    await evaluationApi.close();
  }, 25_000);

  it("evaluates a ready D7 exactly once, redacts the answer, and reaches repair_verified", async () => {
    const prepared = await activatePreparedD7(api, database.db, "d7-pass-v1");
    const request = {
      method: "POST" as const,
      url: `/v1/tasks/${prepared.d7.id}/attempts`,
      headers: { "idempotency-key": "d7-pass-attempt-v1" },
      payload: {
        expectedVersion: 7,
        itemId: prepared.d7.item.id,
        selectedChoiceId: "choice-written",
      },
    };
    const [left, right] = await Promise.all([
      api.inject(request),
      api.inject(request),
    ]);
    const body = left.json<ApiResponse<D7RetestAttemptView>>();
    expect(left.statusCode).toBe(200);
    expect(right.statusCode).toBe(200);
    expect(right.json<ApiResponse<D7RetestAttemptView>>().data).toEqual(body.data);
    expect(body.data).toMatchObject({
      passed: true,
      state: "repair_verified",
      stateVersion: 8,
      scheduledRetest: null,
    });
    expect(JSON.stringify(body)).not.toContain("expectedChoiceId");
    const changedReplay = await api.inject({
      ...request,
      payload: { ...request.payload, selectedChoiceId: "choice-wrote" },
    });
    expect(changedReplay.statusCode).toBe(409);
    expect(changedReplay.json<ApiErrorResponse>().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  }, 35_000);

  it("fails D7 into one replan job below the cap and support_required at the cap", async () => {
    const belowCap = await activatePreparedD7(api, database.db, "d7-fail-v1");
    const failed = await api.inject({
      method: "POST",
      url: `/v1/tasks/${belowCap.d7.id}/attempts`,
      headers: { "idempotency-key": "d7-fail-attempt-v1" },
      payload: {
        expectedVersion: 7,
        itemId: belowCap.d7.item.id,
        selectedChoiceId: "choice-wrote",
      },
    });
    const failedBody = failed.json<ApiResponse<D7RetestAttemptView>>();
    expect(failed.statusCode).toBe(200);
    expect(failedBody.data.state).toBe("replan_required");
    expect(failedBody.jobId).toBeTruthy();
    const queued = await queue.boss.getJobById(REPLAN_QUEUE, failedBody.jobId ?? "");
    expect(queued?.data).toMatchObject({ caseId: belowCap.caseId });

    const atCap = await activatePreparedD7(api, database.db, "d7-support-v1");
    await database.db.update(cases).set({ replanCount: 2 }).where(eq(cases.id, atCap.caseId));
    const supported = await api.inject({
      method: "POST",
      url: `/v1/tasks/${atCap.d7.id}/attempts`,
      headers: { "idempotency-key": "d7-support-attempt-v1" },
      payload: {
        expectedVersion: 7,
        itemId: atCap.d7.item.id,
        selectedChoiceId: "choice-wrote",
      },
    });
    const supportedBody = supported.json<ApiResponse<D7RetestAttemptView>>();
    expect(supported.statusCode).toBe(200);
    expect(supportedBody.data.state).toBe("support_required");
    expect(supportedBody.jobId).toBeUndefined();
  }, 45_000);

  it("keeps D1 legacy namespace replayable and caps D1 failures", async () => {
    const prepared = await activatePreparedD1(api, database.db, "d1-legacy-replay-v1");
    await database.db.update(cases).set({ replanCount: 2 }).where(eq(cases.id, prepared.caseId));
    const request = {
      method: "POST" as const,
      url: `/v1/tasks/${prepared.task.id}/attempts`,
      headers: { "idempotency-key": "legacy-d1-key-v1" },
      payload: {
        expectedVersion: 6,
        itemId: prepared.task.item.id,
        selectedChoiceId: "choice-wrote",
      },
    };
    const first = await api.inject(request);
    const replay = await api.inject(request);
    const firstBody = first.json<ApiResponse<D1RetestAttemptView>>();
    expect(first.statusCode).toBe(200);
    expect(firstBody.data.state).toBe("support_required");
    expect(firstBody.jobId).toBeUndefined();
    expect(replay.statusCode).toBe(200);
    expect(replay.json<ApiResponse<D1RetestAttemptView>>().data).toEqual(firstBody.data);
    const eventRows = await database.db.select().from(learningEvidenceEvents).where(eq(learningEvidenceEvents.caseId, prepared.caseId));
    expect(eventRows.filter(({ eventType }) => eventType === "retest_evaluated")).toHaveLength(1);
  }, 30_000);

  it("rejects D7 invalid choice and stale version without appending evidence", async () => {
    const prepared = await activatePreparedD7(api, database.db, "d7-validation-v1");
    const invalidChoice = await api.inject({
      method: "POST",
      url: `/v1/tasks/${prepared.d7.id}/attempts`,
      headers: { "idempotency-key": "d7-invalid-choice-v1" },
      payload: {
        expectedVersion: 7,
        itemId: prepared.d7.item.id,
        selectedChoiceId: "choice-injected",
      },
    });
    expect(invalidChoice.statusCode).toBe(400);
    expect(invalidChoice.json<ApiErrorResponse>().error.code).toBe("INVALID_INPUT");
    const stale = await api.inject({
      method: "POST",
      url: `/v1/tasks/${prepared.d7.id}/attempts`,
      headers: { "idempotency-key": "d7-stale-v1" },
      payload: {
        expectedVersion: 6,
        itemId: prepared.d7.item.id,
        selectedChoiceId: "choice-written",
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<ApiErrorResponse>().error.code).toBe("VERSION_CONFLICT");

    const events = await database.db.select().from(learningEvidenceEvents).where(eq(learningEvidenceEvents.caseId, prepared.caseId));
    expect(events.filter(({ eventType }) => eventType === "retest_evaluated")).toHaveLength(1);
  }, 35_000);

  it("rejects invalid D1 requests without partial writes", async () => {
    const scheduled = await createD1ScheduledCase(api, "d1-validation-v1");
    const scheduledTask = scheduled.completion.scheduledRetest;
    const scheduledResponse = await api.inject({
      method: "POST",
      url: `/v1/tasks/${scheduledTask.id}/attempts`,
      headers: { "idempotency-key": "d1-still-scheduled-v1" },
      payload: {
        expectedVersion: 6,
        itemId: scheduledTask.item.id,
        selectedChoiceId: "choice-written",
      },
    });
    expect(scheduledResponse.statusCode).toBe(409);
    expect(scheduledResponse.json<ApiErrorResponse>().error.code).toBe("INVALID_TASK_STATE");
    const scheduledToday = await api.inject({
      method: "GET",
      url: `/v1/students/${scheduled.studentId}/today`,
    });
    expect(
      scheduledToday.json<ApiResponse<TodayTasksView>>().data.currentTaskId,
    ).toBeNull();

    await activateDueRetestTask(database.db, {
      caseId: scheduled.caseId,
      taskId: scheduledTask.id,
      effectiveNow: new Date(scheduledTask.scheduledFor),
    });
    const readyToday = await api.inject({
      method: "GET",
      url: `/v1/students/${scheduled.studentId}/today`,
    });
    expect(
      readyToday.json<ApiResponse<TodayTasksView>>().data.currentTaskId,
    ).toBe(scheduledTask.id);
    const detail = await api.inject({
      method: "GET",
      url: `/v1/tasks/${scheduledTask.id}`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<ApiResponse<LearningTaskView>>().data).not.toHaveProperty("steps");
    expect(JSON.stringify(detail.json())).not.toContain("expectedChoiceId");
    const baseRequest = {
      method: "POST" as const,
      url: `/v1/tasks/${scheduledTask.id}/attempts`,
      headers: { "idempotency-key": "d1-validation-base-v1" },
      payload: {
        expectedVersion: 6,
        itemId: scheduledTask.item.id,
        selectedChoiceId: "choice-written",
      },
    };
    const casesToReject = [
      {
        request: { ...baseRequest, headers: {}, payload: baseRequest.payload },
        code: "INVALID_INPUT",
      },
      {
        request: {
          ...baseRequest,
          headers: { "idempotency-key": "d1-stale-v1" },
          payload: { ...baseRequest.payload, expectedVersion: 5 },
        },
        code: "VERSION_CONFLICT",
      },
      {
        request: {
          ...baseRequest,
          headers: { "idempotency-key": "d1-wrong-item-v1" },
          payload: { ...baseRequest.payload, itemId: "synthetic-wrong-item" },
        },
        code: "INVALID_INPUT",
      },
      {
        request: {
          ...baseRequest,
          headers: { "idempotency-key": "d1-wrong-choice-v1" },
          payload: { ...baseRequest.payload, selectedChoiceId: "choice-injected" },
        },
        code: "INVALID_INPUT",
      },
      {
        request: {
          ...baseRequest,
          headers: { "idempotency-key": "d1-schema-v1" },
          payload: { expectedVersion: 6, itemId: scheduledTask.item.id },
        },
        code: "SCHEMA_INVALID",
      },
    ];
    for (const { request, code } of casesToReject) {
      const response = await api.inject(request);
      expect(response.statusCode).toBe(code === "VERSION_CONFLICT" ? 409 : 400);
      expect(response.json<ApiErrorResponse>().error.code).toBe(code);
    }

    const missing = await api.inject({
      ...baseRequest,
      url: "/v1/tasks/0198a111-1111-7000-8000-999999999999/attempts",
      headers: { "idempotency-key": "d1-missing-task-v1" },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<ApiErrorResponse>().error.code).toBe("RESOURCE_NOT_FOUND");

    const guidedPrepared = await createInterventionReadyCase(api, "d1-guided-reject-v1");
    await api.inject({
      method: "POST",
      url: `/v1/cases/${guidedPrepared.caseId}/commands/run-next`,
      headers: { "idempotency-key": "d1-guided-generate-v1" },
      payload: { expectedVersion: 4 },
    });
    await waitForState(api, guidedPrepared.caseId, "intervention_active");
    const guidedToday = await api.inject({
      method: "GET",
      url: `/v1/students/${guidedPrepared.studentId}/today`,
    });
    const guided = requireGuidedTask(
      guidedToday.json<ApiResponse<TodayTasksView>>().data.tasks[0],
    );
    const nonD1 = await api.inject({
      ...baseRequest,
      url: `/v1/tasks/${guided.id}/attempts`,
      headers: { "idempotency-key": "d1-guided-reject-v1" },
      payload: { ...baseRequest.payload, expectedVersion: 5 },
    });
    expect(nonD1.statusCode).toBe(409);
    expect(nonD1.json<ApiErrorResponse>().error.code).toBe("INVALID_TASK_STATE");

    const caseAfter = await api.inject({
      method: "GET",
      url: `/v1/cases/${scheduled.caseId}`,
    });
    expect(caseAfter.json<ApiResponse<CaseView>>().data).toMatchObject({
      state: "d1_scheduled",
      stateVersion: 6,
    });
    const events = await database.db
      .select()
      .from(learningEvidenceEvents)
      .where(eq(learningEvidenceEvents.caseId, scheduled.caseId));
    expect(events.filter(({ eventType }) => eventType === "retest_evaluated")).toHaveLength(0);
  }, 30_000);

  it("queues failed D1 replan transactionally and the workers create one new intervention", async () => {
    const prepared = await activatePreparedD1(api, database.db, "d1-fail-v1");
    const evaluationApi = await buildApi({
      database: database.db,
      queue,
      clock: new FixedClock(prepared.task.scheduledFor),
    });
    const request = {
      method: "POST" as const,
      url: `/v1/tasks/${prepared.task.id}/attempts`,
      headers: { "idempotency-key": "d1-fail-attempt-v1" },
      payload: {
        expectedVersion: 6,
        itemId: prepared.task.item.id,
        selectedChoiceId: "choice-wrote",
      },
    };
    const failed = await evaluationApi.inject(request);
    const replay = await evaluationApi.inject(request);
    const body = failed.json<ApiResponse<D1RetestAttemptView>>();
    expect(failed.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.json<ApiResponse<D1RetestAttemptView>>().data).toEqual(body.data);
    expect(body.data).toMatchObject({
      passed: false,
      state: "replan_required",
      stateVersion: 7,
      scheduledRetest: null,
    });
    expect(body.jobId).toBeTruthy();

    const beforeWorker = await database.db
      .select()
      .from(tasks)
      .where(eq(tasks.caseId, prepared.caseId));
    expect(beforeWorker.filter(({ taskType }) => taskType === "guided_intervention")).toHaveLength(1);
    expect(beforeWorker.filter(({ taskType }) => taskType === "d7_retest")).toHaveLength(0);
    const replanJob = await queue.boss.getJobById(REPLAN_QUEUE, body.jobId ?? "");
    expect(replanJob?.data).toMatchObject({ caseId: prepared.caseId, expectedVersion: 7 });

    const replanWorker = createReplanWorker({
      database: database.db,
      queue,
      clock: new FixedClock(prepared.task.scheduledFor),
    });
    await replanWorker.start();
    const active = await waitForState(evaluationApi, prepared.caseId, "intervention_active");
    expect(active.stateVersion).toBe(9);

    const afterWorker = await database.db
      .select()
      .from(tasks)
      .where(eq(tasks.caseId, prepared.caseId));
    expect(afterWorker.filter(({ taskType }) => taskType === "guided_intervention")).toHaveLength(2);
    const events = await database.db
      .select()
      .from(learningEvidenceEvents)
      .where(eq(learningEvidenceEvents.caseId, prepared.caseId));
    expect(events.filter(({ eventType }) => eventType === "retest_evaluated")).toHaveLength(1);
    expect(events.filter(({ eventType }) => eventType === "plan_replanned")).toHaveLength(1);
    expect(events.filter(({ eventType }) => eventType === "intervention_generated")).toHaveLength(2);
    expect(events.find(({ eventType }) => eventType === "plan_replanned")?.payload).toMatchObject({
      replanIndex: 1,
      strategy: "alternate_explanation_and_practice",
    });
    const replannedTask = afterWorker.find(
      ({ taskType, payload }) => taskType === "guided_intervention" && payload.replanStrategy === "alternate_explanation_and_practice",
    );
    expect(replannedTask).toBeDefined();
    const secondToday = await evaluationApi.inject({
      method: "GET",
      url: `/v1/students/${prepared.studentId}/today`,
    });
    const secondIntervention = secondToday
      .json<ApiResponse<TodayTasksView>>()
      .data.tasks.find((task) => task.taskType === "guided_intervention" && task.status === "ready");
    expect(secondIntervention?.taskType).toBe("guided_intervention");
    if (secondIntervention?.taskType !== "guided_intervention") throw new Error("Expected second intervention.");
    const secondCompletionResponse = await evaluationApi.inject({
      method: "POST",
      url: `/v1/tasks/${secondIntervention.id}/submit`,
      headers: { "idempotency-key": "d1-fail-v1-second-complete" },
      payload: {
        expectedVersion: 9,
        completedStepIds: secondIntervention.steps.map(({ id }) => id),
      },
    });
    expect(secondCompletionResponse.statusCode).toBe(200);
    const secondCompletion = secondCompletionResponse.json<ApiResponse<TaskCompletionView>>().data;
    await activateDueRetestTask(database.db, {
      caseId: prepared.caseId,
      taskId: secondCompletion.scheduledRetest.id,
      effectiveNow: new Date(secondCompletion.scheduledRetest.scheduledFor),
    });
    const secondFailed = await evaluationApi.inject({
      method: "POST",
      url: `/v1/tasks/${secondCompletion.scheduledRetest.id}/attempts`,
      headers: { "idempotency-key": "d1-fail-v1-second-attempt" },
      payload: {
        expectedVersion: 10,
        itemId: secondCompletion.scheduledRetest.item.id,
        selectedChoiceId: "choice-wrote",
      },
    });
    const secondFailedBody = secondFailed.json<ApiResponse<D1RetestAttemptView>>();
    expect(secondFailedBody.data.state).toBe("replan_required");
    expect(secondFailedBody.jobId).toBeTruthy();
    await waitForState(evaluationApi, prepared.caseId, "intervention_active");
    await replanWorker.stop();
    const secondReplanEvents = await database.db
      .select()
      .from(learningEvidenceEvents)
      .where(eq(learningEvidenceEvents.caseId, prepared.caseId));
    expect(secondReplanEvents.find(({ eventType, payload }) => eventType === "plan_replanned" && payload.replanIndex === 2)?.payload).toMatchObject({
      replanIndex: 2,
      strategy: "prerequisite_skill_with_example",
    });
    const [countedCase] = await database.db.select().from(cases).where(eq(cases.id, prepared.caseId));
    expect(countedCase?.replanCount).toBe(2);
    await evaluationApi.close();
  }, 35_000);

  it("rolls back D1 state, event, task completion, and follow-up when enqueue fails", async () => {
    const prepared = await activatePreparedD1(api, database.db, "d1-rollback-v1");
    const [caseRow] = await database.db
      .select()
      .from(cases)
      .where(eq(cases.id, prepared.caseId));
    expect(caseRow).toBeDefined();
    const eventId = uuidv7();
    await expect(
      persistD1RetestEvaluation(database.db, {
        caseId: prepared.caseId,
        taskId: prepared.task.id,
        expectedVersion: 6,
        nextState: "replan_required",
        evaluatedAt: new Date(prepared.task.scheduledFor),
        event: {
          id: eventId,
          tenantId: caseRow?.tenantId ?? "",
          studentId: prepared.studentId,
          caseId: prepared.caseId,
          eventType: "retest_evaluated",
          sourceType: "synthetic_rollback_fixture",
          sourceRef: prepared.task.id,
          payload: { synthetic: true },
          occurredAt: new Date(prepared.task.scheduledFor),
          idempotencyKey: "d1-rollback-event-v1",
        },
        enqueueFollowUp: async () => {
          throw new Error("SYNTHETIC_ENQUEUE_FAILURE");
        },
      }),
    ).rejects.toThrow("SYNTHETIC_ENQUEUE_FAILURE");

    const [caseAfter] = await database.db
      .select()
      .from(cases)
      .where(eq(cases.id, prepared.caseId));
    const [taskAfter] = await database.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, prepared.task.id));
    const rolledBackEvents = await database.db
      .select()
      .from(learningEvidenceEvents)
      .where(eq(learningEvidenceEvents.id, eventId));
    expect(caseAfter).toMatchObject({ state: "d1_scheduled", stateVersion: 6 });
    expect(taskAfter).toMatchObject({ status: "ready", completedAt: null });
    expect(rolledBackEvents).toHaveLength(0);
  }, 20_000);

  it("selects currentTaskId with the frozen due/type/created/id ordering", async () => {
    const prepared = await createProbeRequiredCase(api, "current-task-order-v1");
    const currentViaToday = async () => {
      const response = await api.inject({
        method: "GET",
        url: `/v1/students/${prepared.studentId}/today`,
      });
      expect(response.statusCode).toBe(200);
      return response.json<ApiResponse<TodayTasksView>>().data.currentTaskId;
    };
    expect(await currentViaToday()).toBeNull();
    const sourceEvents = await database.db
      .select({ id: learningEvidenceEvents.id })
      .from(learningEvidenceEvents)
      .where(eq(learningEvidenceEvents.caseId, prepared.caseId));
    expect(sourceEvents.length).toBeGreaterThanOrEqual(3);
    const [caseRow] = await database.db
      .select({ tenantId: cases.tenantId })
      .from(cases)
      .where(eq(cases.id, prepared.caseId));
    expect(caseRow).toBeDefined();
    const common = {
      tenantId: caseRow?.tenantId ?? "",
      studentId: prepared.studentId,
      caseId: prepared.caseId,
      status: "ready" as const,
      title: "Synthetic actionable ordering fixture",
      estimatedMinutes: 5,
      scheduledFor: new Date("2026-08-15T00:00:00.000Z"),
      dueAt: new Date("2026-08-16T12:00:00.000Z"),
      createdAt: new Date("2026-08-15T00:00:00.000Z"),
    };
    const privateItem = {
      rationale: "Synthetic ordering fixture.",
      item: {
        id: "synthetic-ordering-item",
        prompt: "Choose the synthetic answer.",
        choices: [
          { id: "choice-a", label: "A" },
          { id: "choice-b", label: "B" },
        ],
        expectedChoiceId: "choice-b",
        scoringMethod: "exact-choice-v1",
      },
    };
    const d1LowId = "0198b111-1111-7000-8000-000000000101";
    const d1HighId = "0198b111-1111-7000-8000-000000000102";
    const d7Id = "0198b111-1111-7000-8000-000000000103";
    const guidedId = "0198b111-1111-7000-8000-000000000104";
    await database.db.insert(tasks).values({
      ...common,
      id: d7Id,
      taskType: "d7_retest",
      payload: privateItem,
      sourceEventId: sourceEvents[0]?.id ?? "",
    });
    expect(
      await findCurrentActionableTaskId(database.db, prepared.studentId),
    ).toBe(d7Id);
    expect(await currentViaToday()).toBe(d7Id);

    await database.db.insert(tasks).values({
      ...common,
      id: guidedId,
      taskType: "guided_intervention",
      payload: {
        rationale: "Synthetic ordering fixture.",
        steps: [{ id: "step-1", kind: "explain", title: "Explain", content: "Synthetic." }],
      },
      sourceEventId: sourceEvents[0]?.id ?? "",
    });
    expect(
      await findCurrentActionableTaskId(database.db, prepared.studentId),
    ).toBe(d7Id);
    expect(await currentViaToday()).toBe(d7Id);

    await database.db.insert(tasks).values([
      {
        ...common,
        id: d1HighId,
        taskType: "d1_retest",
        payload: privateItem,
        sourceEventId: sourceEvents[1]?.id ?? "",
      },
      {
        ...common,
        id: d1LowId,
        taskType: "d1_retest",
        payload: privateItem,
        sourceEventId: sourceEvents[0]?.id ?? "",
      },
    ]);
    expect(
      await findCurrentActionableTaskId(database.db, prepared.studentId),
    ).toBe(d1LowId);
    expect(await currentViaToday()).toBe(d1LowId);

    await database.db
      .update(tasks)
      .set({ dueAt: new Date("2026-08-16T11:59:59.000Z") })
      .where(eq(tasks.id, guidedId));
    expect(
      await findCurrentActionableTaskId(database.db, prepared.studentId),
    ).toBe(guidedId);
    expect(await currentViaToday()).toBe(guidedId);

    await database.db
      .update(tasks)
      .set({ status: "completed", completedAt: new Date("2026-08-16T12:30:00.000Z") })
      .where(eq(tasks.caseId, prepared.caseId));
    expect(await currentViaToday()).toBeNull();
  }, 20_000);

  it("returns the target student's valid IANA time zone and rejects invalid storage", async () => {
    const prepared = await createProbeRequiredCase(api, "student-time-zone-v1");
    await database.db
      .update(students)
      .set({ timezone: "Pacific/Auckland" })
      .where(eq(students.id, prepared.studentId));

    const valid = await api.inject({
      method: "GET",
      url: `/v1/students/${prepared.studentId}/today`,
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.json<ApiResponse<TodayTasksView>>().data.timeZone).toBe(
      "Pacific/Auckland",
    );

    await database.db
      .update(students)
      .set({ timezone: "Mars/Olympus_Mons" })
      .where(eq(students.id, prepared.studentId));
    const invalid = await api.inject({
      method: "GET",
      url: `/v1/students/${prepared.studentId}/today`,
    });
    expect(invalid.statusCode).toBe(500);
    expect(invalid.json<ApiErrorResponse>().error).toMatchObject({
      code: "STORED_STUDENT_INVALID",
      retryable: false,
    });
  }, 20_000);
});
