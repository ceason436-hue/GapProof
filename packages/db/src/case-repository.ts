import { and, desc, eq, isNull } from "drizzle-orm";

import type { Database } from "./client.ts";
import {
  apiIdempotencyRecords,
  cases,
  learningEvidenceEvents,
  sourceAssets,
  students,
} from "./schema.ts";
import { v7 as uuidv7 } from "uuid";

export class ResourceNotFoundError extends Error {
  readonly code = "RESOURCE_NOT_FOUND";

  constructor(resource: string, id: string) {
    super(`${resource} ${id} was not found.`);
    this.name = "ResourceNotFoundError";
  }
}

export class SyntheticRecognitionNotReadyError extends Error {
  readonly code = "SOURCE_ASSET_RECOGNITION_NOT_READY";

  constructor(message = "The source asset is not ready for synthetic recognition.") {
    super(message);
    this.name = "SyntheticRecognitionNotReadyError";
  }
}

export class SourceAssetAlreadyBoundError extends Error {
  readonly code = "SOURCE_ASSET_ALREADY_BOUND";

  constructor() {
    super("The source asset is already bound to a Case.");
    this.name = "SourceAssetAlreadyBoundError";
  }
}

export class SyntheticRecognitionIdempotencyKeyReusedError extends Error {
  readonly code = "IDEMPOTENCY_KEY_REUSED";

  constructor() {
    super("The idempotency key was already used for another recognition asset.");
    this.name = "SyntheticRecognitionIdempotencyKeyReusedError";
  }
}

const START_RECOGNITION_SCOPE = "source_asset_start_recognition";

export interface StartSyntheticRecognitionInput {
  readonly assetId: string;
  readonly idempotencyKey: string;
  readonly idempotencyRecordId: string;
  readonly enqueueRunNext: (
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    caseId: string,
  ) => Promise<string>;
}

function isPassedQuality(value: unknown): boolean {
  return typeof value === "object" && value !== null &&
    !Array.isArray(value) && "status" in value && value.status === "passed";
}

async function findStartRecognitionRecord(
  database: Pick<Database, "select">,
  idempotencyKey: string,
) {
  const [record] = await database
    .select({ resourceId: apiIdempotencyRecords.resourceId, jobId: apiIdempotencyRecords.jobId })
    .from(apiIdempotencyRecords)
    .where(and(
      eq(apiIdempotencyRecords.scope, START_RECOGNITION_SCOPE),
      eq(apiIdempotencyRecords.idempotencyKey, idempotencyKey),
    ))
    .limit(1);
  return record;
}

export async function startSyntheticRecognitionIdempotent(
  database: Database,
  input: StartSyntheticRecognitionInput,
) {
  return database.transaction(async (transaction) => {
    const existing = await findStartRecognitionRecord(transaction, input.idempotencyKey);
    if (existing !== undefined && existing.resourceId !== input.assetId) {
      throw new SyntheticRecognitionIdempotencyKeyReusedError();
    }

    const [asset] = await transaction
      .select()
      .from(sourceAssets)
      .where(eq(sourceAssets.id, input.assetId))
      .for("update")
      .limit(1);
    if (asset === undefined) throw new ResourceNotFoundError("Source asset", input.assetId);

    const lockedExisting = existing ?? await findStartRecognitionRecord(transaction, input.idempotencyKey);
    if (lockedExisting !== undefined) {
      if (lockedExisting.resourceId !== input.assetId) throw new SyntheticRecognitionIdempotencyKeyReusedError();
      if (asset.caseId === null || lockedExisting.jobId === null) {
        throw new Error("The synthetic recognition idempotency record is incomplete.");
      }
      const existingCase = await findCaseById(transaction, asset.caseId);
      if (existingCase === undefined) throw new ResourceNotFoundError("Case", asset.caseId);
      return { asset, case: existingCase, jobId: lockedExisting.jobId, replayed: true } as const;
    }

    if (
      asset.deletedAt !== null ||
      asset.studentId === null ||
      asset.caseId !== null ||
      asset.assetType !== "student_upload" ||
      asset.processingStatus !== "succeeded" ||
      !isPassedQuality(asset.quality)
    ) {
      if (asset.caseId !== null) throw new SourceAssetAlreadyBoundError();
      throw new SyntheticRecognitionNotReadyError();
    }

    const [student] = await transaction
      .select()
      .from(students)
      .where(eq(students.id, asset.studentId))
      .limit(1);
    if (
      student === undefined ||
      student.status === "deleted" ||
      student.deletedAt !== null ||
      student.tenantId !== asset.tenantId
    ) {
      throw new SyntheticRecognitionNotReadyError("The source asset student ownership is invalid.");
    }

    const caseId = uuidv7();
    const [createdCase] = await transaction
      .insert(cases)
      .values({
        id: caseId,
        tenantId: asset.tenantId,
        studentId: student.id,
        title: "合成 OCR 演示",
        simulation: true,
        synthetic: true,
      })
      .returning();
    if (createdCase === undefined) throw new Error("The synthetic recognition Case was not created.");

    const [boundAsset] = await transaction
      .update(sourceAssets)
      .set({ caseId, updatedAt: new Date() })
      .where(and(eq(sourceAssets.id, asset.id), isNull(sourceAssets.caseId)))
      .returning();
    if (boundAsset === undefined) throw new SourceAssetAlreadyBoundError();

    const jobId = await input.enqueueRunNext(transaction, caseId);
    await transaction.insert(apiIdempotencyRecords).values({
      id: input.idempotencyRecordId,
      scope: START_RECOGNITION_SCOPE,
      idempotencyKey: input.idempotencyKey,
      resourceId: asset.id,
      jobId,
    });
    return { asset: boundAsset, case: createdCase, jobId, replayed: false } as const;
  });
}

