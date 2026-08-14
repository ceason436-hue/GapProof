import { and, eq, lte } from "drizzle-orm";

import type { Database } from "./client.ts";
import { ResourceNotFoundError } from "./case-repository.ts";
import { tasks } from "./schema.ts";

export interface ActivateDueRetestTaskInput {
  readonly caseId: string;
  readonly taskId: string;
  readonly effectiveNow: Date;
}

export async function activateDueRetestTask(
  database: Database,
  input: ActivateDueRetestTaskInput,
) {
  return database.transaction(async (transaction) => {
    const [task] = await transaction
      .select({
        id: tasks.id,
        caseId: tasks.caseId,
        taskType: tasks.taskType,
        status: tasks.status,
        scheduledFor: tasks.scheduledFor,
      })
      .from(tasks)
      .where(eq(tasks.id, input.taskId))
      .for("update")
      .limit(1);
    if (task === undefined) {
      throw new ResourceNotFoundError("Task", input.taskId);
    }
    if (task.caseId !== input.caseId || task.taskType !== "d1_retest") {
      throw new Error("The retest.due job does not match a D+1 task.");
    }
    if (task.status !== "scheduled") {
      return {
        activated: false,
        reason: "not_scheduled",
        taskId: task.id,
        scheduledFor: task.scheduledFor,
      } as const;
    }
    if (task.scheduledFor > input.effectiveNow) {
      return {
        activated: false,
        reason: "not_due",
        taskId: task.id,
        scheduledFor: task.scheduledFor,
      } as const;
    }

    const [activated] = await transaction
      .update(tasks)
      .set({ status: "ready" })
      .where(
        and(
          eq(tasks.id, task.id),
          eq(tasks.status, "scheduled"),
          lte(tasks.scheduledFor, input.effectiveNow),
        ),
      )
      .returning({ id: tasks.id });
    return {
      activated: activated !== undefined,
      reason: activated === undefined ? "not_scheduled" : "activated",
      taskId: task.id,
      scheduledFor: task.scheduledFor,
    } as const;
  });
}
