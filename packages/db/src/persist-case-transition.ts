import type { CaseStatus } from "@gapproof/contracts";
import { and, eq } from "drizzle-orm";

import type { Database } from "./client.ts";
import {
  cases,
  learningEvidenceEvents,
  type NewLearningEvidenceEventRow,
} from "./schema.ts";

export class VersionConflictError extends Error {
  readonly code = "VERSION_CONFLICT";

  constructor(caseId: string, expectedVersion: number) {
    super(`Case ${caseId} is not at expected version ${expectedVersion}.`);
    this.name = "VersionConflictError";
  }
}

export interface PersistCaseTransitionInput {
  readonly caseId: string;
  readonly expectedVersion: number;
  readonly nextState: CaseStatus;
  readonly event: NewLearningEvidenceEventRow;
}

export interface PersistCaseTransitionResult {
  readonly applied: boolean;
  readonly state: CaseStatus;
  readonly stateVersion: number;
}

export async function persistCaseTransition(
  database: Database,
  input: PersistCaseTransitionInput,
): Promise<PersistCaseTransitionResult> {
  if (input.event.caseId !== input.caseId) {
    throw new Error("The evidence event must belong to the transitioned case.");
  }

  return database.transaction(async (transaction) => {
    const [lockedCase] = await transaction
      .select({
        state: cases.state,
        stateVersion: cases.stateVersion,
      })
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
      .where(
        eq(
          learningEvidenceEvents.idempotencyKey,
          input.event.idempotencyKey,
        ),
      )
      .limit(1);

    if (existingEvent !== undefined) {
      if (existingEvent.caseId !== input.caseId) {
        throw new Error("An idempotency key cannot be reused across cases.");
      }

      return { applied: false, ...lockedCase };
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
      .returning({
        state: cases.state,
        stateVersion: cases.stateVersion,
      });

    if (updatedCase === undefined) {
      throw new VersionConflictError(input.caseId, input.expectedVersion);
    }

    await transaction.insert(learningEvidenceEvents).values(input.event);

    return { applied: true, ...updatedCase };
  });
}
