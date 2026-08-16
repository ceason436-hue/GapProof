import { describe, expect, it, vi } from "vitest";

import type { Database } from "./client.ts";
import { findRecoverableOcrBatchesForStudent, recoverableOcrBatchStatuses } from "./device-session-repository.ts";

describe("device-session OCR recovery repository", () => {
  it("includes failed batches and maps them to retry recovery", async () => {
    const failedBatch = {
      id: "0198c111-1111-7000-8000-000000000001",
      caseId: "0198c111-1111-7000-8000-000000000002",
      status: "failed",
      updatedAt: new Date("2026-08-16T08:00:00.000Z"),
    };
    const select = vi.fn()
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn().mockResolvedValue([failedBatch]) })) })) })
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ id: "0198c111-1111-7000-8000-000000000003" }]) })) });

    expect(recoverableOcrBatchStatuses).toContain("failed");
    await expect(findRecoverableOcrBatchesForStudent({ select } as unknown as Pick<Database, "select">, "0198c111-1111-7000-8000-000000000004")).resolves.toEqual([{
      batchId: failedBatch.id,
      caseId: failedBatch.caseId,
      status: "failed",
      pageCount: 1,
      resumeKind: "retry",
      updatedAt: failedBatch.updatedAt,
    }]);
  });
});
