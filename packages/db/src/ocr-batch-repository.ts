import { and, asc, count, eq, gt, gte, sql } from "drizzle-orm";
import { MAX_REAL_OCR_BATCHES_PER_24H, MAX_REAL_OCR_BATCH_PAGES, REAL_OCR_PROCESSING_NOTICE_VERSION } from "@gapproof/contracts";
import { randomUUID } from "node:crypto";
import type { Database } from "./client.ts";
import { ResourceNotFoundError, isPostgresUniqueViolation } from "./case-repository.ts";
import { apiIdempotencyRecords, cases, ocrBatches, ocrBatchPages, sourceAssets, students, type SourceAssetRow } from "./schema.ts";

const CREATE_SCOPE = "real_ocr_batch_create";
const PAGE_SCOPE = "real_ocr_batch_page";
const START_SCOPE = "real_ocr_batch_start";
const REMOVE_PAGE_SCOPE = "real_ocr_batch_page_remove";
const REORDER_PAGE_SCOPE = "real_ocr_batch_page_reorder";

export class OcrBatchIntentError extends Error {
  readonly code = "OCR_BATCH_INTENT_INVALID";
  constructor(message: string) { super(message); }
}

export class OcrBatchIdempotencyError extends Error {
  readonly code = "IDEMPOTENCY_KEY_REUSED";
  constructor() { super("The idempotency key was already used for a different OCR request."); }
}

export async function findOcrBatch(database: Pick<Database, "select">, batchId: string) {
  const [result] = await database.select({ batch: ocrBatches, caseTitle: cases.title }).from(ocrBatches)
    .innerJoin(cases, eq(ocrBatches.caseId, cases.id)).where(eq(ocrBatches.id, batchId)).limit(1);
  if (result === undefined) return undefined;
  const pages = await database.select({ page: ocrBatchPages, asset: sourceAssets })
    .from(ocrBatchPages).innerJoin(sourceAssets, eq(ocrBatchPages.assetId, sourceAssets.id))
    .where(eq(ocrBatchPages.batchId, batchId)).orderBy(asc(ocrBatchPages.pageOrder));
  return { batch: result.batch, caseTitle: result.caseTitle, pages };
}

async function idempotentRecord(database: Pick<Database, "select">, scope: string, key: string) {
  const [record] = await database.select().from(apiIdempotencyRecords)
    .where(and(eq(apiIdempotencyRecords.scope, scope), eq(apiIdempotencyRecords.idempotencyKey, key))).limit(1);
  return record;
}

export async function createRealOcrBatch(database: Database, input: { idempotencyKey: string; batchId: string; caseId: string; studentId: string; title: string; }): Promise<{ batch: typeof ocrBatches.$inferSelect; replayed: boolean }> {
  const existing = await idempotentRecord(database, CREATE_SCOPE, input.idempotencyKey);
  if (existing?.resourceId !== undefined && existing?.resourceId !== null) {
    const result = await findOcrBatch(database, existing.resourceId);
    if (result === undefined || result.batch.studentId !== input.studentId || result.caseTitle !== input.title) throw new OcrBatchIdempotencyError();
    return { batch: result.batch, replayed: true };
  }
  try {
    return await database.transaction(async (tx) => {
      const record = await idempotentRecord(tx, CREATE_SCOPE, input.idempotencyKey);
      if (record?.resourceId !== undefined && record?.resourceId !== null) {
        const result = await findOcrBatch(tx, record.resourceId);
        if (result === undefined || result.batch.studentId !== input.studentId || result.caseTitle !== input.title) throw new OcrBatchIdempotencyError();
        return { batch: result.batch, replayed: true };
      }
      const [student] = await tx.select().from(students).where(eq(students.id, input.studentId)).for("update").limit(1);
      if (student === undefined || student.deletedAt !== null || student.status !== "active") throw new ResourceNotFoundError("Student", input.studentId);
      const [recentBatches] = await tx.select({ value: count() }).from(ocrBatches).where(and(eq(ocrBatches.studentId, input.studentId), gte(ocrBatches.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1_000))));
      if ((recentBatches?.value ?? 0) >= MAX_REAL_OCR_BATCHES_PER_24H) throw new OcrBatchIntentError(`A student can start at most ${MAX_REAL_OCR_BATCHES_PER_24H} OCR batches in 24 hours.`);
      const [caseRow] = await tx.insert(cases).values({ id: input.caseId, tenantId: student.tenantId, studentId: student.id, title: input.title, simulation: false, synthetic: false }).returning();
      if (caseRow === undefined) throw new Error("The OCR Case was not created.");
      const [batch] = await tx.insert(ocrBatches).values({ id: input.batchId, tenantId: student.tenantId, studentId: student.id, caseId: caseRow.id }).returning();
      if (batch === undefined) throw new Error("The OCR batch was not created.");
      await tx.insert(apiIdempotencyRecords).values({ id: randomUUID(), scope: CREATE_SCOPE, idempotencyKey: input.idempotencyKey, resourceId: batch.id });
      return { batch, replayed: false };
    });
  } catch (error) {
    if (!isPostgresUniqueViolation(error)) throw error;
    const record = await idempotentRecord(database, CREATE_SCOPE, input.idempotencyKey);
    if (record?.resourceId === null || record?.resourceId === undefined) throw error;
    const result = await findOcrBatch(database, record.resourceId);
    if (result === undefined || result.batch.studentId !== input.studentId || result.caseTitle !== input.title) throw new OcrBatchIdempotencyError();
    return { batch: result.batch, replayed: true };
  }
}

