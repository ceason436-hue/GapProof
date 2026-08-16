import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import {
  findOcrBatch,
  finishRealOcrBatch,
  persistRealOcrPage,
  persistCaseTransition,
  cases,
  eq,
  type Database,
} from "@gapproof/db";
import { transitionCase } from "@gapproof/domain";
import { createAlibabaEduPaperSdkTransportFromEnv } from "@gapproof/tools";
import type { JobQueue } from "@gapproof/jobs";

type SourceStorage = { read(input: { readonly assetId: string; readonly objectKey: string }): Promise<Buffer> };
type Transport = { executeBody(input: { readonly body: Readable; readonly timeoutMs: number; readonly signal: AbortSignal }): Promise<{ status: number; payload: unknown }> };

export interface RealOcrBatchWorkerOptions {
  readonly database: Database;
  readonly queue: JobQueue;
  readonly storage: SourceStorage;
  readonly transport?: Transport;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export function providerOutcome(status: number): { status: "retryable_error" | "failed"; code: string } {
  if (status === 408) return { status: "retryable_error", code: "PROVIDER_TIMEOUT" };
  if (status === 429) return { status: "retryable_error", code: "RATE_LIMITED" };
  if (status >= 500) return { status: "retryable_error", code: "PROVIDER_UNAVAILABLE" };
  if (status === 401 || status === 403) return { status: "failed", code: "PERMISSION_DENIED" };
  return { status: "failed", code: "PROVIDER_REJECTED" };
}

export function normalizedExtraction(value: unknown, order: number): { extraction: Record<string, unknown>; needsReview: boolean } {
  if (typeof value !== "object" || value === null || !Array.isArray((value as { items?: unknown }).items)) {
    return { extraction: { page: order, items: [], reviewRequired: true }, needsReview: true };
  }
  const parsed = value as { items: Array<{ id?: unknown; prompt?: unknown; confidence?: unknown }> };
  const items = parsed.items.flatMap((item, index) => typeof item.prompt === "string" && item.prompt.trim().length > 0 ? [{ id: `item-${index + 1}`, prompt: item.prompt.trim() }] : []);
  const lowConfidence = parsed.items.some((item) => typeof item.confidence !== "number" || item.confidence < 0.8);
  return { extraction: { page: order, items, reviewRequired: lowConfidence || items.length === 0 }, needsReview: lowConfidence || items.length === 0 };
}

export function createRealOcrBatchWorker(options: RealOcrBatchWorkerOptions) {
  let workerId: string | undefined;
  const transport = options.transport ?? createAlibabaEduPaperSdkTransportFromEnv(options.env ?? process.env);
  return {
    async start() {
      workerId = await options.queue.workRealOcrBatch(async (job) => {
        const batch = await findOcrBatch(options.database, job.data.batchId);
        if (batch === undefined) throw new Error(`OCR batch ${job.data.batchId} was not found.`);
        if (!batch.batch.guardianConfirmed) return { batchId: batch.batch.id, status: "confirmation_required" };
        for (const { page, asset } of batch.pages) {
          // A retry only sends pages with an unresolved provider result, never re-bills confirmed pages.
          if (page.status === "failed") continue;
          if (page.extraction !== null && (page.status === "succeeded" || page.status === "needs_confirmation")) continue;
          if (asset.processingStatus !== "succeeded") {
            await persistRealOcrPage(options.database, { pageId: page.id, status: "failed", failureCode: "PAGE_NOT_QUALIFIED" });
            continue;
          }
          try {
            const bytes = await options.storage.read({ assetId: asset.id, objectKey: asset.objectKey });
            if (bytes.byteLength !== asset.byteSize || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
              await persistRealOcrPage(options.database, { pageId: page.id, status: "failed", failureCode: "STORED_BYTES_MISMATCH" });
              continue;
            }
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15_000);
            try {
              const response = await transport.executeBody({ body: Readable.from(bytes), timeoutMs: 15_000, signal: controller.signal });
              if (response.status < 200 || response.status > 299) {
                const outcome = providerOutcome(response.status);
                await persistRealOcrPage(options.database, { pageId: page.id, status: outcome.status, failureCode: outcome.code });
                continue;
              }
              const normalized = normalizedExtraction(response.payload, page.pageOrder);
              await persistRealOcrPage(options.database, { pageId: page.id, status: normalized.needsReview ? "needs_confirmation" : "succeeded", extraction: normalized.extraction });
            } finally { clearTimeout(timer); }
          } catch {
            await persistRealOcrPage(options.database, { pageId: page.id, status: "retryable_error", failureCode: "PROVIDER_TRANSPORT_ERROR" });
          }
        }
        const finished = await finishRealOcrBatch(options.database, batch.batch.id);
        const aggregate = await findOcrBatch(options.database, batch.batch.id);
        if (
          aggregate !== undefined &&
          aggregate.batch.status === "needs_confirmation" &&
          aggregate.batch.guardianConfirmed &&
          aggregate.pages.length > 0 &&
          aggregate.pages.every(({ page }) => page.status === "succeeded" || page.status === "needs_confirmation")
        ) {
          const items = aggregate.pages.flatMap(({ page }) => {
            const raw = page.extraction?.items;
            if (!Array.isArray(raw)) return [];
            return raw.flatMap((item, index) =>
              typeof item === "object" && item !== null && typeof (item as { prompt?: unknown }).prompt === "string"
                ? [{ itemId: `page-${page.pageOrder}-item-${index + 1}`, prompt: (item as { prompt: string }).prompt }]
                : []);
          });
          if (items.length > 0 && aggregate.batch.caseId === batch.batch.caseId) {
            const caseRow = await options.database.select().from(cases).where(eq(cases.id, aggregate.batch.caseId)).limit(1);
            const row = caseRow[0];
            if (row?.state === "awaiting_evidence") {
              const eventId = uuidv7();
              const occurredAt = new Date();
              const lowConfidenceRegionCount = aggregate.pages.filter(({ page }) => page.status === "needs_confirmation").length;
              const next = transitionCase({ id: row.id, status: row.state, mastery: "insufficient_evidence", version: row.stateVersion, replanCount: row.replanCount, appliedEventIds: [] }, { eventId, occurredAt: occurredAt.toISOString(), type: "evidence_ingested", lowConfidenceRegionCount, requiresConfirmation: true });
              await persistCaseTransition(options.database, {
                caseId: row.id, expectedVersion: row.stateVersion, nextState: next.status,
                event: { id: eventId, tenantId: row.tenantId, studentId: row.studentId, caseId: row.id, eventType: "evidence_ingested", sourceType: "real_alibaba_ocr", sourceRef: aggregate.batch.id, payload: { extraction: { items }, recognitionSource: "real_alibaba", uploadedAssetUsedForRecognition: true, lowConfidenceRegionCount }, confidence: null, occurredAt, idempotencyKey: `real-ocr-batch:${aggregate.batch.id}` },
              });
            }
          }
        }
        return { batchId: batch.batch.id, status: finished?.status ?? "missing" };
      });
      return workerId;
    },
    async stop() { if (workerId !== undefined) { await options.queue.stopRealOcrBatchWorker(workerId); workerId = undefined; } },
  };
}
