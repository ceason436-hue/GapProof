import { describe, expect, it, vi } from "vitest";
import type { SourceAssetRow } from "@gapproof/db";
import { runSourceAssetRetentionSweep } from "./source-asset-retention-worker.ts";

const asset = (id: string): SourceAssetRow => ({
  id,
  tenantId: "0198c111-1111-7000-8000-000000000001",
  studentId: "0198c111-1111-7000-8000-000000000002",
  caseId: "0198c111-1111-7000-8000-000000000003",
  objectKey: `source-assets/tenant/student/${id}`,
  sha256: "a".repeat(64),
  mimeType: "image/png",
  byteSize: 100,
  assetType: "student_upload",
  retentionUntil: new Date("2026-08-16T00:00:00Z"),
  processingStatus: "succeeded",
  quality: null,
  createdAt: new Date("2026-08-15T00:00:00Z"),
  updatedAt: new Date("2026-08-15T00:00:00Z"),
  deletedAt: null,
});

describe("source asset retention sweep", () => {
  it("marks only source bytes that were physically removed", async () => {
    const first = asset("0198c111-1111-7000-8000-000000000011");
    const second = asset("0198c111-1111-7000-8000-000000000012");
    const markDeleted = vi.fn(async (_database, _assetId, deletedAt) => ({ ...first, deletedAt }));
    const errors: unknown[] = [];
    const result = await runSourceAssetRetentionSweep({
      database: {} as never,
      now: () => new Date("2026-08-17T00:00:00Z"),
      storage: { remove: vi.fn(async ({ assetId }) => { if (assetId === second.id) throw new Error("disk unavailable"); }) },
      repository: { findDue: vi.fn(async () => [first, second]), markDeleted },
      onError: error => errors.push(error),
    });
    expect(result).toEqual({ scannedCount: 2, deletedCount: 1 });
    expect(markDeleted).toHaveBeenCalledOnce();
    expect(markDeleted).toHaveBeenCalledWith(expect.anything(), first.id, new Date("2026-08-17T00:00:00Z"));
    expect(errors).toHaveLength(1);
  });
});
