import type {
  CaseAggregate,
  CaseEvent,
  CaseStatus,
  MasteryStatus,
} from "@gapproof/contracts";

export type CaseTransitionErrorCode =
  | "invalid_transition"
  | "invariant_violation";

export class CaseTransitionError extends Error {
  readonly code: CaseTransitionErrorCode;

  constructor(code: CaseTransitionErrorCode, message: string) {
    super(message);
    this.name = "CaseTransitionError";
    this.code = code;
  }
}

export function createCase(id: string): CaseAggregate {
  if (id.length === 0) {
    throw new CaseTransitionError(
      "invariant_violation",
      "A case id must not be empty.",
    );
  }

  return {
    id,
    status: "awaiting_evidence",
    mastery: "insufficient_evidence",
    version: 0,
    replanCount: 0,
    appliedEventIds: [],
  };
}

function requireStatus(
  aggregate: CaseAggregate,
  event: CaseEvent,
  expected: CaseStatus,
): void {
  if (aggregate.status !== expected) {
    throw new CaseTransitionError(
      "invalid_transition",
      `Event ${event.type} requires ${expected}, received ${aggregate.status}.`,
    );
  }
}

function advance(
  aggregate: CaseAggregate,
  event: CaseEvent,
  status: CaseStatus,
  mastery: MasteryStatus = aggregate.mastery,
  replanCount = aggregate.replanCount,
): CaseAggregate {
  return {
    ...aggregate,
    status,
    mastery,
    replanCount,
    version: aggregate.version + 1,
    appliedEventIds: [...aggregate.appliedEventIds, event.eventId],
  };
}

export function transitionCase(
  aggregate: CaseAggregate,
  event: CaseEvent,
): CaseAggregate {
  if (aggregate.appliedEventIds.includes(event.eventId)) {
    return aggregate;
  }

  switch (event.type) {
    case "evidence_ingested": {
      requireStatus(aggregate, event, "awaiting_evidence");
      return advance(
        aggregate,
        event,
        event.lowConfidenceRegionCount > 0
          ? "awaiting_confirmation"
          : "ready_for_diagnosis",
      );
    }

    case "recognition_confirmed": {
      requireStatus(aggregate, event, "awaiting_confirmation");
      return advance(aggregate, event, "ready_for_diagnosis");
    }

    case "hypotheses_generated": {
      requireStatus(aggregate, event, "ready_for_diagnosis");
      if (new Set(event.hypothesisIds).size < 2) {
        throw new CaseTransitionError(
          "invariant_violation",
          "At least two distinct competing hypotheses are required.",
        );
      }
      return advance(aggregate, event, "probe_required");
    }

    case "probe_evaluated": {
      requireStatus(aggregate, event, "probe_required");
      return advance(aggregate, event, "intervention_ready");
    }

    case "intervention_completed": {
      requireStatus(aggregate, event, "intervention_ready");
      return advance(aggregate, event, "d1_scheduled", "pending_retest");
    }

    case "retest_evaluated": {
      const expectedStatus = event.kind === "d1" ? "d1_scheduled" : "d7_scheduled";
      requireStatus(aggregate, event, expectedStatus);

      if (!event.passed) {
        return advance(
          aggregate,
          event,
          "replan_required",
          "insufficient_evidence",
        );
      }

      return event.kind === "d1"
        ? advance(aggregate, event, "d7_scheduled", "pending_retest")
        : advance(aggregate, event, "report_ready", "repaired");
    }

    case "plan_replanned": {
      requireStatus(aggregate, event, "replan_required");
      return advance(
        aggregate,
        event,
        "intervention_ready",
        "insufficient_evidence",
        aggregate.replanCount + 1,
      );
    }
  }
}

