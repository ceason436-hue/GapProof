import type {
  ReplanJobData,
  RetestDueJobData,
  RunNextJobData,
  SourceAssetQualityCheckJobData,
} from "@gapproof/contracts";
import {
  apiIdempotencyRecords,
  and,
  cases,
  eq,
  isPostgresUniqueViolation,
  sql,
  type Database,
  ResourceNotFoundError,
  SourceAssetIdempotencyKeyReusedError,
  SourceAssetNotUploadedError,
  sourceAssets,
  VersionConflictError,
} from "@gapproof/db";
import { fromDrizzle, type Job, PgBoss } from "pg-boss";
import { v7 as uuidv7 } from "uuid";

export const RUN_NEXT_QUEUE = "case-run-next";
export const RETEST_DUE_QUEUE = "retest.due";
export const REPLAN_QUEUE = "case.replan";
export const SOURCE_ASSET_QUALITY_CHECK_QUEUE = "source_asset.quality_check";

export interface EnqueueRunNextInput extends RunNextJobData {
  readonly idempotencyKey: string;
}

export interface EnqueueSourceAssetQualityCheckInput extends SourceAssetQualityCheckJobData {
  readonly idempotencyKey: string;
}

export class JobQueue {
  readonly boss: PgBoss;

  constructor(databaseUrl: string) {
    this.boss = new PgBoss({
      connectionString: databaseUrl,
      application_name: "gapproof-jobs",
      useListenNotify: true,
    });
    this.boss.on("error", () => {
      // Runtime entrypoints attach structured logging. Tests intentionally stay quiet.
    });
  }

  async start(): Promise<void> {
    await this.boss.start();
    await this.boss.createQueue(RUN_NEXT_QUEUE);
    await this.boss.createQueue(RETEST_DUE_QUEUE);
    await this.boss.createQueue(REPLAN_QUEUE);
    await this.boss.createQueue(SOURCE_ASSET_QUALITY_CHECK_QUEUE);
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 5_000 });
  }

  async workRunNext(
    handler: (job: Job<RunNextJobData>) => Promise<object>,
  ): Promise<string> {
    return this.boss.work<RunNextJobData, object>(
      RUN_NEXT_QUEUE,
      { batchSize: 1, pollingIntervalSeconds: 1 },
      async ([job]) => {
        if (job === undefined) {
          throw new Error("pg-boss delivered an empty run-next batch.");
        }
        return handler(job);
      },
    );
  }

  async stopWorker(workerId: string): Promise<void> {
    await this.boss.offWork(RUN_NEXT_QUEUE, { id: workerId, wait: true });
  }

  async workRetestDue(
    handler: (job: Job<RetestDueJobData>) => Promise<object>,
  ): Promise<string> {
    return this.boss.work<RetestDueJobData, object>(
      RETEST_DUE_QUEUE,
      { batchSize: 1, pollingIntervalSeconds: 1 },
      async ([job]) => {
        if (job === undefined) {
          throw new Error("pg-boss delivered an empty retest.due batch.");
        }
        return handler(job);
      },
    );
  }

  async stopRetestDueWorker(workerId: string): Promise<void> {
    await this.boss.offWork(RETEST_DUE_QUEUE, { id: workerId, wait: true });
  }

  async workReplan(
    handler: (job: Job<ReplanJobData>) => Promise<object>,
  ): Promise<string> {
    return this.boss.work<ReplanJobData, object>(
      REPLAN_QUEUE,
      { batchSize: 1, pollingIntervalSeconds: 1 },
      async ([job]) => {
        if (job === undefined) {
          throw new Error("pg-boss delivered an empty case.replan batch.");
        }
        return handler(job);
      },
    );
  }

  async stopReplanWorker(workerId: string): Promise<void> {
    await this.boss.offWork(REPLAN_QUEUE, { id: workerId, wait: true });
  }

  async workSourceAssetQualityCheck(
    handler: (job: Job<SourceAssetQualityCheckJobData>) => Promise<object>,
  ): Promise<string> {
    return this.boss.work<SourceAssetQualityCheckJobData, object>(
      SOURCE_ASSET_QUALITY_CHECK_QUEUE,
      { batchSize: 1, pollingIntervalSeconds: 1 },
      async ([job]) => {
        if (job === undefined) throw new Error("pg-boss delivered an empty source asset batch.");
        return handler(job);
      },
    );
  }

  async stopSourceAssetQualityCheckWorker(workerId: string): Promise<void> {
    await this.boss.offWork(SOURCE_ASSET_QUALITY_CHECK_QUEUE, { id: workerId, wait: true });
  }
}

