import type {
  DemoClockAdvanceRequest,
  DemoClockAdvanceView,
} from "@gapproof/contracts";
import { and, eq, lte } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";

import type { Database } from "./client.ts";
import {
  findEvidenceEventByIdempotencyKey,
  ResourceNotFoundError,
} from "./case-repository.ts";
import {
  cases,
  demoClocks,
  learningEvidenceEvents,
  type LearningEvidenceEventRow,
  tasks,
} from "./schema.ts";

export class DemoClockVersionConflictError extends Error {
  readonly code = "VERSION_CONFLICT";
  readonly details: {
    readonly resource: "demo_clock";
    readonly resourceId: string;
    readonly expected: number;
    readonly actual: number;
  };

  constructor(clockId: string, expected: number, actual: number) {
    super(
      `Demo clock ${clockId} is at version ${actual}, not expected version ${expected}.`,
    );
    this.name = "DemoClockVersionConflictError";
    this.details = {
      resource: "demo_clock",
      resourceId: clockId,
      expected,
      actual,
    };
  }
}

export class DemoClockMismatchError extends Error {
  readonly code = "DEMO_CLOCK_MISMATCH";

  constructor(caseId: string, clockId: string) {
    super(`Demo clock ${clockId} is not the authoritative clock for Case ${caseId}.`);
    this.name = "DemoClockMismatchError";
  }
}

export class DemoClockIdempotencyKeyReusedError extends Error {
  readonly code = "IDEMPOTENCY_KEY_REUSED";

  constructor() {
    super("The idempotency key belongs to another write request.");
    this.name = "DemoClockIdempotencyKeyReusedError";
  }
}

export class DemoCaseRequiredError extends Error {
  readonly code = "DEMO_CASE_REQUIRED";

