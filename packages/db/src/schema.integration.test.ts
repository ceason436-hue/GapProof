import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase } from "./client.ts";
import {
  cases,
  demoClocks,
  deviceSessions,
  learningEvidenceEvents,
  ocrBatchPages,
  ocrBatches,
  sourceAssets,
  studentProfileRevisions,
  students,
  tasks,
} from "./schema.ts";
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
    await database.db.delete(tasks);
    await database.db.delete(ocrBatchPages);
    await database.db.delete(ocrBatches);
    await database.db.delete(sourceAssets);
    await database.db.delete(learningEvidenceEvents);
    await database.db.delete(demoClocks);
    await database.db.delete(cases);
    await database.db.delete(studentProfileRevisions);
    await database.db.delete(deviceSessions);
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

  it("enforces source asset ownership, identity, size, and retention constraints", async () => {
    const value = {
      id: "0198a111-1111-7000-8000-000000000020",
      tenantId: ids.tenant,
      studentId: ids.student,
      caseId: ids.case,
      objectKey: "students/0198a111-1111-7000-8000-000000000002/source-1",
      sha256: "a".repeat(64),
      mimeType: "image/png",
      byteSize: 1024,
      assetType: "student_upload" as const,
      retentionUntil: new Date("2027-08-15T00:00:00.000Z"),
    };

    const [inserted] = await database.db
      .insert(sourceAssets)
      .values(value)
      .returning();
    expect(inserted).toMatchObject({
      objectKey: value.objectKey,
      processingStatus: "pending_upload",
      studentId: ids.student,
      caseId: ids.case,
    });

    await expect(
      database.db.insert(sourceAssets).values({
        ...value,
        id: "0198a111-1111-7000-8000-000000000021",
      }),
    ).rejects.toThrow();

    await expect(
      database.db.insert(sourceAssets).values({
        ...value,
        id: "0198a111-1111-7000-8000-000000000022",
        objectKey: `${value.objectKey}-bad-hash`,
        sha256: "A".repeat(64),
      }),
    ).rejects.toThrow();

    await expect(
      database.db.insert(sourceAssets).values({
        ...value,
        id: "0198a111-1111-7000-8000-000000000023",
        objectKey: `${value.objectKey}-bad-size`,
        byteSize: 0,
      }),
    ).rejects.toThrow();

    const [unowned] = await database.db
      .insert(sourceAssets)
      .values({
        ...value,
        id: "0198a111-1111-7000-8000-000000000024",
        objectKey: `${value.objectKey}-unowned`,
        studentId: null,
        caseId: null,
      })
      .returning();
    expect(unowned?.studentId).toBeNull();
    expect(unowned?.caseId).toBeNull();

    await expect(
      database.db.insert(sourceAssets).values({
        ...value,
        id: "0198a111-1111-7000-8000-000000000025",
        objectKey: `${value.objectKey}-missing-student`,
        studentId: "0198a111-1111-7000-8000-000000000099",
      }),
    ).rejects.toThrow();

    await expect(
      database.db.insert(sourceAssets).values({
        ...value,
        id: "0198a111-1111-7000-8000-000000000026",
        objectKey: `${value.objectKey}-missing-case`,
        caseId: "0198a111-1111-7000-8000-000000000099",
      }),
    ).rejects.toThrow();
  });

  it("creates the source asset lookup indexes", async () => {
    const result = await database.db.execute(sql<{ indexname: string }>`
      select indexname
      from pg_indexes
      where schemaname = 'app' and tablename = 'source_assets'
    `);

    expect(result.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        "source_assets_object_key_uidx",
        "source_assets_tenant_created_idx",
        "source_assets_student_created_idx",
        "source_assets_case_created_idx",
        "source_assets_status_created_idx",
        "source_assets_retention_idx",
      ]),
    );
  });

  it("persists source asset inspection quality and update timestamps", async () => {
    const result = await database.db.execute(sql<{ column_name: string; data_type: string }>`
      select column_name, data_type
      from information_schema.columns
      where table_schema = 'app' and table_name = 'source_assets'
        and column_name in ('quality', 'updated_at')
    `);

    expect(result).toEqual(expect.arrayContaining([
      { column_name: "quality", data_type: "jsonb" },
      { column_name: "updated_at", data_type: "timestamp with time zone" },
    ]));
  });

  it("rejects a negative case state version", async () => {
    await expect(
      database.db
        .update(cases)
        .set({ stateVersion: -1 })
        .where(eq(cases.id, ids.case)),
    ).rejects.toThrow();
  });

  it("enforces one nonnegative-version Demo clock per Case", async () => {
    await database.db.insert(demoClocks).values({
      id: "0198a111-1111-7000-8000-000000000010",
      caseId: ids.case,
      effectiveNow: new Date("2026-08-15T00:00:00.000Z"),
    });

    await expect(
      database.db.insert(demoClocks).values({
        id: "0198a111-1111-7000-8000-000000000011",
        caseId: ids.case,
        effectiveNow: new Date("2026-08-15T00:00:01.000Z"),
      }),
    ).rejects.toThrow();
    await expect(
      database.db
        .update(demoClocks)
        .set({ clockVersion: -1 })
        .where(eq(demoClocks.caseId, ids.case)),
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