export interface CreateSyntheticCaseInput {
  readonly idempotencyRecordId: string;
  readonly idempotencyKey: string;
  readonly tenantId: string;
  readonly studentId: string;
  readonly caseId: string;
}

export async function createSyntheticCaseIdempotent(
  database: Database,
  input: CreateSyntheticCaseInput,
) {
  try {
    return await database.transaction(async (transaction) => {
    const [existingRecord] = await transaction
      .select({ resourceId: apiIdempotencyRecords.resourceId })
      .from(apiIdempotencyRecords)
      .where(
        and(
          eq(apiIdempotencyRecords.scope, "create_case"),
          eq(apiIdempotencyRecords.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);

    if (existingRecord?.resourceId !== null && existingRecord?.resourceId !== undefined) {
      const existingCase = await findCaseById(transaction, existingRecord.resourceId);
      if (existingCase === undefined) {
        throw new ResourceNotFoundError("Case", existingRecord.resourceId);
      }
      return { case: existingCase, replayed: true } as const;
    }

    await transaction.insert(students).values({
      id: input.studentId,
      tenantId: input.tenantId,
      anonymousKey: `synthetic:${input.caseId}`,
      grade: "8",
      region: "Shanghai",
      curriculumVersion: "unverified-demo-v1",
    });

    const [createdCase] = await transaction
      .insert(cases)
      .values({
        id: input.caseId,
        tenantId: input.tenantId,
        studentId: input.studentId,
        title: "不规则过去分词原创合成案例",
        simulation: true,
        synthetic: true,
      })
      .returning();

    if (createdCase === undefined) {
      throw new Error("The synthetic case was not created.");
    }

    await transaction.insert(apiIdempotencyRecords).values({
      id: input.idempotencyRecordId,
      scope: "create_case",
      idempotencyKey: input.idempotencyKey,
      resourceId: input.caseId,
    });

      return { case: createdCase, replayed: false } as const;
    });
  } catch (error) {
    if (!isPostgresUniqueViolation(error)) {
      throw error;
    }

    const [record] = await database
      .select({ resourceId: apiIdempotencyRecords.resourceId })
      .from(apiIdempotencyRecords)
      .where(
        and(
          eq(apiIdempotencyRecords.scope, "create_case"),
          eq(apiIdempotencyRecords.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (record?.resourceId === null || record?.resourceId === undefined) {
      throw error;
    }

    const replayedCase = await findCaseById(database, record.resourceId);
    if (replayedCase === undefined) {
      throw error;
    }
    return { case: replayedCase, replayed: true } as const;
  }
}

export function isPostgresUniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) {
      return false;
    }
    if ("code" in current && current.code === "23505") {
      return true;
    }
    current = "cause" in current ? current.cause : undefined;
  }

  return false;
}

type CaseQueryDatabase = Pick<Database, "select">;

export async function findCaseById(
  database: CaseQueryDatabase,
  caseId: string,
) {
  const [row] = await database
    .select()
    .from(cases)
    .where(eq(cases.id, caseId))
    .limit(1);

  return row;
}

export async function findEvidenceEventByIdempotencyKey(
  database: CaseQueryDatabase,
  idempotencyKey: string,
) {
  const [row] = await database
    .select()
    .from(learningEvidenceEvents)
    .where(eq(learningEvidenceEvents.idempotencyKey, idempotencyKey))
    .limit(1);

  return row;
}

export async function findLatestCaseEvidenceEventByType(
  database: CaseQueryDatabase,
  caseId: string,
  eventType: typeof learningEvidenceEvents.$inferSelect.eventType,
) {
  const [row] = await database
    .select()
    .from(learningEvidenceEvents)
    .where(
      and(
        eq(learningEvidenceEvents.caseId, caseId),
        eq(learningEvidenceEvents.eventType, eventType),
      ),
    )
    .orderBy(desc(learningEvidenceEvents.occurredAt))
    .limit(1);

  return row;
}
