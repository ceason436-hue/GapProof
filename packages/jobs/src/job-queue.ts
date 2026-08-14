import type {
  RetestDueJobData,
  RunNextJobData,
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
  VersionConflictError,
} from "@gapproof/db";
import { fromDrizzle, type Job, PgBoss } from "pg-boss";
import { v7 as uuidv7 } from "uuid";

export const RUN_NEXT_QUEUE = "case-run-next";
export const RETEST_DUE_QUEUE = "retest.due";

export interface EnqueueRunNextInput extends RunNextJobData {
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
