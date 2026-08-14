import { type Static, Type } from "@sinclair/typebox";

export const CaseStatusSchema = Type.Union([
  Type.Literal("awaiting_evidence"),
  Type.Literal("awaiting_confirmation"),
  Type.Literal("ready_for_diagnosis"),
  Type.Literal("probe_required"),
  Type.Literal("intervention_ready"),
  Type.Literal("d1_scheduled"),
  Type.Literal("d7_scheduled"),
  Type.Literal("replan_required"),
  Type.Literal("report_ready"),
]);

export type CaseStatus = Static<typeof CaseStatusSchema>;

export const MasteryStatusSchema = Type.Union([
  Type.Literal("insufficient_evidence"),
  Type.Literal("pending_retest"),
  Type.Literal("repaired"),
]);

export type MasteryStatus = Static<typeof MasteryStatusSchema>;

const EventBaseSchema = Type.Object({
  eventId: Type.String({ minLength: 1 }),
  occurredAt: Type.String({ format: "date-time" }),
});

export const CaseEventSchema = Type.Union([
  Type.Intersect([
    EventBaseSchema,
    Type.Object({
      type: Type.Literal("evidence_ingested"),
      lowConfidenceRegionCount: Type.Integer({ minimum: 0 }),
    }),
  ]),
  Type.Intersect([
    EventBaseSchema,
    Type.Object({ type: Type.Literal("recognition_confirmed") }),
  ]),
  Type.Intersect([
    EventBaseSchema,
    Type.Object({
      type: Type.Literal("hypotheses_generated"),
      hypothesisIds: Type.Array(Type.String({ minLength: 1 })),
    }),
  ]),
  Type.Intersect([
    EventBaseSchema,
    Type.Object({
      type: Type.Literal("probe_evaluated"),
      selectedHypothesisId: Type.String({ minLength: 1 }),
      passed: Type.Boolean(),
    }),
  ]),
  Type.Intersect([
    EventBaseSchema,
    Type.Object({ type: Type.Literal("intervention_completed") }),
  ]),
  Type.Intersect([
    EventBaseSchema,
    Type.Object({
      type: Type.Literal("retest_evaluated"),
      kind: Type.Union([Type.Literal("d1"), Type.Literal("d7")]),
      passed: Type.Boolean(),
    }),
  ]),
  Type.Intersect([
    EventBaseSchema,
    Type.Object({ type: Type.Literal("plan_replanned") }),
  ]),
]);

export type CaseEvent = Static<typeof CaseEventSchema>;

export interface CaseAggregate {
  readonly id: string;
  readonly status: CaseStatus;
  readonly mastery: MasteryStatus;
  readonly version: number;
  readonly replanCount: number;
  readonly appliedEventIds: readonly string[];
}

