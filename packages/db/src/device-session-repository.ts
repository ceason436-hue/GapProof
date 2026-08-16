import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { Database } from "./client.ts";
import { isPostgresUniqueViolation } from "./case-repository.ts";
import { cases, deviceSessions, ocrBatchPages, ocrBatches, students } from "./schema.ts";

export class DeviceSessionIdempotencyError extends Error {
  readonly code = "IDEMPOTENCY_KEY_REUSED";
  constructor() { super("The idempotency key belongs to a different device-session request."); }
}

export interface IssueDeviceSessionInput {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly studentId: string;
  readonly tokenHash: string;
  readonly idempotencyKey: string;
  readonly expiresAt: Date;
  readonly now: Date;
}

async function findByIdempotencyKey(database: Pick<Database, "select">, key: string) {
  const [row] = await database.select().from(deviceSessions).where(eq(deviceSessions.idempotencyKey, key)).limit(1);
  return row;
}

function sameIssuance(row: typeof deviceSessions.$inferSelect, input: IssueDeviceSessionInput) {
  return row.tokenHash === input.tokenHash;
}

export async function issueDeviceSession(database: Database, input: IssueDeviceSessionInput) {
  const existing = await findByIdempotencyKey(database, input.idempotencyKey);
  if (existing !== undefined) {
    if (!sameIssuance(existing, input)) throw new DeviceSessionIdempotencyError();
    return { session: existing, replayed: true } as const;
  }
  try {
    return await database.transaction(async (transaction) => {
      const replay = await findByIdempotencyKey(transaction, input.idempotencyKey);
      if (replay !== undefined) {
        if (!sameIssuance(replay, input)) throw new DeviceSessionIdempotencyError();
        return { session: replay, replayed: true } as const;
      }
      await transaction.insert(students).values({
        id: input.studentId,
        tenantId: input.tenantId,
        anonymousKey: `device:${input.studentId}`,
      });
      const [session] = await transaction.insert(deviceSessions).values({
        id: input.sessionId,
        tenantId: input.tenantId,
        studentId: input.studentId,
        tokenHash: input.tokenHash,
        idempotencyKey: input.idempotencyKey,
        expiresAt: input.expiresAt,
        lastSeenAt: input.now,
        createdAt: input.now,
      }).returning();
      if (session === undefined) throw new Error("The device session was not created.");
      return { session, replayed: false } as const;
    });
  } catch (error) {
    if (!isPostgresUniqueViolation(error)) throw error;
    const replay = await findByIdempotencyKey(database, input.idempotencyKey);
    if (replay === undefined || !sameIssuance(replay, input)) throw new DeviceSessionIdempotencyError();
    return { session: replay, replayed: true } as const;
  }
}

export async function authenticateDeviceSession(database: Database, tokenHash: string, now: Date) {
  const [row] = await database.select({ session: deviceSessions, student: students })
    .from(deviceSessions).innerJoin(students, eq(deviceSessions.studentId, students.id))
    .where(and(eq(deviceSessions.tokenHash, tokenHash), isNull(deviceSessions.revokedAt), gt(deviceSessions.expiresAt, now), eq(students.status, "active"), isNull(students.deletedAt)))
    .limit(1);
  if (row === undefined) return undefined;
  await database.update(deviceSessions).set({ lastSeenAt: now }).where(eq(deviceSessions.id, row.session.id));
  return row;
}

export async function revokeDeviceSession(database: Database, sessionId: string, now: Date) {
  const [row] = await database.update(deviceSessions).set({ revokedAt: now, lastSeenAt: now }).where(and(eq(deviceSessions.id, sessionId), isNull(deviceSessions.revokedAt))).returning();
  return row;
}

export type RecoverableOcrBatch = {
  readonly batchId: string;
  readonly caseId: string;
  readonly title: string;
  readonly status: "collecting" | "ready" | "processing" | "needs_confirmation" | "retryable_error" | "failed";
  readonly pageCount: number;
  readonly resumeKind: "continue_upload" | "wait" | "review" | "retry";
  readonly updatedAt: Date;
};

export const recoverableOcrBatchStatuses = ["collecting", "ready", "processing", "needs_confirmation", "retryable_error", "failed"] as const;

function resumeKind(status: RecoverableOcrBatch["status"]): RecoverableOcrBatch["resumeKind"] {
  if (status === "collecting" || status === "ready") return "continue_upload";
  if (status === "processing") return "wait";
  if (status === "needs_confirmation") return "review";
  return "retry";
}

async function recoverableView(database: Pick<Database, "select">, batch: typeof ocrBatches.$inferSelect): Promise<RecoverableOcrBatch | undefined> {
  const [caseRow] = await database.select({ state: cases.state, title: cases.title }).from(cases).where(eq(cases.id, batch.caseId)).limit(1);
  if (caseRow === undefined || (batch.status === "needs_confirmation" && caseRow.state !== "awaiting_confirmation")) return undefined;
  const pages = await database.select({ id: ocrBatchPages.id }).from(ocrBatchPages).where(eq(ocrBatchPages.batchId, batch.id));
  const status = batch.status as RecoverableOcrBatch["status"];
  const title = caseRow.title.trim().slice(0, 80) || "上传的学习材料";
  return { batchId: batch.id, caseId: batch.caseId, title, status, pageCount: pages.length, resumeKind: resumeKind(status), updatedAt: batch.updatedAt };
}

export async function findRecoverableOcrBatchesForStudent(database: Pick<Database, "select">, studentId: string) {
  const rows = await database.select().from(ocrBatches)
    .where(and(eq(ocrBatches.studentId, studentId), inArray(ocrBatches.status, [...recoverableOcrBatchStatuses])))
    .orderBy(desc(ocrBatches.updatedAt));
  const views = await Promise.all(rows.map((row) => recoverableView(database, row)));
  return views.filter((view): view is RecoverableOcrBatch => view !== undefined);
}

export async function findRecoverableOcrBatchForStudent(database: Pick<Database, "select">, studentId: string, batchId: string) {
  const [row] = await database.select().from(ocrBatches)
    .where(and(eq(ocrBatches.id, batchId), eq(ocrBatches.studentId, studentId), inArray(ocrBatches.status, [...recoverableOcrBatchStatuses])))
    .limit(1);
  return row === undefined ? undefined : recoverableView(database, row);
}