  constructor(caseId: string) {
    super(`Case ${caseId} is not enabled for simulation.`);
    this.name = "DemoCaseRequiredError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function replayFromEvent(
  event: LearningEvidenceEventRow,
  input: Pick<AdvanceDemoClockInput, "caseId" | "request">,
): DemoClockAdvanceView {
  if (
    event.caseId !== input.caseId ||
    event.eventType !== "demo_clock_advanced" ||
    !isRecord(event.payload.request) ||
    !isDeepStrictEqual(event.payload.request, input.request)
  ) {
    throw new DemoClockIdempotencyKeyReusedError();
  }
  const result = event.payload.result;
  if (
    !isRecord(result) ||
    typeof result.caseId !== "string" ||
    typeof result.clockId !== "string" ||
    !Number.isInteger(result.clockVersion) ||
    typeof result.previousEffectiveNow !== "string" ||
    typeof result.effectiveNow !== "string" ||
    !Array.isArray(result.activatedTaskIds) ||
    result.activatedTaskIds.some((id) => typeof id !== "string")
  ) {
    throw new Error("The stored demo clock audit event is invalid.");
  }
  return result as unknown as DemoClockAdvanceView;
}

export interface AdvanceDemoClockInput {
  readonly caseId: string;
  readonly idempotencyKey: string;
  readonly eventId: string;
  readonly baseNow: Date;
  readonly request: DemoClockAdvanceRequest;
}

export interface AdvanceDemoClockResult {
  readonly replayed: boolean;
  readonly response: DemoClockAdvanceView;
}

export async function advanceDemoClock(
  database: Database,
  input: AdvanceDemoClockInput,
): Promise<AdvanceDemoClockResult> {
  try {
    return await database.transaction(async (transaction) => {
      const [caseRow] = await transaction
        .select({
          id: cases.id,
          tenantId: cases.tenantId,
          studentId: cases.studentId,
          simulation: cases.simulation,
        })
        .from(cases)
        .where(eq(cases.id, input.caseId))
        .for("update")
        .limit(1);
      if (caseRow === undefined) {
        throw new ResourceNotFoundError("Case", input.caseId);
      }
      if (!caseRow.simulation) {
        throw new DemoCaseRequiredError(input.caseId);
      }

      const [existingEvent] = await transaction
        .select()
        .from(learningEvidenceEvents)
        .where(eq(learningEvidenceEvents.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existingEvent !== undefined) {
        return {
          replayed: true,
          response: replayFromEvent(existingEvent, input),
        };
      }

      let [clockRow] = await transaction
        .select()
        .from(demoClocks)
        .where(eq(demoClocks.caseId, input.caseId))
        .for("update")
        .limit(1);

      if (clockRow === undefined) {
        if (input.request.expectedClockVersion !== 0) {
          throw new DemoClockVersionConflictError(
            input.request.clockId,
            input.request.expectedClockVersion,
            0,
          );
        }
        await transaction
          .insert(demoClocks)
          .values({
            id: input.request.clockId,
            caseId: input.caseId,
            effectiveNow: input.baseNow,
          })
          .onConflictDoNothing();
        [clockRow] = await transaction
          .select()
          .from(demoClocks)
          .where(eq(demoClocks.caseId, input.caseId))
          .for("update")
          .limit(1);
        if (clockRow === undefined) {
          throw new DemoClockMismatchError(input.caseId, input.request.clockId);
        }
      }

      if (clockRow.id !== input.request.clockId) {
        throw new DemoClockMismatchError(input.caseId, input.request.clockId);
      }
      if (clockRow.clockVersion !== input.request.expectedClockVersion) {
        throw new DemoClockVersionConflictError(
          clockRow.id,
          input.request.expectedClockVersion,
          clockRow.clockVersion,
        );
      }

      const previousEffectiveNow = clockRow.effectiveNow;
      const effectiveNow = new Date(
        previousEffectiveNow.getTime() + input.request.advanceBySeconds * 1_000,
      );
      const activatedTasks = await transaction
        .update(tasks)
        .set({ status: "ready" })
        .where(
          and(
            eq(tasks.caseId, input.caseId),
            eq(tasks.taskType, "d1_retest"),
            eq(tasks.status, "scheduled"),
            lte(tasks.scheduledFor, effectiveNow),
          ),
        )
        .returning({ id: tasks.id });
      const activatedTaskIds = activatedTasks
        .map(({ id }) => id)
        .sort((left, right) => left.localeCompare(right));
      const response: DemoClockAdvanceView = {
        caseId: input.caseId,
        clockId: clockRow.id,
        clockVersion: clockRow.clockVersion + 1,
        previousEffectiveNow: previousEffectiveNow.toISOString(),
        effectiveNow: effectiveNow.toISOString(),
        activatedTaskIds,
      };

      await transaction
        .update(demoClocks)
        .set({
          clockVersion: response.clockVersion,
          effectiveNow,
          updatedAt: input.baseNow,
        })
        .where(eq(demoClocks.id, clockRow.id));
      await transaction.insert(learningEvidenceEvents).values({
        id: input.eventId,
        tenantId: caseRow.tenantId,
        studentId: caseRow.studentId,
        caseId: caseRow.id,
        eventType: "demo_clock_advanced",
        sourceType: "demo_clock",
        sourceRef: clockRow.id,
        occurredAt: input.baseNow,
        idempotencyKey: input.idempotencyKey,
        payload: {
          request: input.request,
          result: response,
          audit: {
            simulation: true,
            clockId: clockRow.id,
            previousEffectiveNow: response.previousEffectiveNow,
            effectiveNow: response.effectiveNow,
            activatedTaskIds,
          },
        },
      });

      return { replayed: false, response };
    });
  } catch (error) {
    const existingEvent = await findEvidenceEventByIdempotencyKey(
      database,
      input.idempotencyKey,
    );
    if (existingEvent === undefined) {
      throw error;
    }
    return {
      replayed: true,
      response: replayFromEvent(existingEvent, input),
    };
  }
}
