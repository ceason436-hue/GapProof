import { and, asc, eq, isNull, lte } from "drizzle-orm";
import type { SourceAssetQualityCheck } from "@gapproof/contracts";
import type { Database } from "./client.ts";
import { isPostgresUniqueViolation } from "./case-repository.ts";
import {
  apiIdempotencyRecords,
  cases,
  sourceAssets,
  students,
  type NewSourceAssetRow,
  type SourceAssetRow,
} from "./schema.ts";

const SOURCE_ASSET_UPLOAD_SCOPE = "source_asset_upload";

export class SourceAssetIdempotencyKeyReusedError extends Error {
  readonly code = "IDEMPOTENCY_KEY_REUSED";

  constructor() {
    super("The idempotency key was already used for different upload intent.");
    this.name = "SourceAssetIdempotencyKeyReusedError";
  }
}

export class SourceAssetNotUploadedError extends Error {
  readonly code = "SOURCE_ASSET_NOT_UPLOADED";

  constructor() {
    super("The source asset must be uploaded before preparation.");
    this.name = "SourceAssetNotUploadedError";
  }
}

export interface InitiateSourceAssetUploadInput {
  readonly assetId: string;
  readonly idempotencyRecordId: string;
  readonly idempotencyKey: string;
  readonly studentId: string;
  readonly caseId: string | null;
  readonly mimeType: NewSourceAssetRow["mimeType"];
  readonly byteSize: number;
  readonly sha256: string;
  readonly tenantId: string;
  readonly createdAt?: Date;
}

function sameUploadIntent(
  asset: typeof sourceAssets.$inferSelect,
  input: InitiateSourceAssetUploadInput,
): boolean {
  return (
    asset.studentId === input.studentId &&
    asset.caseId === input.caseId &&
    asset.mimeType === input.mimeType &&
    asset.byteSize === input.byteSize &&
    asset.sha256 === input.sha256
  );
}