export async function attachOcrBatchPage(database: Database, input: { batchId: string; pageId: string; asset: SourceAssetRow; idempotencyKey: string; }): Promise<{ page: typeof ocrBatchPages.$inferSelect; replayed: boolean }> {
  const existing = await idempotentRecord(database, PAGE_SCOPE, input.idempotencyKey);
  if (existing?.resourceId !== undefined && existing?.resourceId !== null) {
    const [page] = await database.select().from(ocrBatchPages).where(eq(ocrBatchPages.id, existing.resourceId)).limit(1);
    if (page === undefined || page.batchId !== input.batchId || page.assetId !== input.asset.id) throw new OcrBatchIdempotencyError();
    return { page, replayed: true };
  }
  return database.transaction(async (tx) => {
    const [batch] = await tx.select().from(ocrBatches).where(eq(ocrBatches.id, input.batchId)).for("update").limit(1);
    if (batch === undefined) throw new ResourceNotFoundError("OCR batch", input.batchId);
    if (batch.status !== "collecting" && batch.status !== "ready") throw new OcrBatchIntentError("This OCR batch is no longer accepting pages.");
    const replay = await idempotentRecord(tx, PAGE_SCOPE, input.idempotencyKey);
    if (replay?.resourceId !== undefined && replay?.resourceId !== null) {
      const [page] = await tx.select().from(ocrBatchPages).where(eq(ocrBatchPages.id, replay.resourceId)).limit(1);
      if (page === undefined || page.batchId !== input.batchId || page.assetId !== input.asset.id) throw new OcrBatchIdempotencyError();
      return { page, replayed: true };
    }
    const rows = await tx.select({ pageOrder: ocrBatchPages.pageOrder }).from(ocrBatchPages).where(eq(ocrBatchPages.batchId, batch.id));
    if (rows.length >= MAX_REAL_OCR_BATCH_PAGES) throw new OcrBatchIntentError(`A real OCR batch can contain at most ${MAX_REAL_OCR_BATCH_PAGES} pages.`);
    const [page] = await tx.insert(ocrBatchPages).values({ id: input.pageId, batchId: batch.id, assetId: input.asset.id, pageOrder: rows.length + 1 }).returning();
    if (page === undefined) throw new Error("The OCR batch page was not created.");
    await tx.insert(apiIdempotencyRecords).values({ id: randomUUID(), scope: PAGE_SCOPE, idempotencyKey: input.idempotencyKey, resourceId: page.id });
    return { page, replayed: false };
  });
}

async function mutableBatchPage(transaction: Parameters<Parameters<Database["transaction"]>[0]>[0], batchId: string, pageId: string) {
  const [batch] = await transaction.select().from(ocrBatches).where(eq(ocrBatches.id, batchId)).for("update").limit(1);
  if (batch === undefined) throw new ResourceNotFoundError("OCR batch", batchId);
  if (batch.status !== "collecting" && batch.status !== "ready") throw new OcrBatchIntentError("Pages can only be changed before recognition starts.");
  const [page] = await transaction.select().from(ocrBatchPages).where(and(eq(ocrBatchPages.id, pageId), eq(ocrBatchPages.batchId, batchId))).for("update").limit(1);
  if (page === undefined) throw new ResourceNotFoundError("OCR batch page", pageId);
  return { batch, page };
}

