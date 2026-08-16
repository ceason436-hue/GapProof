import { describe, expect, it } from "vitest";

import type { CaseEvent } from "@gapproof/contracts";

import { CaseTransitionError, createCase, transitionCase } from "./case-machine.ts";

const occurredAt = "2026-08-14T10:00:00.000Z";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, Extract<K, keyof T>>
  : never;

type CaseEventInput = DistributiveOmit<CaseEvent, "occurredAt">;

function event<T extends CaseEventInput>(
  value: T,
): T & { occurredAt: string } {
  return { ...value, occurredAt };
}

function reachInterventionReady() {
  let aggregate = createCase("case-synthetic-irregular-participle-v1");

  aggregate = transitionCase(
    aggregate,
    event({
      eventId: "evt-evidence",
      type: "evidence_ingested",
      lowConfidenceRegionCount: 1,
    }),
  );
  aggregate = transitionCase(
    aggregate,
    event({ eventId: "evt-confirm", type: "recognition_confirmed" }),
  );
  aggregate = transitionCase(
    aggregate,
    event({
      eventId: "evt-hypotheses",
      type: "hypotheses_generated",
      hypothesisIds: ["past-vs-participle", "auxiliary-meaning"],
    }),
  );

  return transitionCase(
    aggregate,
    event({
      eventId: "evt-probe",
      type: "probe_evaluated",
      selectedHypothesisId: "past-vs-participle",
      passed: false,
    }),
  );
}

function reachInterventionActive() {
  return transitionCase(
    reachInterventionReady(),
    event({
      eventId: "evt-intervention-generated",
      type: "intervention_generated",
      taskId: "task-guided-intervention-1",
    }),
  );
}

