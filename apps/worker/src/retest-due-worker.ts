import { isRetestDueJobData } from "@gapproof/contracts";
import { activateDueRetestTask, type Database } from "@gapproof/db";
import { type Clock, SystemClock } from "@gapproof/domain";
import type { JobQueue } from "@gapproof/jobs";

export interface RetestDueWorkerOptions {
  readonly database: Database;
  readonly queue: JobQueue;
  readonly clock?: Clock;
}

export function createRetestDueWorker(options: RetestDueWorkerOptions) {
  const clock = options.clock ?? new SystemClock();
  let workerId: string | undefined;

  return {
    async start() {
      workerId = await options.queue.workRetestDue(async (job) => {
        if (!isRetestDueJobData(job.data)) {
          throw new Error("The retest.due job payload is invalid.");
        }
        const result = await activateDueRetestTask(options.database, {
          caseId: job.data.caseId,
          taskId: job.data.taskId,
          effectiveNow: clock.now(),
        });
        if (!result.activated && result.reason === "not_due") {
          throw new Error(
            `Retest ${result.taskId} is not due until ${result.scheduledFor.toISOString()}.`,
          );
        }
        return result;
      });
    },
    async stop() {
      if (workerId !== undefined) {
        await options.queue.stopRetestDueWorker(workerId);
        workerId = undefined;
      }
    },
  };
}