export async function removeOcrBatchPage(database: Database, input: { batchId: string; pageId: string; idempotencyKey: string }) {
  return database.transaction(async (transaction) => {
    const replay = await idempotentRecord(transaction, REMOVE_PAGE_SCOPE, input.idempotencyKey);
    if (replay !== undefined) {
      if (replay.resourceId !== input.batchId) throw new OcrBatchIdempotencyError();
      return { replayed: true } as const;
    }
    const { page } = await mutableBatchPage(transaction, input.batchId, input.pageId);
    await transaction.delete(ocrBatchPages).where(eq(ocrBatchPages.id, page.id));
    await transaction.update(ocrBatchPages).set({ pageOrder: sql`${ocrBatchPages.pageOrder} - 1`, updatedAt: new Date() }).where(and(eq(ocrBatchPages.batchId, input.batchId), gt(ocrBatchPages.pageOrder, page.pageOrder)));
    await transaction.insert(apiIdempotencyRecords).values({
      id: randomUUID(),
      scope: REMOVE_PAGE_SCOPE,
      idempotencyKey: input.idempotencyKey,
      resourceId: input.batchId,
    });
    return { replayed: false } as const;
  });
}

export async function reorderOcrBatchPages(database: Database, input: { batchId: string; pageIds: readonly string[]; idempotencyKey: string }) {
  return database.transaction(async (transaction) => {
    const replay = await idempotentRecord(transaction, REORDER_PAGE_SCOPE, input.idempotencyKey);
    if (replay !== undefined) {
      if (replay.resourceId !== input.batchId) throw new OcrBatchIdempotencyError();
      return { replayed: true } as const;
    }

    const [batch] = await transaction.select().from(ocrBatches).where(eq(ocrBatches.id, input.batchId)).for("update").limit(1);
    if (batch === undefined) throw new ResourceNotFoundError("OCR batch", input.batchId);
    if (batch.status !== "collecting" && batch.status !== "ready") throw new OcrBatchIntentError("Pages can only be reordered before recognition starts.");

    const pages = await transaction.select({ id: ocrBatchPages.id }).from(ocrBatchPages).where(eq(ocrBatchPages.batchId, input.batchId));
    const pageIdSet = new Set(input.pageIds);
    const currentPageIds = new Set(pages.map((page) => page.id));
    if (
      input.pageIds.length !== pages.length ||
      pageIdSet.size !== input.pageIds.length ||
      pageIdSet.size !== currentPageIds.size ||
      [...pageIdSet].some((pageId) => !currentPageIds.has(pageId))
    ) {
      throw new OcrBatchIntentError("The page order must contain every current page exactly once.");
    }

    const updatedAt = new Date();
    if (pages.length > 0) {
      const temporaryOffset = pages.length + 1;
      await transaction.update(ocrBatchPages)
        .set({ pageOrder: sql`${ocrBatchPages.pageOrder} + ${temporaryOffset}`, updatedAt })
        .where(eq(ocrBatchPages.batchId, input.batchId));
      for (const [index, pageId] of input.pageIds.entries()) {
        await transaction.update(ocrBatchPages)
          .set({ pageOrder: index + 1, updatedAt })
          .where(and(eq(ocrBatchPages.batchId, input.batchId), eq(ocrBatchPages.id, pageId)));
      }
    }
    await transaction.insert(apiIdempotencyRecords).values({
      id: randomUUID(),
      scope: REORDER_PAGE_SCOPE,
      idempotencyKey: input.idempotencyKey,
      resourceId: input.batchId,
    });
    return { replayed: false } as const;
  });
}

export async function replaceOcrBatchPage(database: Database, input: { batchId: string; pageId: string; asset: SourceAssetRow; }) {
  return database.transaction(async (transaction) => {
    const { page } = await mutableBatchPage(transaction, input.batchId, input.pageId);
    if (page.assetId === input.asset.id) return page;
    await transaction.delete(ocrBatchPages).where(eq(ocrBatchPages.id, page.id));
    const [replacement] = await transaction.insert(ocrBatchPages).values({ id: page.id, batchId: input.batchId, assetId: input.asset.id, pageOrder: page.pageOrder }).returning();
    if (replacement === undefined) throw new Error("The replacement OCR page was not created.");
    return replacement;
  });
}