describe("case state machine", () => {
  it("rejects an empty case id", () => {
    expect(() => createCase("")).toThrowError(CaseTransitionError);
  });

  it("starts without pretending evidence or mastery exists", () => {
    expect(createCase("case-1")).toMatchObject({
      status: "awaiting_evidence",
      mastery: "insufficient_evidence",
      version: 0,
      replanCount: 0,
    });
  });

  it("requires confirmation when recognition contains low-confidence regions", () => {
    const next = transitionCase(
      createCase("case-1"),
      event({
        eventId: "evt-1",
        type: "evidence_ingested",
        lowConfidenceRegionCount: 2,
      }),
    );

    expect(next.status).toBe("awaiting_confirmation");
  });

  it("requires confirmation when the evidence source explicitly requests review", () => {
    const next = transitionCase(
      createCase("case-1"),
      event({
        eventId: "evt-real-review",
        type: "evidence_ingested",
        lowConfidenceRegionCount: 0,
        requiresConfirmation: true,
      }),
    );

    expect(next.status).toBe("awaiting_confirmation");
  });

  it("requires at least two competing hypotheses before selecting a probe", () => {
    let aggregate = createCase("case-1");
    aggregate = transitionCase(
      aggregate,
      event({
        eventId: "evt-1",
        type: "evidence_ingested",
        lowConfidenceRegionCount: 0,
      }),
    );

    expect(() =>
      transitionCase(
        aggregate,
        event({
          eventId: "evt-2",
          type: "hypotheses_generated",
          hypothesisIds: ["only-one"],
        }),
      ),
    ).toThrowError(CaseTransitionError);
  });

  it("rejects events that do not match the current state", () => {
    expect(() =>
      transitionCase(
        createCase("case-1"),
        event({ eventId: "evt-1", type: "recognition_confirmed" }),
      ),
    ).toThrowError(CaseTransitionError);
  });

  it("requires a generated intervention task before completion", () => {
    const ready = reachInterventionReady();
    const active = transitionCase(
      ready,
      event({
        eventId: "evt-intervention-generated",
        type: "intervention_generated",
        taskId: "task-guided-intervention-1",
      }),
    );

    expect(active.status).toBe("intervention_active");
    expect(() =>
      transitionCase(
        ready,
        event({
          eventId: "evt-intervention-too-early",
          type: "intervention_completed",
          taskId: "task-guided-intervention-1",
          d1TaskId: "task-d1-1",
          d1ScheduledFor: "2026-08-15T10:00:00.000Z",
        }),
      ),
    ).toThrowError(CaseTransitionError);
  });

  it("does not mark mastery after the intervention or the first successful retest", () => {
    let aggregate = reachInterventionActive();
    aggregate = transitionCase(
      aggregate,
      event({
        eventId: "evt-intervention",
        type: "intervention_completed",
        taskId: "task-guided-intervention-1",
        d1TaskId: "task-d1-1",
        d1ScheduledFor: "2026-08-15T10:00:00.000Z",
      }),
    );
    aggregate = transitionCase(
      aggregate,
      event({
        eventId: "evt-d1",
        type: "retest_evaluated",
        kind: "d1",
        passed: true,
      }),
    );

    expect(aggregate.status).toBe("d7_scheduled");
    expect(aggregate.mastery).toBe("pending_retest");
  });

  it("requires replanning after a failed delayed retest", () => {
    let aggregate = reachInterventionActive();
    aggregate = transitionCase(
      aggregate,
      event({
        eventId: "evt-intervention",
        type: "intervention_completed",
        taskId: "task-guided-intervention-1",
        d1TaskId: "task-d1-1",
        d1ScheduledFor: "2026-08-15T10:00:00.000Z",
      }),
    );
    aggregate = transitionCase(
      aggregate,
      event({
        eventId: "evt-d1",
        type: "retest_evaluated",
        kind: "d1",
        passed: false,
      }),
    );

    expect(aggregate.status).toBe("replan_required");
    expect(aggregate.mastery).toBe("insufficient_evidence");

    aggregate = transitionCase(
      aggregate,
      event({
        eventId: "evt-replan",
        type: "plan_replanned",
        replanIndex: 1,
        strategy: "alternate_explanation_and_practice",
      }),
    );

    expect(aggregate.status).toBe("intervention_ready");
    expect(aggregate.replanCount).toBe(1);
  });

  it("marks repair only after a successful d7 transfer retest", () => {
    let aggregate = reachInterventionActive();
    aggregate = transitionCase(
      aggregate,
      event({
        eventId: "evt-intervention",
        type: "intervention_completed",
        taskId: "task-guided-intervention-1",
        d1TaskId: "task-d1-1",
        d1ScheduledFor: "2026-08-15T10:00:00.000Z",
      }),
    );
    aggregate = transitionCase(
      aggregate,
      event({
        eventId: "evt-d1",
        type: "retest_evaluated",
        kind: "d1",
        passed: true,
      }),
    );
    aggregate = transitionCase(
      aggregate,
      event({
        eventId: "evt-d7",
        type: "retest_evaluated",
        kind: "d7",
        passed: true,
      }),
    );

    expect(aggregate.status).toBe("repair_verified");
    expect(aggregate.mastery).toBe("repaired");
  });

  it("caps a third failed retest at support_required and records both strategies", () => {
    let aggregate = reachInterventionActive();
    aggregate = transitionCase(aggregate, event({
      eventId: "evt-intervention",
      type: "intervention_completed",
      taskId: "task-guided-intervention-1",
      d1TaskId: "task-d1-1",
      d1ScheduledFor: "2026-08-15T10:00:00.000Z",
    }));
    aggregate = transitionCase(aggregate, event({
      eventId: "evt-d1-fail-1",
      type: "retest_evaluated",
      kind: "d1",
      passed: false,
    }));
    aggregate = transitionCase(aggregate, event({
      eventId: "evt-replan-1",
      type: "plan_replanned",
      replanIndex: 1,
      strategy: "alternate_explanation_and_practice",
    }));
    aggregate = transitionCase(aggregate, event({
      eventId: "evt-intervention-2",
      type: "intervention_generated",
      taskId: "task-guided-intervention-2",
    }));
    aggregate = transitionCase(aggregate, event({
      eventId: "evt-intervention-complete-2",
      type: "intervention_completed",
      taskId: "task-guided-intervention-2",
      d1TaskId: "task-d1-2",
      d1ScheduledFor: "2026-08-22T10:00:00.000Z",
    }));
    aggregate = transitionCase(aggregate, event({
      eventId: "evt-d1-fail-2",
      type: "retest_evaluated",
      kind: "d1",
      passed: false,
    }));
    aggregate = transitionCase(aggregate, event({
      eventId: "evt-replan-2",
      type: "plan_replanned",
      replanIndex: 2,
      strategy: "prerequisite_skill_with_example",
    }));
    aggregate = transitionCase(aggregate, event({
      eventId: "evt-intervention-3",
      type: "intervention_generated",
      taskId: "task-guided-intervention-3",
    }));
    aggregate = transitionCase(aggregate, event({
      eventId: "evt-intervention-complete-3",
      type: "intervention_completed",
      taskId: "task-guided-intervention-3",
      d1TaskId: "task-d1-3",
      d1ScheduledFor: "2026-08-29T10:00:00.000Z",
    }));
    aggregate = transitionCase(aggregate, event({
      eventId: "evt-d1-fail-3",
      type: "retest_evaluated",
      kind: "d1",
      passed: false,
    }));

    expect(aggregate.status).toBe("support_required");
    expect(aggregate.replanCount).toBe(2);
  });

  it("applies the same event id only once", () => {
    const firstEvent: CaseEvent = event({
      eventId: "evt-1",
      type: "evidence_ingested",
      lowConfidenceRegionCount: 0,
    });
    const once = transitionCase(createCase("case-1"), firstEvent);
    const twice = transitionCase(once, firstEvent);

    expect(twice).toBe(once);
    expect(twice.version).toBe(1);
  });
});