async function findIdempotentAsset(
  database: Pick<Database, "select">,
  idempotencyKey: string,
) {
  const [record] = await database
    .select({ resourceId: apiIdempotencyRecords.resourceId })
    .from(apiIdempotencyRecords)
    .where(
      and(
        eq(apiIdempotencyRecords.scope, SOURCE_ASSET_UPLOAD_SCOPE),
        eq(apiIdempotencyRecords.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  if (record?.resourceId === null || record?.resourceId === undefined) {
    return undefined;
  }

  const [asset] = await database
    .select()
    .from(sourceAssets)
    .where(eq(sourceAssets.id, record.resourceId))
    .limit(1);
  return asset;
}

export async function findSourceAssetById(
  database: Pick<Database, "select">,
  assetId: string,
) {
  const [asset] = await database
    .select()
    .from(sourceAssets)
    .where(eq(sourceAssets.id, assetId))
    .limit(1);
  return asset;
}

export const CONFIRMED_SOURCE_ASSET_RETENTION_MS = 24 * 60 * 60 * 1_000;

export async function scheduleCaseSourceAssetRetention(
  database: Database,
  caseId: string,
  confirmedAt: Date,
) {
  const retentionUntil = new Date(confirmedAt.getTime() + CONFIRMED_SOURCE_ASSET_RETENTION_MS);
  return database
    .update(sourceAssets)
    .set({ retentionUntil, updatedAt: confirmedAt })
    .where(and(
      eq(sourceAssets.caseId, caseId),
      eq(sourceAssets.assetType, "student_upload"),
      isNull(sourceAssets.deletedAt),
    ))
    .returning();
}

export async function findActiveCaseSourceAssets(
  database: Pick<Database, "select">,
  caseId: string,
) {
  return database
    .select()
    .from(sourceAssets)
    .where(and(
      eq(sourceAssets.caseId, caseId),
      eq(sourceAssets.assetType, "student_upload"),
      isNull(sourceAssets.deletedAt),
    ))
    .orderBy(asc(sourceAssets.createdAt));
}

export async function findDueSourceAssets(
  database: Pick<Database, "select">,
  now: Date,
  limit = 100,
) {
  return database
    .select()
    .from(sourceAssets)
    .where(and(
      eq(sourceAssets.assetType, "student_upload"),
      isNull(sourceAssets.deletedAt),
      lte(sourceAssets.retentionUntil, now),
    ))
    .orderBy(asc(sourceAssets.retentionUntil))
    .limit(limit);
}

export async function markSourceAssetDeleted(
  database: Database,
  assetId: string,
  deletedAt: Date,
) {
  const [asset] = await database
    .update(sourceAssets)
    .set({
      deletedAt,
      objectKey: `deleted-source-assets/${assetId}`,
      sha256: "0".repeat(64),
      mimeType: "application/octet-stream",
      byteSize: 1,
      quality: null,
      updatedAt: deletedAt,
    })
    .where(and(eq(sourceAssets.id, assetId), isNull(sourceAssets.deletedAt)))
    .returning();
  return asset ?? (await findSourceAssetById(database, assetId));
}

export async function initiateSourceAssetUpload(
  database: Database,
  input: InitiateSourceAssetUploadInput,
) {
  const existing = await findIdempotentAsset(database, input.idempotencyKey);
  if (existing !== undefined) {
    if (!sameUploadIntent(existing, input)) {
      throw new SourceAssetIdempotencyKeyReusedError();
    }
    return { asset: existing, replayed: true } as const;
  }

  const assetId = input.assetId;
  const createdAt = input.createdAt ?? new Date();
  const retentionUntil = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1_000);
  const objectKey = `source-assets/${input.tenantId}/${input.studentId}/${assetId}`;
  const values: NewSourceAssetRow = {
    id: assetId,
    tenantId: input.tenantId,
    studentId: input.studentId,
    caseId: input.caseId,
    objectKey,
    sha256: input.sha256,
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    assetType: "student_upload",
    createdAt,
    retentionUntil,
  };

  try {
    return await database.transaction(async (transaction) => {
      const transactionExisting = await findIdempotentAsset(
        transaction,
        input.idempotencyKey,
      );
      if (transactionExisting !== undefined) {
        if (!sameUploadIntent(transactionExisting, input)) {
          throw new SourceAssetIdempotencyKeyReusedError();
        }
        return { asset: transactionExisting, replayed: true } as const;
      }

      const [asset] = await transaction
        .insert(sourceAssets)
        .values(values)
        .returning();
      if (asset === undefined) {
        throw new Error("The source asset was not created.");
      }

      await transaction.insert(apiIdempotencyRecords).values({
        id: input.idempotencyRecordId,
        scope: SOURCE_ASSET_UPLOAD_SCOPE,
        idempotencyKey: input.idempotencyKey,
        resourceId: asset.id,
      });

      return { asset, replayed: false } as const;
    });
  } catch (error) {
    if (!isPostgresUniqueViolation(error)) {
      throw error;
    }
    const raced = await findIdempotentAsset(database, input.idempotencyKey);
    if (raced === undefined) {
      throw error;
    }
    if (!sameUploadIntent(raced, input)) {
      throw new SourceAssetIdempotencyKeyReusedError();
    }
    return { asset: raced, replayed: true } as const;
  }
}

export async function markSourceAssetUploaded(
  database: Database,
  assetId: string,
) {
  const [updated] = await database
    .update(sourceAssets)
    .set({ processingStatus: "uploaded", updatedAt: new Date() })
    .where(
      and(
        eq(sourceAssets.id, assetId),
        eq(sourceAssets.processingStatus, "pending_upload"),
      ),
    )
    .returning();
  return updated ?? (await findSourceAssetById(database, assetId));
}

export async function updateSourceAssetInspection(
  database: Database,
  input: {
    readonly assetId: string;
    readonly from: SourceAssetRow["processingStatus"];
    readonly to: SourceAssetRow["processingStatus"];
    readonly quality?: SourceAssetQualityCheck | null;
  },
) {
  const [updated] = await database
    .update(sourceAssets)
    .set({
      processingStatus: input.to,
      ...(input.quality === undefined ? {} : { quality: input.quality }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sourceAssets.id, input.assetId),
        eq(sourceAssets.processingStatus, input.from),
      ),
    )
    .returning();
  return updated ?? (await findSourceAssetById(database, input.assetId));
}

export async function findUploadStudentAndCase(
  database: Pick<Database, "select">,
  input: Pick<InitiateSourceAssetUploadInput, "studentId" | "caseId">,
) {
  const [student] = await database
    .select()
    .from(students)
    .where(eq(students.id, input.studentId))
    .limit(1);
  let caseRow: typeof cases.$inferSelect | undefined;
  if (input.caseId !== null) {
    [caseRow] = await database
      .select()
      .from(cases)
      .where(eq(cases.id, input.caseId))
      .limit(1);
  }
  return { student, caseRow };
}
