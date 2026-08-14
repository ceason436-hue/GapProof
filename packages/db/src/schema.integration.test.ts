import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase } from "./client.ts";
import { cases, learningEvidenceEvents, students } from "./schema.ts";
import {
  persistCaseTransition,
  VersionConflictError,
} from "./persist-case-transition.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl === undefined ? describe.skip : describe;

const ids = {
  tenant: "0198a111-1111-7000-8000-000000000001",
  student: "0198a111-1111-7000-8000-000000000002",
  case: "0198a111-1111-7000-8000-000000000003",
  event: "0198a111-1111-7000-8000-000000000004",
  transactionalCase: "0198a111-1111-7000-8000-000000000006",
  transactionalEvent: "0198a111-1111-7000-8000-000000000007",
  staleEvent: "0198a111-1111-7000-8000-000000000008",
};

describeWithDatabase("PostgreSQL evidence ledger", () => {
  const database = createDatabase(databaseUrl ?? "");

  beforeAll(async () => {
    await database.db.delete(learningEvidenceEvents);
    await database.db.delete(cases);
    await database.db.delete(students);

    await database.db.insert(students).values({
      id: ids.student,
      tenantId: ids.tenant,
      anonymousKey: "synthetic-student-db-test",
      grade: "8",
      region: "Shanghai",
      curriculumVersion: "unverified-demo-v1",
    });

    await database.db.insert(cases).values({
      id: ids.case,
      tenantId: ids.tenant,
      studentId: ids.student,
      title: "Synthetic irregular participle case",
      synthetic: true,
      simulation: true,
    });

    await database.db.insert(cases).values({
      id: ids.transactionalCase,
      tenantId: ids.tenant,
      studentId: ids.student,
      title: "Transactional state test",
      synthetic: true,
      simulation: true,
    });
  });

  afterAll(async () => {
    await database.close();
  });

  it("enforces a unique business idempotency key", async () => {
    const value = {
      id: ids.event,
      tenantId: ids.tenant,
      studentId: ids.student,
      caseId: ids.case,
      eventType: "evidence_ingested" as const,
      sourceType: "synthetic_fixture",
      payload: { lowConfidenceRegionCount: 1 },
      confidence: "0.8000",
      occurredAt: new Date("2026-08-14T10:00:00.000Z"),
      idempotencyKey: "synthetic-evidence-v1",
    };

    await database.db.insert(learningEvidenceEvents).values(value);

    await expect(
      database.db.insert(learningEvidenceEvents).values({
        ...value,
        id: "0198a111-1111-7000-8000-000000000005",
      }),
    ).rejects.toThrow();
  });

  it("rejects a negative case state version", async () => {
    await expect(
      database.db
        .update(cases)
        .set({ stateVersion: -1 })
        .where(eq(cases.id, ids.case)),
    ).rejects.toThrow();
  });

  it("keeps evidence and case rows in separate logical schemas", async () => {
    const result = await database.db.execute(sql<{
      app_table: string | null;
      evidence_table: string | null;
    }>`
      select
        to_regclass('app.cases')::text as app_table,
        to_regclass('evidence.learning_evidence_events')::text as evidence_table
    `);

    expect(result[0]).toEqual({
      app_table: "app.cases",
      evidence_table: "evidence.learning_evidence_events",
    });
  });

  it("enables the pgvector extension for later governed retrieval", async () => {
    const result = await database.db.execute(sql<{ extversion: string }>`
      select extversion from pg_extension where extname = 'vector'
    `);

    expect(result[0]?.extversion).toMatch(/^0\./);
  });

  it("updates the snapshot and appends its evidence event atomically", async () => {
    const result = await persistCaseTransition(database.db, {
      caseId: ids.transactionalCase,
      expectedVersion: 0,
      nextState: "awaiting_confirmation",
      event: {
        id: ids.transactionalEvent,
        tenantId: ids.tenant,
        studentId: ids.student,
        caseId: ids.transactionalCase,
        eventType: "evidence_ingested",
        sourceType: "synthetic_fixture",
        payload: { lowConfidenceRegionCount: 1 },
        confidence: "0.8000",
        occurredAt: new Date("2026-08-14T10:00:00.000Z"),
        idempotencyKey: "transactional-evidence-v1",
      },
    });

    expect(result).toMatchObject({
      applied: true,
      state: "awaiting_confirmation",
      stateVersion: 1,
    });

    const storedEvents = await database.db
      .select()
      .from(learningEvidenceEvents)
      .where(eq(learningEvidenceEvents.caseId, ids.transactionalCase));
    expect(storedEvents).toHaveLength(1);
  });

  it("returns the existing snapshot when the idempotency key is replayed", async () => {
    const result = await persistCaseTransition(database.db, {
      caseId: ids.transactionalCase,
      expectedVersion: 0,
      nextState: "awaiting_confirmation",
      event: {
        id: "0198a111-1111-7000-8000-000000000009",
        tenantId: ids.tenant,
        studentId: ids.student,
        caseId: ids.transactionalCase,
        eventType: "evidence_ingested",
        sourceType: "synthetic_fixture",
        payload: { lowConfidenceRegionCount: 1 },
        occurredAt: new Date("2026-08-14T10:00:00.000Z"),
        idempotencyKey: "transactional-evidence-v1",
      },
    });

    expect(result.applied).toBe(false);
    expect(result.stateVersion).toBe(1);
  });

  it("rejects a stale state version without appending an event", async () => {
    await expect(
      persistCaseTransition(database.db, {
        caseId: ids.transactionalCase,
        expectedVersion: 0,
        nextState: "ready_for_diagnosis",
        event: {
          id: ids.staleEvent,
          tenantId: ids.tenant,
          studentId: ids.student,
          caseId: ids.transactionalCase,
          eventType: "recognition_confirmed",
          sourceType: "student_confirmation",
          payload: {},
          occurredAt: new Date("2026-08-14T10:01:00.000Z"),
          idempotencyKey: "stale-confirmation-v1",
        },
      }),
    ).rejects.toThrowError(VersionConflictError);

    const staleEvents = await database.db
      .select()
      .from(learningEvidenceEvents)
      .where(eq(learningEvidenceEvents.id, ids.staleEvent));
    expect(staleEvents).toHaveLength(0);
  });
});
