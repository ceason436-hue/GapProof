import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";

import type { ApiErrorResponse, ApiResponse, TutorTurnView } from "@gapproof/contracts";
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
    expect(latest.json<ApiResponse<TutorTurnView>>().data.turnId).toBe(firstView.turnId);
    const [stored] = await database.db.select().from(tutorTurns).where(eq(tutorTurns.id, firstView.turnId));
    expect(stored?.context.learnerText).toContain("[邮箱已隐藏]");
    expect(stored?.context.learnerText).toContain("[手机号已隐藏]");
    expect(stored?.context.learnerText).not.toMatch(/learner@example|13800138000/);
    expect(await database.db.select().from(cases).where(eq(cases.id, caseId))).toEqual(beforeCase);
    expect(await database.db.select().from(tasks).where(eq(tasks.id, taskId))).toEqual(beforeTask);
    const changed = await api.inject({ ...request, payload: { ...payload, learnerText: "换一个问题。" } });
    expect(changed.statusCode).toBe(409);
    expect(changed.json<ApiErrorResponse>().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });
});
