import { describe, expect, it, vi } from "vitest";
import type { CaseRow, SourceAssetRow } from "@gapproof/db";
import { deleteCaseSourceAssets, SourceAssetDeletionNotReadyError } from "./source-asset-retention-module.ts";

const caseRow = (state: CaseRow["state"]): CaseRow => ({
  id: "0198c111-1111-7000-8000-000000000003",
  tenantId: "0198c111-1111-7000-8000-000000000001",
  studentId: "0198c111-1111-7000-8000-000000000002",
  state,
  stateVersion: 1,
  replanCount: 0,
  title: null,
  currentSkillId: null,
  simulation: false,
  synthetic: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  closedAt: null,
  deletedAt: null,
});

const sourceAsset = { id: "0198c111-1111-7000-8000-000000000004", objectKey: "source-assets/t/s/a" } as SourceAssetRow;

describe("case source asset deletion", () => {
  it("removes local bytes before writing a tombstone", async () => {
    const calls: string[] = [];
    const result = await deleteCaseSourceAssets({
      database: {} as never,
      caseId: caseRow("awaiting_confirmation").id,
      deletedAt: new Date("2026-08-16T02:00:00Z"),
      storage: { put: vi.fn(), read: vi.fn(), remove: vi.fn(async () => { calls.push("bytes"); }) },
      repository: {
        findCase: vi.fn(async () => caseRow("awaiting_confirmation")),
        findAssets: vi.fn(async () => [sourceAsset]),
        markDeleted: vi.fn(async () => { calls.push("tombstone"); return sourceAsset; }),
      },
    });
    expect(result).toEqual({ caseId: caseRow("awaiting_confirmation").id, deletedCount: 1 });
    expect(calls).toEqual(["bytes", "tombstone"]);
  });

  it("does not delete bytes while recognition may still need them", async () => {
    await expect(deleteCaseSourceAssets({
      database: {} as never,
      caseId: caseRow("awaiting_evidence").id,
      storage: { put: vi.fn(), read: vi.fn(), remove: vi.fn() },
      repository: { findCase: vi.fn(async () => caseRow("awaiting_evidence")), findAssets: vi.fn(async () => []), markDeleted: vi.fn() },
    })).rejects.toBeInstanceOf(SourceAssetDeletionNotReadyError);
  });
});
