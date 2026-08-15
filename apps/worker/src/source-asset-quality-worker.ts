import { createHash } from "node:crypto";

import {
  findSourceAssetById,
  inspectImageHeaders,
  updateSourceAssetInspection,
  type Database,
} from "@gapproof/db";
import type { JobQueue } from "@gapproof/jobs";
import { SOURCE_ASSET_QUALITY_CHECK_QUEUE } from "@gapproof/jobs";

type ReadableSourceAssetStorage = {
  read(input: { readonly assetId: string; readonly objectKey: string }): Promise<Buffer>;
};

export interface SourceAssetQualityWorkerOptions {
  readonly database: Database;
  readonly queue: JobQueue;
  readonly storage: ReadableSourceAssetStorage;
}

export function createSourceAssetQualityWorker(options: SourceAssetQualityWorkerOptions) {
  let workerId: string | undefined;
  return {
    async start() {
      workerId = await options.queue.workSourceAssetQualityCheck(async (job) => {
        const asset = await findSourceAssetById(options.database, job.data.assetId);
        if (asset === undefined) throw new Error(`Source asset ${job.data.assetId} was not found.`);
        if (asset.processingStatus !== "queued" && asset.processingStatus !== "retryable_error") {
          return { assetId: asset.id, status: asset.processingStatus };
        }
        const processing = await updateSourceAssetInspection(options.database, {
          assetId: asset.id,
          from: asset.processingStatus,
          to: "processing",
          quality: null,
        });
        if (processing?.processingStatus !== "processing") return { assetId: asset.id, status: processing?.processingStatus ?? "missing" };

        let bytes: Buffer;
        try {
          bytes = await options.storage.read({ assetId: asset.id, objectKey: asset.objectKey });
        } catch (error) {
          if (isMissingFile(error)) {
            await updateSourceAssetInspection(options.database, { assetId: asset.id, from: "processing", to: "failed", quality: { status: "failed", detectedMimeType: null, width: null, height: null, reasons: ["stored_bytes_missing"], checkerVersion: "image-header-v1" } });
            return { assetId: asset.id, status: "failed" };
          }
          await updateSourceAssetInspection(options.database, { assetId: asset.id, from: "processing", to: "retryable_error", quality: null });
          throw error;
        }
        if (bytes.byteLength !== asset.byteSize || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
          await updateSourceAssetInspection(options.database, { assetId: asset.id, from: "processing", to: "failed", quality: { status: "failed", detectedMimeType: null, width: null, height: null, reasons: ["stored_bytes_mismatch"], checkerVersion: "image-header-v1" } });
          return { assetId: asset.id, status: "failed" };
        }
        const quality = inspectImageHeaders(bytes, asset.mimeType as "image/jpeg" | "image/png" | "image/webp");
        const status = quality.status === "passed" ? "succeeded" : quality.status;
        await updateSourceAssetInspection(options.database, { assetId: asset.id, from: "processing", to: status, quality });
        return { assetId: asset.id, status };
      });
      return workerId;
    },
    async stop() {
      if (workerId !== undefined) {
        await options.queue.stopSourceAssetQualityCheckWorker(workerId);
        workerId = undefined;
      }
    },
  };
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
