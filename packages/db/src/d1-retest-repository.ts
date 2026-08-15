import type { CaseStatus } from "@gapproof/contracts";
import { and, eq } from "drizzle-orm";

import type { Database } from "./client.ts";
import { ResourceNotFoundError } from "./case-repository.ts";
import { VersionConflictError } from "./persist-case-transition.ts";
import {
  cases,
  learningEvidenceEvents,
  type NewLearningEvidenceEventRow,
  type NewTaskRow,
  tasks,
} from "./schema.ts";

export class InvalidTaskStateError extends Error {
  readonly code = "INVALID_TASK_STATE";

  constructor(message: string) {
    super(message);
    this.name = "InvalidTaskStateError";
  }
}

export interface PersistD1RetestEvaluationInput {
  readonly caseId: string;
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly nextState: CaseStatus;
  readonly evaluatedAt: Date;
  readonly event: NewLearningEvidenceEventRow;
  readonly d7Task?: NewTaskRow;
  /** D1 is the compatibility default; D7 uses the same atomic evaluator. */
  readonly kind?: "d1" | "d7";
  readonly enqueueFollowUp: (
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
  ) => Promise<void>;
}

export async function persistD1RetestEvaluation(
  database: Database,
  input: PersistD1RetestEvaluationInput,
) {
  if (
    input.event.caseId !== input.caseId ||
    (input.d7Task !== undefined &&
      (input.d7Task.caseId !== input.caseId ||
        input.d7Task.sourceEventId !== input.event.id))
  ) {
    throw new Error("The D1 evaluation records must share a case and event.");
  }

  return database.transaction(async (transaction) => {
    const [lockedCase] = await transaction
      .select({ state: cases.state, stateVersion: cases.stateVersion, replanCount: cases.replanCount })
      .from(cases)
      .where(eq(cases.id, input.caseId))
      .for("update")
      .limit(1);
    if (lockedCase === undefined) {
      throw new ResourceNotFoundError("Case", input.caseId);
    }

    const [existingEvent] = await transaction
      .select({ caseId: learningEvidenceEvents.caseId })
      .from(learningEvidenceEvents)
      .where(eq(learningEvidenceEvents.idempotencyKey, input.event.idempotencyKey))
      .limit(1);
    if (existingEvent !== undefined) {
      return { applied: false, ...lockedCase } as const;
    }
    if (lockedCase.stateVersion !== input.expectedVersion) {
      throw new VersionConflictError(input.caseId, input.expectedVersion);
    }
    const kind = input.kind ?? "d1";
    const expectedState = kind === "d1" ? "d1_scheduled" : "d7_scheduled";
    const expectedTaskType = kind === "d1" ? "d1_retest" : "d7_retest";
    if (lockedCase.state !== expectedState) {
      throw new InvalidTaskStateError(`The Case is not awaiting a ${kind.toUpperCase()} retest.`);
    }

    const [lockedTask] = await transaction
      .select({ caseId: tasks.caseId, taskType: tasks.taskType, status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, input.taskId))
      .for("update")
      .limit(1);
    if (lockedTask === undefined) {
      throw new ResourceNotFoundError("Task", input.taskId);
    }
    if (
      lockedTask.caseId !== input.caseId ||
      lockedTask.taskType !== expectedTaskType ||
      lockedTask.status !== "ready"
    ) {
      throw new InvalidTaskStateError(`Only a ready ${kind.toUpperCase()} retest can be submitted.`);
    }

    const [updatedCase] = await transaction
      .update(cases)
      .set({
        state: input.nextState,
        stateVersion: input.expectedVersion + 1,
        updatedAt: input.evaluatedAt,
      })
      .where(and(eq(cases.id, input.caseId), eq(cases.stateVersion, input.expectedVersion)))
      .returning({ state: cases.state, stateVersion: cases.stateVersion, replanCount: cases.replanCount });
    if (updatedCase === undefined) {
      throw new VersionConflictError(input.caseId, input.expectedVersion);
    }

    await transaction.insert(learningEvidenceEvents).values(input.event);
    await transaction
      .update(tasks)
      .set({ status: "completed", completedAt: input.evaluatedAt })
      .where(and(eq(tasks.id, input.taskId), eq(tasks.status, "ready")));
    if (input.d7Task !== undefined) {
      await transaction.insert(tasks).values(input.d7Task);
    }
    await input.enqueueFollowUp(transaction);
    return { applied: true, ...updatedCase } as const;
  });
}