export function createJobQueue(databaseUrl: string): JobQueue {
  return new JobQueue(databaseUrl);
}

export interface EnqueueRetestDueInput extends RetestDueJobData {
  readonly startAfter: Date;
}

export async function enqueueRetestDueTransactional(
  database: Parameters<Parameters<Database["transaction"]>[0]>[0],
  queue: JobQueue,
  input: EnqueueRetestDueInput,
) {
  const jobId = await queue.boss.send(
    RETEST_DUE_QUEUE,
    { caseId: input.caseId, taskId: input.taskId } satisfies RetestDueJobData,
    {
      id: input.taskId,
      startAfter: input.startAfter,
      retryLimit: 10,
      retryDelay: 1,
      retryBackoff: true,
      retryDelayMax: 60,
      db: fromDrizzle(database, sql),
    },
  );
  if (jobId === null) {
    throw new Error("pg-boss did not enqueue the retest.due job transactionally.");
  }
  return jobId;
}

export interface EnqueueReplanInput extends ReplanJobData {
  readonly jobId: string;
}

export async function enqueueReplanTransactional(
  database: Parameters<Parameters<Database["transaction"]>[0]>[0],
  queue: JobQueue,
  input: EnqueueReplanInput,
) {
  const jobId = await queue.boss.send(
    REPLAN_QUEUE,
    {
      caseId: input.caseId,
      triggerEventId: input.triggerEventId,
      expectedVersion: input.expectedVersion,
      traceId: input.traceId,
      interventionJobId: input.interventionJobId,
    } satisfies ReplanJobData,
    {
      id: input.jobId,
      retryLimit: 5,
      retryDelay: 1,
      retryBackoff: true,
      retryDelayMax: 30,
      db: fromDrizzle(database, sql),
    },
  );
  if (jobId === null) {
    throw new Error("pg-boss did not enqueue the case.replan job transactionally.");
  }
  return jobId;
}

export interface EnqueueRunNextTransactionalInput extends RunNextJobData {
  readonly jobId: string;
}

export async function enqueueRunNextTransactional(
  database: Parameters<Parameters<Database["transaction"]>[0]>[0],
  queue: JobQueue,
  input: EnqueueRunNextTransactionalInput,
) {
  const jobId = await queue.boss.send(
    RUN_NEXT_QUEUE,
    {
      caseId: input.caseId,
      expectedVersion: input.expectedVersion,
      assetId: input.assetId,
      traceId: input.traceId,
    } satisfies RunNextJobData,
    {
      id: input.jobId,
      retryLimit: 2,
      retryDelay: 1,
      retryBackoff: true,
      db: fromDrizzle(database, sql),
    },
  );
  if (jobId === null) {
    throw new Error("pg-boss did not enqueue the run-next job transactionally.");
  }
  return jobId;
}

