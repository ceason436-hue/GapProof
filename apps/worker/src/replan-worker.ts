import { isReplanJobData, type ReplanStrategy } from "@gapproof/contracts";
import {
  findCaseById,
  findEvidenceEventByIdempotencyKey,
  findLatestCaseEvidenceEventByType,
  persistCaseTransition,
  type Database,
} from "@gapproof/db";
import { type Clock, SystemClock, transitionCase } from "@gapproof/domain";
import {
  enqueueRunNextTransactional,
  type JobQueue,
} from "@gapproof/jobs";
import { v7 as uuidv7 } from "uuid";

export interface ReplanWorkerOptions {
  readonly database: Database;
  readonly queue: JobQueue;
  readonly clock?: Clock;
}

export function createReplanWorker(options: ReplanWorkerOptions) {
  const clock = options.clock ?? new SystemClock();
  let workerId: string | undefined;

  return {
    async start() {
      workerId = await options.queue.workReplan(async (job) => {
        if (!isReplanJobData(job.data)) {
          throw new Error("The case.replan job payload is invalid.");
        }
        const idempotencyKey = `replan-job:${job.id}`;
        const existing = await findEvidenceEventByIdempotencyKey(
          options.database,
          idempotencyKey,
        );
        const caseRow = await findCaseById(options.database, job.data.caseId);
        if (caseRow === undefined) {
          throw new Error(`Case ${job.data.caseId} was not found.`);
        }
        if (existing !== undefined) {
          return {
            caseId: caseRow.id,
            state: caseRow.state,
            stateVersion: caseRow.stateVersion,
            idempotentReplay: true,
          };
        }
        const trigger = await findLatestCaseEvidenceEventByType(
          options.database,
          caseRow.id,
          "retest_evaluated",
        );
        if (trigger?.id !== job.data.triggerEventId) {
          throw new Error("RETEST_EVALUATION_EVIDENCE_NOT_FOUND");
        }
        if (caseRow.state !== "replan_required" || caseRow.replanCount >= 2) {
          throw new Error("REPLAN_CAP_REACHED");
        }

        const occurredAt = clock.now();
        const replanIndex = (caseRow.replanCount + 1) as 1 | 2;
        const strategy: ReplanStrategy = replanIndex === 1
          ? "alternate_explanation_and_practice"
          : "prerequisite_skill_with_example";
        const event = {
          eventId: uuidv7(),
          occurredAt: occurredAt.toISOString(),
          type: "plan_replanned" as const,
          replanIndex,
          strategy,
        };
        const next = transitionCase(
          {
            id: caseRow.id,
            status: caseRow.state,
            mastery: "insufficient_evidence",
            version: caseRow.stateVersion,
            replanCount: caseRow.replanCount,
            appliedEventIds: [],
          },
          event,
        );
        const persisted = await persistCaseTransition(options.database, {
          caseId: caseRow.id,
          expectedVersion: job.data.expectedVersion,
          nextState: next.status,
          nextReplanCount: next.replanCount,
          event: {
            id: event.eventId,
            tenantId: caseRow.tenantId,
            studentId: caseRow.studentId,
            caseId: caseRow.id,
            eventType: event.type,
            sourceType: "replan_worker",
            sourceRef: trigger.id,
            payload: {
              triggerEventId: trigger.id,
              interventionJobId: job.data.interventionJobId,
              replanIndex,
              strategy,
            },
            occurredAt,
            idempotencyKey,
          },
          afterPersist: async (transaction) => {
            await enqueueRunNextTransactional(transaction, options.queue, {
              jobId: job.data.interventionJobId,
              caseId: caseRow.id,
              expectedVersion: next.version,
              assetId: `replan:${trigger.id}`,
              traceId: job.data.traceId,
            });
          },
        });
        return {
          caseId: caseRow.id,
          state: persisted.state,
          stateVersion: persisted.stateVersion,
          interventionJobId: job.data.interventionJobId,
          idempotentReplay: false,
        };
      });
      return workerId;
    },
    async stop() {
      if (workerId !== undefined) {
        await options.queue.stopReplanWorker(workerId);
        workerId = undefined;
      }
    },
  };
}
