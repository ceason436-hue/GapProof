import type { CaseStatus } from "@gapproof/contracts";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "./client.ts";
import { ResourceNotFoundError } from "./case-repository.ts";
import { VersionConflictError } from "./persist-case-transition.ts";
import {
  cases,
  learningEvidenceEvents,
  type NewLearningEvidenceEventRow,
  type NewTaskRow,
  students,
  tasks,
} from "./schema.ts";

type TaskQueryDatabase = Pick<Database, "select">;

export async function findTaskById(
  database: TaskQueryDatabase,
  taskId: string,
) {
  const [row] = await database
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return row;
}

export async function findTasksByStudentId(
  database: TaskQueryDatabase,
  studentId: string,
) {
  return database
    .select()
    .from(tasks)
    .where(eq(tasks.studentId, studentId))
    .orderBy(
      sql`${tasks.dueAt} asc nulls last`,
      sql`case ${tasks.taskType}
        when 'd1_retest' then 1
        when 'd7_retest' then 2
        when 'guided_intervention' then 3
        else 4
      end`,
      asc(tasks.createdAt),
      asc(tasks.id),
    );
}

export async function findCurrentActionableTaskId(
  database: TaskQueryDatabase,
  studentId: string,
) {
  const [row] = await database
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.studentId, studentId),
        eq(tasks.status, "ready"),
        inArray(tasks.taskType, ["d1_retest", "d7_retest", "guided_intervention"]),
      ),
    )
    .orderBy(
      sql`${tasks.dueAt} asc nulls last`,
      sql`case ${tasks.taskType}
        when 'd1_retest' then 1
        when 'd7_retest' then 2
        when 'guided_intervention' then 3
        else 4
      end`,
      asc(tasks.createdAt),
      asc(tasks.id),
    )
    .limit(1);
  return row?.id ?? null;
}

export async function findStudentById(
  database: TaskQueryDatabase,
  studentId: string,
) {
  const [row] = await database
    .select()
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  return row;
}

interface TaskTransitionBase {
  readonly caseId: string;
  readonly expectedVersion: number;
  readonly nextState: CaseStatus;
  readonly event: NewLearningEvidenceEventRow;
}

export interface PersistGeneratedInterventionInput extends TaskTransitionBase {
  readonly task: NewTaskRow;
}

export async function persistGeneratedIntervention(
  database: Database,
  input: PersistGeneratedInterventionInput,
) {
  if (
    input.event.caseId !== input.caseId ||
    input.task.caseId !== input.caseId ||
    input.task.sourceEventId !== input.event.id
  ) {
    throw new Error("The generated intervention records must share a case and event.");
  }

  return database.transaction(async (transaction) => {
    const [lockedCase] = await transaction
      .select({ state: cases.state, stateVersion: cases.stateVersion })
      .from(cases)
      .where(eq(cases.id, input.caseId))
      .for("update")
      .limit(1);
    if (lockedCase === undefined) {
      throw new VersionConflictError(input.caseId, input.expectedVersion);
    }

    const [existingEvent] = await transaction
      .select({ caseId: learningEvidenceEvents.caseId })
      .from(learningEvidenceEvents)
      .where(eq(learningEvidenceEvents.idempotencyKey, input.event.idempotencyKey))
      .limit(1);
    if (existingEvent !== undefined) {
      if (existingEvent.caseId !== input.caseId) {
        throw new Error("An idempotency key cannot be reused across cases.");
      }
      return { applied: false, ...lockedCase } as const;
    }
    if (lockedCase.stateVersion !== input.expectedVersion) {
      throw new VersionConflictError(input.caseId, input.expectedVersion);
    }

    const [updatedCase] = await transaction
      .update(cases)
      .set({
        state: input.nextState,
        stateVersion: input.expectedVersion + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(cases.id, input.caseId),
          eq(cases.stateVersion, input.expectedVersion),
        ),
      )
      .returning({ state: cases.state, stateVersion: cases.stateVersion });
    if (updatedCase === undefined) {
      throw new VersionConflictError(input.caseId, input.expectedVersion);
    }

    await transaction.insert(learningEvidenceEvents).values(input.event);
    await transaction.insert(tasks).values(input.task);
    return { applied: true, ...updatedCase } as const;
  });
}

export interface CompleteInterventionTaskInput extends TaskTransitionBase {
  readonly taskId: string;
  readonly completedAt: Date;
  readonly d1Task: NewTaskRow;
  readonly scheduleD1Retest?: (
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    task: NewTaskRow,
  ) => Promise<void>;
}

export async function completeInterventionTask(
  database: Database,
  input: CompleteInterventionTaskInput,
) {
  if (
    input.event.caseId !== input.caseId ||
    input.d1Task.caseId !== input.caseId ||
    input.d1Task.sourceEventId !== input.event.id
  ) {
    throw new Error("The completion records must share a case and event.");
  }

  return database.transaction(async (transaction) => {
    const [lockedCase] = await transaction
      .select({ state: cases.state, stateVersion: cases.stateVersion })
      .from(cases)
      .where(eq(cases.id, input.caseId))
      .for("update")
      .limit(1);
    if (lockedCase === undefined) {
      throw new VersionConflictError(input.caseId, input.expectedVersion);
    }

    const [existingEvent] = await transaction
      .select({ caseId: learningEvidenceEvents.caseId })
      .from(learningEvidenceEvents)
      .where(eq(learningEvidenceEvents.idempotencyKey, input.event.idempotencyKey))
      .limit(1);
    if (existingEvent !== undefined) {
      if (existingEvent.caseId !== input.caseId) {
        throw new Error("An idempotency key cannot be reused across cases.");
      }
      return { applied: false, ...lockedCase } as const;
    }
    if (lockedCase.stateVersion !== input.expectedVersion) {
      throw new VersionConflictError(input.caseId, input.expectedVersion);
    }

    const [lockedTask] = await transaction
      .select({ caseId: tasks.caseId, status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, input.taskId))
      .for("update")
      .limit(1);
    if (lockedTask === undefined) {
      throw new ResourceNotFoundError("Task", input.taskId);
    }
    if (lockedTask.caseId !== input.caseId || lockedTask.status !== "ready") {
      throw new Error("The intervention task is not ready for completion.");
    }

    const [updatedCase] = await transaction
      .update(cases)
      .set({
        state: input.nextState,
        stateVersion: input.expectedVersion + 1,
        updatedAt: input.completedAt,
      })
      .where(
        and(
          eq(cases.id, input.caseId),
          eq(cases.stateVersion, input.expectedVersion),
        ),
      )
      .returning({ state: cases.state, stateVersion: cases.stateVersion });
    if (updatedCase === undefined) {
      throw new VersionConflictError(input.caseId, input.expectedVersion);
    }

    await transaction.insert(learningEvidenceEvents).values(input.event);
    await transaction
      .update(tasks)
      .set({ status: "completed", completedAt: input.completedAt })
      .where(eq(tasks.id, input.taskId));
    await transaction.insert(tasks).values(input.d1Task);
    await input.scheduleD1Retest?.(transaction, input.d1Task);

    return { applied: true, ...updatedCase } as const;
  });
}
