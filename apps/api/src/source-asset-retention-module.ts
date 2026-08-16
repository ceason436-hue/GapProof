import {
  findActiveCaseSourceAssets,
  findCaseById,
  markSourceAssetDeleted,
  type CaseRow,
  type Database,
  type SourceAssetRow,
} from "@gapproof/db";
import type { SourceAssetStorage } from "./source-asset-storage.ts";

export class SourceAssetDeletionNotReadyError extends Error {
  readonly code = "SOURCE_ASSET_DELETION_NOT_READY";
  constructor() {
    super("Original images can be deleted after recognition has produced reviewable content.");
  }
}

type DeletionRepository = {
  findCase(database: Pick<Database, "select">, caseId: string): Promise<CaseRow | undefined>;
  findAssets(database: Pick<Database, "select">, caseId: string): Promise<SourceAssetRow[]>;
  markDeleted(database: Database, assetId: string, deletedAt: Date): Promise<SourceAssetRow | undefined>;
};

const defaultRepository: DeletionRepository = {
  findCase: findCaseById,
  findAssets: findActiveCaseSourceAssets,
  markDeleted: markSourceAssetDeleted,
};

export async function deleteCaseSourceAssets(options: {
  readonly database: Database;
  readonly storage: SourceAssetStorage;
  readonly caseId: string;
  readonly deletedAt?: Date;
  readonly repository?: DeletionRepository;
}) {
  const repository = options.repository ?? defaultRepository;
  const caseRow = await repository.findCase(options.database, options.caseId);
  if (caseRow === undefined) return undefined;
  if (caseRow.state === "awaiting_evidence") throw new SourceAssetDeletionNotReadyError();
  const assets = await repository.findAssets(options.database, caseRow.id);
  const deletedAt = options.deletedAt ?? new Date();
  let deletedCount = 0;
  for (const asset of assets) {
    await options.storage.remove({ assetId: asset.id, objectKey: asset.objectKey });
    await repository.markDeleted(options.database, asset.id, deletedAt);
    deletedCount += 1;
  }
  return { caseId: caseRow.id, deletedCount } as const;
}
