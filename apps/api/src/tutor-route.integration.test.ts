import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";

import type { ApiErrorResponse, ApiResponse, TutorSessionView, TutorTurnView } from "@gapproof/contracts";
import {
  cases,
  createDatabase,
  deviceSessions,
  eq,
  learningEvidenceEvents,
  runMigrations,
  students,
  tasks,
  tutorSessions,
  tutorTurns,
} from "@gapproof/db";
import { FixedClock } from "@gapproof/domain";
import { createJobQueue, TUTOR_TURN_QUEUE } from "@gapproof/jobs";

import { buildApi } from "./app.ts";
import { createDeviceSessionService } from "./device-session-module.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const withDatabase = databaseUrl === undefined ? describe.skip : describe;

withDatabase("device-owned Socratic tutor API", () => {
  const database = createDatabase(databaseUrl ?? "");
  const queue = createJobQueue(databaseUrl ?? "");
  const now = new Date("2026-08-16T10:00:00.000Z");
  const service = createDeviceSessionService({
    database: database.db,
    secret: "tutor-route-integration-device-secret-32-bytes",
    secureCookies: false,
    now: () => now,
  });
  const caseId = uuidv7();
  const eventId = uuidv7();
  const taskId = uuidv7();
  let ownerStudentId = "";
  let foreignStudentId = "";
  let ownerCookie = "";
  let foreignCookie = "";
  let api: Awaited<ReturnType<typeof buildApi>>;

  beforeAll(async () => {
    await runMigrations(database.db);
    await queue.start();
    await queue.boss.deleteAllJobs(TUTOR_TURN_QUEUE);
    const owner = await service.issue({ cookieHeader: undefined, idempotencyKey: `tutor-owner-${uuidv7()}` });
    const foreign = await service.issue({ cookieHeader: undefined, idempotencyKey: `tutor-foreign-${uuidv7()}` });
    ownerStudentId = owner.principal.studentId;
    foreignStudentId = foreign.principal.studentId;
    ownerCookie = owner.cookie!.split(";", 1)[0]!;
    foreignCookie = foreign.cookie!.split(";", 1)[0]!;
    await database.db.insert(cases).values({
      id: caseId,
      tenantId: owner.principal.tenantId,
      studentId: ownerStudentId,
      state: "intervention_active",
      stateVersion: 5,
      synthetic: false,
      simulation: false,
    });
    await database.db.insert(learningEvidenceEvents).values({
      id: eventId,
      tenantId: owner.principal.tenantId,
      studentId: ownerStudentId,
      caseId,
      eventType: "intervention_generated",
      sourceType: "confirmed_student_evidence",
      sourceRef: caseId,
      payload: { kind: "guided_intervention" },
      occurredAt: now,
      idempotencyKey: `tutor-route-event-${eventId}`,
    });
    await database.db.insert(tasks).values({
      id: taskId,
      tenantId: owner.principal.tenantId,
      studentId: ownerStudentId,
      caseId,
      taskType: "guided_intervention",
      status: "ready",
      title: "核对时态线索",
      estimatedMinutes: 8,
      scheduledFor: now,
      payload: {
        rationale: "根据学生已确认的题目安排引导。",
        steps: [{ id: "step-evidence", kind: "guided_practice", title: "找出时间线索", content: "先圈出句子里的时间表达，再说说它与动作的关系。" }],
      },
      sourceEventId: eventId,
    });
    api = await buildApi({ database: database.db, queue, clock: new FixedClock(now.toISOString()), deviceSession: service });
  });

  afterAll(async () => {
    await api.close();
    await queue.boss.deleteAllJobs(TUTOR_TURN_QUEUE);
    await database.db.delete(tutorTurns).where(eq(tutorTurns.taskId, taskId));
    await database.db.delete(tutorSessions).where(eq(tutorSessions.taskId, taskId));
    await database.db.delete(tasks).where(eq(tasks.id, taskId));
    await database.db.delete(learningEvidenceEvents).where(eq(learningEvidenceEvents.id, eventId));
    await database.db.delete(cases).where(eq(cases.id, caseId));
    await database.db.delete(deviceSessions).where(eq(deviceSessions.studentId, ownerStudentId));
    await database.db.delete(deviceSessions).where(eq(deviceSessions.studentId, foreignStudentId));
    await database.db.delete(students).where(eq(students.id, ownerStudentId));
    await database.db.delete(students).where(eq(students.id, foreignStudentId));
    await queue.stop();
    await database.close();
  });

  it("requires the owning device and authoritative Case version", async () => {
    const payload = { expectedVersion: 5, stepId: "step-evidence", learnerText: "我先看时间线索。" };
    const missing = await api.inject({ method: "POST", url: `/v1/tasks/${taskId}/tutor-turns`, headers: { "idempotency-key": uuidv7() }, payload });
    expect(missing.statusCode).toBe(401);
    const foreign = await api.inject({ method: "POST", url: `/v1/tasks/${taskId}/tutor-turns`, headers: { cookie: foreignCookie, "idempotency-key": uuidv7() }, payload });
    expect(foreign.statusCode).toBe(404);
    const stale = await api.inject({ method: "POST", url: `/v1/tasks/${taskId}/tutor-turns`, headers: { cookie: ownerCookie, "idempotency-key": uuidv7() }, payload: { ...payload, expectedVersion: 4 } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<ApiErrorResponse>().error.code).toBe("VERSION_CONFLICT");
    const missingSession = await api.inject({ method: "GET", url: `/v1/tasks/${taskId}/tutor-session` });
    expect(missingSession.statusCode).toBe(401);
    const foreignSession = await api.inject({ method: "GET", url: `/v1/tasks/${taskId}/tutor-session`, headers: { cookie: foreignCookie } });
    expect(foreignSession.statusCode).toBe(404);
  });

  it("queues once, replays safely, polls the same turn, and never mutates Case or task", async () => {
    const beforeCase = await database.db.select().from(cases).where(eq(cases.id, caseId));
    const beforeTask = await database.db.select().from(tasks).where(eq(tasks.id, taskId));
    const key = uuidv7();
    const payload = {
      expectedVersion: 5,
      stepId: "step-evidence",
      learnerText: "邮箱 learner@example.com，电话 13800138000。我先看时间线索。",
    };
    const request = { method: "POST" as const, url: `/v1/tasks/${taskId}/tutor-turns`, headers: { cookie: ownerCookie, "idempotency-key": key }, payload };
    const first = await api.inject(request);
    expect(first.statusCode).toBe(202);
    const firstView = first.json<ApiResponse<TutorTurnView>>().data;
    expect(firstView).toMatchObject({ taskId, status: "queued", response: null });
    const replay = await api.inject(request);
    expect(replay.statusCode).toBe(202);
    expect(replay.json<ApiResponse<TutorTurnView>>().data.turnId).toBe(firstView.turnId);
    const latest = await api.inject({ method: "GET", url: `/v1/tasks/${taskId}/tutor-session`, headers: { cookie: ownerCookie } });
    expect(latest.statusCode).toBe(200);
    expect(latest.json<ApiResponse<TutorSessionView>>().data.turns.at(-1)?.turnId).toBe(firstView.turnId);
    const [stored] = await database.db.select().from(tutorTurns).where(eq(tutorTurns.id, firstView.turnId));
    expect(stored?.context.learnerText).toContain("[邮箱已隐藏]");
    expect(stored?.context.learnerText).toContain("[手机号已隐藏]");
    expect(stored?.context.learnerText).not.toMatch(/learner@example|13800138000/);
    expect(await database.db.select().from(cases).where(eq(cases.id, caseId))).toEqual(beforeCase);
    expect(await database.db.select().from(tasks).where(eq(tasks.id, taskId))).toEqual(beforeTask);
    const changed = await api.inject({ ...request, payload: { ...payload, learnerText: "换一个问题。" } });
    expect(changed.statusCode).toBe(409);
    expect(changed.json<ApiErrorResponse>().error.code).toBe("IDEMPOTENCY_KEY_REUSED");

    await database.db.update(tutorTurns).set({
      status: "succeeded",
      response: { question: "这个时间线索说明动作发生在什么时候？", hint: "比较过去和现在。", nextAction: "reflect" },
      provider: "deepseek",
      model: "internal-model-name",
      inputTokens: 81,
      outputTokens: 29,
      errorCode: "INTERNAL_AUDIT_ONLY",
      completedAt: new Date(now.getTime() + 1_000),
      updatedAt: new Date(now.getTime() + 1_000),
    }).where(eq(tutorTurns.id, firstView.turnId));
    const secondTurnId = uuidv7();
    await database.db.insert(tutorTurns).values({
      id: secondTurnId,
      sessionId: stored!.sessionId,
      studentId: ownerStudentId,
      taskId,
      idempotencyKey: uuidv7(),
      requestHash: "b".repeat(64),
      status: "fallback",
      context: {
        learnerText: "它说明动作发生在过去。",
        stepContent: "内部步骤内容不应出现在历史响应中。",
        privateStudentContext: "内部上下文",
      },
      response: { question: "那谓语动词应该怎样变化？", hint: null, nextAction: "retry_step" },
      provider: "rule_fallback",
      model: "internal-fallback-model",
      inputTokens: 7,
      outputTokens: 5,
      errorCode: "INTERNAL_FALLBACK_REASON",
      createdAt: new Date(now.getTime() + 2_000),
      updatedAt: new Date(now.getTime() + 2_000),
      completedAt: new Date(now.getTime() + 2_000),
    });

    const historyResponse = await api.inject({ method: "GET", url: `/v1/tasks/${taskId}/tutor-session`, headers: { cookie: ownerCookie } });
    expect(historyResponse.statusCode).toBe(200);
    const history = historyResponse.json<ApiResponse<TutorSessionView>>().data;
    expect(history.taskId).toBe(taskId);
    expect(history.turns.map((turn) => turn.turnId)).toEqual([firstView.turnId, secondTurnId]);
    expect(history.turns.map((turn) => turn.learnerText)).toEqual([
      "邮箱 [邮箱已隐藏],电话 [手机号已隐藏]。我先看时间线索。",
      "它说明动作发生在过去。",
    ]);
    expect(history.turns.map((turn) => turn.response?.question)).toEqual([
      "这个时间线索说明动作发生在什么时候？",
      "那谓语动词应该怎样变化？",
    ]);
    expect(JSON.stringify(history)).not.toMatch(/deepseek|provider|model|token|INTERNAL_|stepContent|privateStudentContext/i);

    const contextual = await api.inject({
      method: "POST",
      url: `/v1/tasks/${taskId}/tutor-turns`,
      headers: { cookie: ownerCookie, "idempotency-key": uuidv7() },
      payload: { expectedVersion: 5, stepId: "step-evidence", learnerText: "所以我应该先改变谓语形式。" },
    });
    expect(contextual.statusCode).toBe(202);
    const contextualTurnId = contextual.json<ApiResponse<TutorTurnView>>().data.turnId;
    const [contextualTurn] = await database.db.select().from(tutorTurns).where(eq(tutorTurns.id, contextualTurnId));
    expect(contextualTurn?.context.history).toEqual([
      {
        learnerText: "邮箱 [邮箱已隐藏],电话 [手机号已隐藏]。我先看时间线索。",
        question: "这个时间线索说明动作发生在什么时候？",
        hint: "比较过去和现在。",
      },
      {
        learnerText: "它说明动作发生在过去。",
        question: "那谓语动词应该怎样变化？",
        hint: null,
      },
    ]);
    await database.db.delete(tutorTurns).where(eq(tutorTurns.id, contextualTurnId));

    const overflowTurnIds = Array.from({ length: 5 }, (_, index) => `0198b111-1111-7000-8000-00000000008${index}`);
    await database.db.insert(tutorTurns).values(overflowTurnIds.map((id, index) => ({
      id,
      sessionId: stored!.sessionId,
      studentId: ownerStudentId,
      taskId,
      idempotencyKey: `0198b111-1111-7000-8000-00000000009${index}`,
      requestHash: String(index).repeat(64),
      status: "succeeded" as const,
      context: { learnerText: `第 ${index + 3} 轮学生思路。` },
      response: { question: `第 ${index + 3} 轮导师问题？`, hint: null, nextAction: "reflect" },
      provider: "deepseek",
      createdAt: new Date(now.getTime() + 3_000),
      updatedAt: new Date(now.getTime() + 3_000),
      completedAt: new Date(now.getTime() + 3_000),
    })));
    const boundedResponse = await api.inject({ method: "GET", url: `/v1/tasks/${taskId}/tutor-session`, headers: { cookie: ownerCookie } });
    const boundedHistory = boundedResponse.json<ApiResponse<TutorSessionView>>().data;
    expect(boundedHistory.turns).toHaveLength(6);
    expect(boundedHistory.turns.map((turn) => turn.turnId)).toEqual([secondTurnId, ...overflowTurnIds]);
    expect(boundedHistory.turns.some((turn) => turn.turnId === firstView.turnId)).toBe(false);
  });
});