function qualityPassed(asset: SourceAssetRow): boolean { return typeof asset.quality === "object" && asset.quality !== null && asset.quality.status === "passed"; }

export async function startRealOcrBatch(database: Database, input: { batchId: string; idempotencyKey: string; guardianConfirmed: boolean; retry?: boolean; enqueue: (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<string>; }) {
  if (!input.guardianConfirmed) throw new OcrBatchIntentError("Guardian and processing confirmation is required before recognition.");
  return database.transaction(async (tx) => {
    const [batch] = await tx.select().from(ocrBatches).where(eq(ocrBatches.id, input.batchId)).for("update").limit(1);
    if (batch === undefined) throw new ResourceNotFoundError("OCR batch", input.batchId);
    const prior = await idempotentRecord(tx, START_SCOPE, input.idempotencyKey);
    if (prior !== undefined) {
      if (prior.resourceId !== batch.id || prior.jobId === null) throw new OcrBatchIdempotencyError();
      return { batch, jobId: prior.jobId, replayed: true };
    }
    if (input.retry === true ? batch.status !== "retryable_error" : batch.status !== "collecting" && batch.status !== "ready") {
      throw new OcrBatchIntentError(input.retry === true ? "Only a retryable OCR batch can be retried." : "Only a collecting OCR batch can start recognition.");
    }
    const pageRows = await tx.select({ page: ocrBatchPages, asset: sourceAssets }).from(ocrBatchPages).innerJoin(sourceAssets, eq(ocrBatchPages.assetId, sourceAssets.id)).where(eq(ocrBatchPages.batchId, batch.id));
    if (pageRows.length === 0 || pageRows.some(({ asset }) => asset.processingStatus !== "succeeded" || !qualityPassed(asset))) throw new OcrBatchIntentError("Every page must pass the image quality check before recognition.");
    const jobId = await input.enqueue(tx);
    const acceptedAt = new Date();
    const [updated] = await tx.update(ocrBatches).set({ status: "processing", guardianConfirmed: true, processingNoticeVersion: REAL_OCR_PROCESSING_NOTICE_VERSION, processingNoticeAcceptedAt: acceptedAt, version: batch.version + 1, updatedAt: acceptedAt }).where(and(eq(ocrBatches.id, batch.id), eq(ocrBatches.version, batch.version))).returning();
    if (updated === undefined) throw new OcrBatchIntentError("The OCR batch changed before it could start.");
    await tx.insert(apiIdempotencyRecords).values({ id: randomUUID(), scope: START_SCOPE, idempotencyKey: input.idempotencyKey, resourceId: batch.id, jobId });
    return { batch: updated, jobId, replayed: false };
  });
}

export async function persistRealOcrPage(database: Database, input: { pageId: string; status: "succeeded" | "needs_confirmation" | "retryable_error" | "failed"; extraction?: Record<string, unknown>; failureCode?: string; }) {
  const [page] = await database.update(ocrBatchPages).set({ status: input.status, extraction: input.extraction ?? null, failureCode: input.failureCode ?? null, updatedAt: new Date() }).where(eq(ocrBatchPages.id, input.pageId)).returning();
  return page;
}

export async function syncOcrBatchPageQualityStatus(database: Database, assetId: string, status: SourceAssetRow["processingStatus"]) {
  const [page] = await database.update(ocrBatchPages).set({ status, updatedAt: new Date() }).where(eq(ocrBatchPages.assetId, assetId)).returning();
  return page;
}

export async function finishRealOcrBatch(database: Database, batchId: string) {
  const result = await findOcrBatch(database, batchId);
  if (result === undefined) throw new ResourceNotFoundError("OCR batch", batchId);
  const statuses = result.pages.map((item) => item.page.status);
  const status = statuses.some((value) => value === "retryable_error") ? "retryable_error" : statuses.some((value) => value === "failed") ? "failed" : statuses.some((value) => value === "needs_confirmation") ? "needs_confirmation" : statuses.length > 0 && statuses.every((value) => value === "succeeded") ? "needs_confirmation" : "processing";
  const [updated] = await database.update(ocrBatches).set({ status, updatedAt: new Date() }).where(eq(ocrBatches.id, batchId)).returning();
  return updated;
}
