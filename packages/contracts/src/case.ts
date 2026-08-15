import { type Static, Type } from "@sinclair/typebox";

export const CaseStatusSchema = Type.Union([
  Type.Literal("awaiting_evidence"),
  Type.Literal("awaiting_confirmation"),
  Type.Literal("ready_for_diagnosis"),
  Type.Literal("probe_required"),
  Type.Literal("intervention_ready"),
  Type.Literal("intervention_active"),
  Type.Literal("d1_scheduled"),
  Type.Literal("d7_scheduled"),
  Type.Literal("replan_required"),
  Type.Literal("repair_verified"),
  Type.Literal("support_required"),
  Type.Literal("report_ready"),
]);

export type CaseStatus = Static<typeof CaseStatusSchema>;

export const MasteryStatusSchema = Type.Union([
  Type.Literal("insufficient_evidence"),
  Type.Literal("pending_retest"),
  Type.Literal("repaired"),
]);

export type MasteryStatus = Static<typeof MasteryStatusSchema>;

export const ReplanStrategySchema = Type.Union([
  Type.Literal("alternate_explanation_and_practice"),
  Type.Literal("prerequisite_skill_with_example"),
]);

export type ReplanStrategy = Static<typeof ReplanStrategySchema>;

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
      selectedHypothesisId: Type.Union([
        Type.String({ minLength: 1 }),
        Type.Null(),
      ]),
      passed: Type.Boolean(),
    }),
  ]),
  Type.Intersect([
    EventBaseSchema,
    Type.Object({
      type: Type.Literal("intervention_generated"),
      taskId: Type.String({ minLength: 1 }),
    }),
  ]),
  Type.Intersect([
    EventBaseSchema,
    Type.Object({
      type: Type.Literal("intervention_completed"),
      taskId: Type.String({ minLength: 1 }),
      d1TaskId: Type.String({ minLength: 1 }),
      d1ScheduledFor: Type.String({ format: "date-time" }),
    }),
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
    Type.Object({
      type: Type.Literal("plan_replanned"),
      replanIndex: Type.Union([Type.Literal(1), Type.Literal(2)]),
      strategy: ReplanStrategySchema,
    }),
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
