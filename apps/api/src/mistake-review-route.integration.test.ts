import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";

import type { ApiResponse, LearningTaskView, MistakeReviewCompletionView, QuestionArchiveView, TodayTasksView } from "@gapproof/contracts";
import { cases, createDatabase, deviceSessions, eq, learningEvidenceEvents, runMigrations, students, tasks } from "@gapproof/db";
import { FixedClock } from "@gapproof/domain";
import { createJobQueue } from "@gapproof/jobs";

import { buildApi } from "./app.ts";
import { createDeviceSessionService } from "./device-session-module.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const withDatabase = databaseUrl === undefined ? describe.skip : describe;

withDatabase("device-owned mistake review API", () => {
  const database = createDatabase(databaseUrl ?? "");
  const queue = createJobQueue(databaseUrl ?? "");
  const now = new Date("2026-08-16T10:00:00.000Z");
  const service = createDeviceSessionService({
    database: database.db,
    secret: "mistake-review-integration-secret-32-bytes",
    secureCookies: false,
    now: () => now,
  });
  const caseId = uuidv7();
  const extractionEventId = uuidv7();
  const confirmationEventId = uuidv7();
  const contentEventId = uuidv7();
  const contentTaskId = uuidv7();
  let studentId = "";
  let foreignStudentId = "";
  let cookie = "";
  let foreignCookie = "";
  let api: Awaited<ReturnType<typeof buildApi>>;

  beforeAll(async () => {
    await runMigrations(database.db);
    const owner = await service.issue({ cookieHeader: undefined, idempotencyKey: `mistake-owner-${uuidv7()}` });
    const foreign = await service.issue({ cookieHeader: undefined, idempotencyKey: `mistake-foreign-${uuidv7()}` });
    studentId = owner.principal.studentId;
    foreignStudentId = foreign.principal.studentId;
    cookie = owner.cookie!.split(";", 1)[0]!;
    foreignCookie = foreign.cookie!.split(";", 1)[0]!;
    await database.db.insert(cases).values({
      id: caseId,
      tenantId: owner.principal.tenantId,
      studentId,
      state: "d1_scheduled",
      stateVersion: 6,
      title: "英语错题",
      synthetic: false,
      simulation: false,
    });
    await database.db.insert(learningEvidenceEvents).values([
      {
        id: extractionEventId,
        tenantId: owner.principal.tenantId,
        studentId,
        caseId,
        eventType: "evidence_ingested",
        sourceType: "real_alibaba_ocr",
        sourceRef: "private-source",
        payload: { extraction: { items: [{ itemId: "page-1", prompt: "OCR page" }] } },
        occurredAt: now,
        idempotencyKey: `mistake-extraction-${caseId}`,
      },
      {
        id: confirmationEventId,
        tenantId: owner.principal.tenantId,
        studentId,
        caseId,
        eventType: "recognition_confirmed",
        sourceType: "student_confirmation",
        payload: {
          confirmedItemIds: ["page-1"],
          corrections: [],
          reviewedQuestions: [
            { sourceItemId: "page-1", prompt: "第一道题", studentAnswer: "A" },
            { sourceItemId: "page-1", prompt: "第二道题", studentAnswer: null },
          ],
        },
        occurredAt: new Date(now.getTime() + 1_000),
        idempotencyKey: `mistake-confirmation-${caseId}`,
      },
      {
        id: contentEventId,
        tenantId: owner.principal.tenantId,
        studentId,
        caseId,
        eventType: "intervention_generated",
        sourceType: "confirmed_student_evidence",
        payload: {
          privateEvidence: {
            contentSource: "confirmed_real_material",
            knowledgeTarget: "present-perfect-participle",
            contentBasisEventId: confirmationEventId,
          },
        },
        occurredAt: new Date(now.getTime() + 2_000),
        idempotencyKey: `mistake-content-${caseId}`,
      },
    ]);
    await database.db.insert(tasks).values({
      id: contentTaskId,
      tenantId: owner.principal.tenantId,
      studentId,
      caseId,
      taskType: "guided_intervention",
      status: "completed",
      title: "已完成的针对练习",
      estimatedMinutes: 8,
      scheduledFor: now,
      completedAt: new Date(now.getTime() + 3_000),
      payload: {
        rationale: "基于已确认材料。",
        steps: [{ id: "step-1", kind: "guided_practice", title: "找线索", content: "先找时间线索。" }],
        contentSource: "confirmed_real_material",
        knowledgeTarget: "present-perfect-participle",
        contentBasisEventId: confirmationEventId,
      },
      sourceEventId: contentEventId,
    });
    api = await buildApi({ database: database.db, queue, clock: new FixedClock(now.toISOString()), deviceSession: service });
  });

  afterAll(async () => {
    await api.close();
    await database.db.delete(tasks).where(eq(tasks.caseId, caseId));
    await database.db.delete(learningEvidenceEvents).where(eq(learningEvidenceEvents.caseId, caseId));
    await database.db.delete(cases).where(eq(cases.id, caseId));
    await database.db.delete(deviceSessions).where(eq(deviceSessions.studentId, studentId));
    await database.db.delete(deviceSessions).where(eq(deviceSessions.studentId, foreignStudentId));
    await database.db.delete(students).where(eq(students.id, studentId));
    await database.db.delete(students).where(eq(students.id, foreignStudentId));
    await database.close();
  });

  it("creates, scopes, completes, and projects one review per confirmed question", async () => {
    const archiveResponse = await api.inject({ method: "GET", url: `/v1/students/${studentId}/question-archive`, headers: { cookie } });
    expect(archiveResponse.statusCode).toBe(200);
    const initialItems = archiveResponse.json<ApiResponse<QuestionArchiveView>>().data.items;
    expect(initialItems).toHaveLength(2);
    expect(initialItems.every(item => item.reviewReady && item.tasks.every(task => task.taskType !== "mistake_review"))).toBe(true);

    const firstRequest = {
      method: "POST" as const,
      url: `/v1/students/${studentId}/question-archive/reviews`,
      headers: { cookie, "idempotency-key": "same-browser-key" },
      payload: { entryRef: initialItems[0]!.entryRef },
    };
    const missingSession = await api.inject({ ...firstRequest, headers: { "idempotency-key": uuidv7() } });
    expect(missingSession.statusCode).toBe(401);
    const foreign = await api.inject({ ...firstRequest, headers: { cookie: foreignCookie, "idempotency-key": uuidv7() } });
    expect(foreign.statusCode).toBe(404);

    const first = await api.inject(firstRequest);
    const replay = await api.inject(firstRequest);
    expect(first.statusCode).toBe(200);
    expect(replay.json<ApiResponse<LearningTaskView>>().data).toEqual(first.json<ApiResponse<LearningTaskView>>().data);
    const firstTask = first.json<ApiResponse<LearningTaskView>>().data;
    expect(firstTask).toMatchObject({ taskType: "mistake_review", prompt: "第一道题", originalAnswer: "A", status: "ready" });

    const second = await api.inject({ ...firstRequest, payload: { entryRef: initialItems[1]!.entryRef } });
    expect(second.statusCode).toBe(200);
    const secondTask = second.json<ApiResponse<LearningTaskView>>().data;
    expect(secondTask.id).not.toBe(firstTask.id);
    expect(secondTask).toMatchObject({ taskType: "mistake_review", prompt: "第二道题", originalAnswer: null });

    const projected = await api.inject({ method: "GET", url: `/v1/students/${studentId}/question-archive`, headers: { cookie } });
    const projectedItems = projected.json<ApiResponse<QuestionArchiveView>>().data.items;
    expect(projectedItems[0]!.tasks.filter(task => task.taskType === "mistake_review")).toEqual([expect.objectContaining({ taskId: firstTask.id })]);
    expect(projectedItems[1]!.tasks.filter(task => task.taskType === "mistake_review")).toEqual([expect.objectContaining({ taskId: secondTask.id })]);

    const completionRequest = {
      method: "POST" as const,
      url: `/v1/tasks/${firstTask.id}/mistake-review/complete`,
      headers: { cookie, "idempotency-key": "same-completion-key" },
      payload: { responseText: "我先找时间线索，再判断时态。" },
    };
    const completed = await api.inject(completionRequest);
    const completedReplay = await api.inject(completionRequest);
    expect(completed.statusCode).toBe(200);
    expect(completedReplay.json<ApiResponse<MistakeReviewCompletionView>>().data).toEqual(completed.json<ApiResponse<MistakeReviewCompletionView>>().data);
    expect(completed.json<ApiResponse<MistakeReviewCompletionView>>().data).toMatchObject({ taskId: firstTask.id, status: "completed" });

    const completeSecondWithSameRawKey = await api.inject({ ...completionRequest, url: `/v1/tasks/${secondTask.id}/mistake-review/complete`, payload: { responseText: "第二道题使用另一套思路。" } });
    expect(completeSecondWithSameRawKey.statusCode).toBe(200);
    expect(completeSecondWithSameRawKey.json<ApiResponse<MistakeReviewCompletionView>>().data.taskId).toBe(secondTask.id);

    const today = await api.inject({ method: "GET", url: `/v1/students/${studentId}/today`, headers: { cookie } });
    expect(today.statusCode).toBe(200);
    expect(today.json<ApiResponse<TodayTasksView>>().data.tasks.filter(task => task.taskType === "mistake_review").every(task => task.status === "completed")).toBe(true);
  });
});
