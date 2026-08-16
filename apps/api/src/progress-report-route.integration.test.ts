import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";

import type { ApiResponse, StudentFactReportsView, StudentProgressView } from "@gapproof/contracts";
import { cases, createDatabase, deviceSessions, eq, learningEvidenceEvents, runMigrations, students } from "@gapproof/db";
import { createJobQueue } from "@gapproof/jobs";
import { buildApi } from "./app.ts";
import { createDeviceSessionService } from "./device-session-module.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const withDatabase = databaseUrl === undefined ? describe.skip : describe;

withDatabase("student progress and fact report routes", () => {
  const database = createDatabase(databaseUrl ?? "");
  const queue = createJobQueue(databaseUrl ?? "");
  const service = createDeviceSessionService({ database: database.db, secret: "progress-report-integration-secret-32-bytes", secureCookies: false });
  let api: Awaited<ReturnType<typeof buildApi>>;
  const studentIds: string[] = [];
  const caseIds: string[] = [];

  beforeAll(async () => {
    await runMigrations(database.db);
    api = await buildApi({ database: database.db, queue, deviceSession: service });
  });

  afterAll(async () => {
    for (const studentId of studentIds) await database.db.delete(learningEvidenceEvents).where(eq(learningEvidenceEvents.studentId, studentId));
    for (const caseId of caseIds) await database.db.delete(cases).where(eq(cases.id, caseId));
    for (const studentId of studentIds) {
      await database.db.delete(deviceSessions).where(eq(deviceSessions.studentId, studentId));
      await database.db.delete(students).where(eq(students.id, studentId));
    }
    await api.close();
    await database.close();
  });

  it("projects only the device student's records and only authoritative reports", async () => {
    const owner = await service.issue({ cookieHeader: undefined, idempotencyKey: `progress-owner-${uuidv7()}` });
    const foreign = await service.issue({ cookieHeader: undefined, idempotencyKey: `progress-foreign-${uuidv7()}` });
    studentIds.push(owner.principal.studentId, foreign.principal.studentId);
    const verifiedCaseId = uuidv7();
    const activeCaseId = uuidv7();
    const foreignCaseId = uuidv7();
    caseIds.push(verifiedCaseId, activeCaseId, foreignCaseId);
    await database.db.insert(cases).values([
      { id: verifiedCaseId, tenantId: owner.principal.tenantId, studentId: owner.principal.studentId, state: "repair_verified", title: "合成体验目标", synthetic: true, simulation: true },
      { id: activeCaseId, tenantId: owner.principal.tenantId, studentId: owner.principal.studentId, state: "d7_scheduled", title: "待检查目标", synthetic: false, simulation: false },
      { id: foreignCaseId, tenantId: foreign.principal.tenantId, studentId: foreign.principal.studentId, state: "support_required", title: "其他学生目标", synthetic: false, simulation: false },
    ]);
    await database.db.insert(learningEvidenceEvents).values({
      id: uuidv7(), tenantId: owner.principal.tenantId, studentId: owner.principal.studentId, caseId: verifiedCaseId,
      eventType: "retest_evaluated", sourceType: "student_d7_retest_attempt", payload: { kind: "d7", passed: true },
      occurredAt: new Date("2026-08-16T00:00:00.000Z"), idempotencyKey: `progress-evidence-${uuidv7()}`,
    });
    const cookie = owner.cookie!.split(";", 1)[0]!;

    const progressResponse = await api.inject({ method: "GET", url: `/v1/students/${owner.principal.studentId}/progress`, headers: { cookie } });
    expect(progressResponse.statusCode).toBe(200);
    const progress = progressResponse.json<ApiResponse<StudentProgressView>>().data;
    expect(progress.goals).toHaveLength(2);
    expect(progress.goals.find((goal) => goal.caseId === verifiedCaseId)).toMatchObject({ source: "synthetic_experience", stage: "repair_verified" });
    expect(JSON.stringify(progress)).not.toContain(foreignCaseId);

    const reportResponse = await api.inject({ method: "GET", url: `/v1/students/${owner.principal.studentId}/reports`, headers: { cookie } });
    expect(reportResponse.statusCode).toBe(200);
    const reports = reportResponse.json<ApiResponse<StudentFactReportsView>>().data.reports;
    expect(reports).toEqual([expect.objectContaining({ caseId: verifiedCaseId, conclusion: "repair_verified", source: "synthetic_experience", d7Result: "passed" })]);
    expect(JSON.stringify(reports)).not.toContain(activeCaseId);

    const foreignResponse = await api.inject({ method: "GET", url: `/v1/students/${foreign.principal.studentId}/reports`, headers: { cookie } });
    expect(foreignResponse.statusCode).toBe(404);
  });
});
