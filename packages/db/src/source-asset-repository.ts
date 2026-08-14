import { and, eq } from "drizzle-orm";
import type { Database } from "./client.ts";
import { isPostgresUniqueViolation } from "./case-repository.ts";
import {
  apiIdempotencyRecords,
  cases,
  sourceAssets,
  students,
  type NewSourceAssetRow,
} from "./schema.ts";

const SOURCE_ASSET_UPLOAD_SCOPE = "source_asset_upload";

export class SourceAssetIdempotencyKeyReusedError extends Error {
  readonly code = "IDEMPOTENCY_KEY_REUSED";

  constructor() {
    super("The idempotency key was already used for different upload intent.");
    this.name = "SourceAssetIdempotencyKeyReusedError";
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
    .set({ processingStatus: "uploaded" })
    .where(
      and(
        eq(sourceAssets.id, assetId),
        eq(sourceAssets.processingStatus, "pending_upload"),
      ),
    )
    .returning();
  return updated ?? (await findSourceAssetById(database, assetId));
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