export async function enqueueRunNextIdempotent(
  database: Database,
  queue: JobQueue,
  input: EnqueueRunNextInput,
) {
  try {
    return await database.transaction(async (transaction) => {
    const [existing] = await transaction
      .select({
        resourceId: apiIdempotencyRecords.resourceId,
        jobId: apiIdempotencyRecords.jobId,
      })
      .from(apiIdempotencyRecords)
      .where(
        and(
          eq(apiIdempotencyRecords.scope, "run_next"),
          eq(apiIdempotencyRecords.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);

    if (existing !== undefined) {
      if (existing.resourceId !== input.caseId || existing.jobId === null) {
        throw new Error("The idempotency key belongs to another run-next request.");
      }
      return { jobId: existing.jobId, replayed: true } as const;
    }

    const [caseRow] = await transaction
      .select({ stateVersion: cases.stateVersion })
      .from(cases)
      .where(eq(cases.id, input.caseId))
      .limit(1);

    if (caseRow === undefined) {
      throw new ResourceNotFoundError("Case", input.caseId);
    }
    if (caseRow.stateVersion !== input.expectedVersion) {
      throw new VersionConflictError(input.caseId, input.expectedVersion);
    }

    const jobId = uuidv7();
    const sentJobId = await queue.boss.send(
      RUN_NEXT_QUEUE,
      {
        caseId: input.caseId,
        expectedVersion: input.expectedVersion,
        assetId: input.assetId,
        traceId: input.traceId,
      } satisfies RunNextJobData,
      {
        id: jobId,
        retryLimit: 2,
        retryDelay: 1,
        retryBackoff: true,
        db: fromDrizzle(transaction, sql),
      },
    );

    if (sentJobId === null) {
      throw new Error("pg-boss did not enqueue the run-next job.");
    }

    await transaction.insert(apiIdempotencyRecords).values({
      id: uuidv7(),
      scope: "run_next",
      idempotencyKey: input.idempotencyKey,
      resourceId: input.caseId,
      jobId: sentJobId,
    });

      return { jobId: sentJobId, replayed: false } as const;
    });
  } catch (error) {
    if (!isPostgresUniqueViolation(error)) {
      throw error;
    }

    const [record] = await database
      .select({
        resourceId: apiIdempotencyRecords.resourceId,
        jobId: apiIdempotencyRecords.jobId,
      })
      .from(apiIdempotencyRecords)
      .where(
        and(
          eq(apiIdempotencyRecords.scope, "run_next"),
          eq(apiIdempotencyRecords.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);

    if (record?.resourceId !== input.caseId || record.jobId === null) {
      throw error;
    }
    return { jobId: record.jobId, replayed: true } as const;
  }
}

export async function enqueueSourceAssetQualityCheckIdempotent(
  database: Database,
  queue: JobQueue,
  input: EnqueueSourceAssetQualityCheckInput,
) {
  const jobId = input.assetId;
  try {
    return await database.transaction(async (transaction) => {
      const [existingKey] = await transaction
        .select({ resourceId: apiIdempotencyRecords.resourceId, jobId: apiIdempotencyRecords.jobId })
        .from(apiIdempotencyRecords)
        .where(and(eq(apiIdempotencyRecords.scope, "source_asset_prepare"), eq(apiIdempotencyRecords.idempotencyKey, input.idempotencyKey)))
        .limit(1);
      if (existingKey !== undefined && existingKey.resourceId !== input.assetId) throw new SourceAssetIdempotencyKeyReusedError();

      const [asset] = await transaction.select().from(sourceAssets).where(eq(sourceAssets.id, input.assetId)).for("update").limit(1);
      if (asset === undefined) throw new ResourceNotFoundError("Source asset", input.assetId);
      if (asset.deletedAt !== null) throw new ResourceNotFoundError("Source asset", input.assetId);
      if (existingKey !== undefined) return { asset, jobId: existingKey.jobId ?? undefined, replayed: true } as const;
      if (asset.processingStatus !== "uploaded") {
        if (asset.processingStatus === "pending_upload") throw new SourceAssetNotUploadedError();
        return {
          asset,
          jobId: asset.processingStatus === "queued" ? asset.id : undefined,
          replayed: true,
        } as const;
      }

      const [queued] = await transaction.update(sourceAssets)
        .set({ processingStatus: "queued", quality: null, updatedAt: new Date() })
        .where(and(eq(sourceAssets.id, input.assetId), eq(sourceAssets.processingStatus, "uploaded")))
        .returning();
      if (queued === undefined) throw new Error("The source asset could not be queued.");
      const sent = await queue.boss.send(SOURCE_ASSET_QUALITY_CHECK_QUEUE, { assetId: input.assetId } satisfies SourceAssetQualityCheckJobData, { id: jobId, retryLimit: 3, retryDelay: 1, retryBackoff: true, db: fromDrizzle(transaction, sql) });
      if (sent === null) throw new Error("The source asset quality check job was not queued.");
      await transaction.insert(apiIdempotencyRecords).values({ id: uuidv7(), scope: "source_asset_prepare", idempotencyKey: input.idempotencyKey, resourceId: input.assetId, jobId: sent });
      return { asset: queued, jobId: sent, replayed: false } as const;
    });
  } catch (error) {
    if (!isPostgresUniqueViolation(error)) throw error;
    const [record] = await database.select({ resourceId: apiIdempotencyRecords.resourceId, jobId: apiIdempotencyRecords.jobId }).from(apiIdempotencyRecords).where(and(eq(apiIdempotencyRecords.scope, "source_asset_prepare"), eq(apiIdempotencyRecords.idempotencyKey, input.idempotencyKey))).limit(1);
    if (record?.resourceId !== input.assetId) throw new SourceAssetIdempotencyKeyReusedError();
    const asset = await database.select().from(sourceAssets).where(eq(sourceAssets.id, input.assetId)).limit(1);
    return { asset: asset[0], jobId: record.jobId ?? undefined, replayed: true } as const;
  }
}
