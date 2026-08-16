import type { SocraticTutorContext, SocraticTutorOutput } from "@gapproof/contracts";
import { isUuidV7, TUTOR_MAX_TURNS_PER_DAY, TUTOR_MAX_TURNS_PER_TASK } from "@gapproof/contracts";
import { and, count, desc, eq, gte, inArray } from "drizzle-orm";

import type { Database } from "./client.ts";
import { tasks, tutorSessions, tutorTurns } from "./schema.ts";

export class TutorTurnRejectedError extends Error {
  constructor(readonly code: "INVALID_IDENTITY" | "TASK_NOT_READY" | "TASK_LIMIT_REACHED" | "DAILY_LIMIT_REACHED" | "TURN_ALREADY_PENDING" | "IDEMPOTENCY_KEY_REUSED") {
    super(code);
    this.name = "TutorTurnRejectedError";
  }
}

export function tutorTurnLimitDecision(taskTurnCount: number, rollingDayTurnCount: number, hasPending: boolean): TutorTurnRejectedError["code"] | null {
  if (taskTurnCount >= TUTOR_MAX_TURNS_PER_TASK) return "TASK_LIMIT_REACHED";
  if (rollingDayTurnCount >= TUTOR_MAX_TURNS_PER_DAY) return "DAILY_LIMIT_REACHED";
  if (hasPending) return "TURN_ALREADY_PENDING";
  return null;
}

export interface QueueTutorTurnInput {
  readonly turnId: string;
  readonly sessionId: string;
  readonly tenantId: string;
  readonly studentId: string;
  readonly caseId: string;
  readonly taskId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly context: SocraticTutorContext;
  readonly policyVersion: string;
  readonly now: Date;
}

export async function queueTutorTurn(database: Database, input: QueueTutorTurnInput) {
  if (!isUuidV7(input.turnId) || !isUuidV7(input.sessionId) || !isUuidV7(input.idempotencyKey)) {
    throw new TutorTurnRejectedError("INVALID_IDENTITY");
  }
  return database.transaction(async (transaction) => {
    const [existing] = await transaction.select().from(tutorTurns).where(and(
      eq(tutorTurns.studentId, input.studentId),
      eq(tutorTurns.idempotencyKey, input.idempotencyKey),
    )).limit(1);
    if (existing !== undefined) {
      if (existing.taskId !== input.taskId || existing.requestHash !== input.requestHash) {
        throw new TutorTurnRejectedError("IDEMPOTENCY_KEY_REUSED");
      }
      return { turn: existing, replayed: true } as const;
    }

    const [task] = await transaction.select().from(tasks).where(eq(tasks.id, input.taskId)).for("update").limit(1);
    if (task === undefined || task.tenantId !== input.tenantId || task.studentId !== input.studentId || task.caseId !== input.caseId || task.taskType !== "guided_intervention" || task.status !== "ready") {
      throw new TutorTurnRejectedError("TASK_NOT_READY");
    }

    let [session] = await transaction.select().from(tutorSessions).where(eq(tutorSessions.taskId, input.taskId)).limit(1);
    if (session === undefined) {
      [session] = await transaction.insert(tutorSessions).values({
        id: input.sessionId,
        tenantId: input.tenantId,
        studentId: input.studentId,
        caseId: input.caseId,
        taskId: input.taskId,
        status: "active",
        policyVersion: input.policyVersion,
        createdAt: input.now,
        updatedAt: input.now,
      }).returning();
    }
    if (session === undefined || session.status !== "active" || session.studentId !== input.studentId || session.policyVersion !== input.policyVersion) {
      throw new TutorTurnRejectedError("TASK_NOT_READY");
    }

    const [[taskCount], [dayCount], [pending]] = await Promise.all([
      transaction.select({ value: count() }).from(tutorTurns).where(eq(tutorTurns.sessionId, session.id)),
      transaction.select({ value: count() }).from(tutorTurns).where(and(
        eq(tutorTurns.studentId, input.studentId),
        gte(tutorTurns.createdAt, new Date(input.now.getTime() - 24 * 60 * 60 * 1_000)),
      )),
      transaction.select({ id: tutorTurns.id }).from(tutorTurns).where(and(
        eq(tutorTurns.sessionId, session.id),
        inArray(tutorTurns.status, ["queued", "running"]),
      )).limit(1),
    ]);
    const limitRejection = tutorTurnLimitDecision(taskCount?.value ?? 0, dayCount?.value ?? 0, pending !== undefined);
    if (limitRejection !== null) throw new TutorTurnRejectedError(limitRejection);

    const [turn] = await transaction.insert(tutorTurns).values({
      id: input.turnId,
      sessionId: session.id,
      studentId: input.studentId,
      taskId: input.taskId,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      status: "queued",
      context: input.context,
      response: null,
      createdAt: input.now,
      updatedAt: input.now,
    }).returning();
    if (turn === undefined) throw new Error("Tutor turn was not persisted.");
    await transaction.update(tutorSessions).set({ updatedAt: input.now }).where(eq(tutorSessions.id, session.id));
    return { turn, replayed: false } as const;
  });
}

export async function findTutorTurn(database: Database, turnId: string) {
  const [turn] = await database.select().from(tutorTurns).where(eq(tutorTurns.id, turnId)).limit(1);
  return turn;
}

export async function findLatestTutorTurn(database: Database, taskId: string, studentId: string) {
  const [turn] = await database.select().from(tutorTurns)
    .where(and(eq(tutorTurns.taskId, taskId), eq(tutorTurns.studentId, studentId)))
    .orderBy(desc(tutorTurns.createdAt)).limit(1);
  return turn;
}

export async function claimTutorTurn(database: Database, turnId: string, now = new Date()) {
  const [turn] = await database.update(tutorTurns).set({ status: "running", updatedAt: now })
    .where(and(eq(tutorTurns.id, turnId), eq(tutorTurns.status, "queued"))).returning();
  return turn;
}

export async function finishTutorTurn(database: Database, input: {
  readonly turnId: string;
  readonly status: "succeeded" | "fallback";
  readonly response: SocraticTutorOutput;
  readonly provider: "deepseek" | "rule_fallback";
  readonly model?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly errorCode?: string;
  readonly now?: Date;
}) {
  const now = input.now ?? new Date();
  const [turn] = await database.update(tutorTurns).set({
    status: input.status,
    response: input.response,
    provider: input.provider,
    model: input.model ?? null,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    errorCode: input.errorCode ?? null,
    completedAt: now,
    updatedAt: now,
  }).where(and(eq(tutorTurns.id, input.turnId), eq(tutorTurns.status, "running"))).returning();
  return turn;
}

export async function failTutorTurn(database: Database, turnId: string, errorCode: string, now = new Date()) {
  const [turn] = await database.update(tutorTurns).set({
    status: "failed",
    response: null,
    provider: null,
    model: null,
    errorCode,
    completedAt: now,
    updatedAt: now,
  }).where(and(eq(tutorTurns.id, turnId), eq(tutorTurns.status, "running"))).returning();
  return turn;
}
