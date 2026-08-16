import { type Static, Type } from "@sinclair/typebox";

export const LearningRecordSourceSchema = Type.Union([
  Type.Literal("real_material"),
  Type.Literal("synthetic_experience"),
]);

export const ProgressStageSchema = Type.Union([
  Type.Literal("collecting"),
  Type.Literal("checking"),
  Type.Literal("practicing"),
  Type.Literal("retesting"),
  Type.Literal("needs_follow_up"),
  Type.Literal("repair_verified"),
  Type.Literal("support_required"),
]);

export const ProgressNextTaskSchema = Type.Object({
  taskType: Type.Union([
    Type.Literal("guided_intervention"),
    Type.Literal("d1_retest"),
    Type.Literal("d7_retest"),
  ]),
  status: Type.Union([Type.Literal("ready"), Type.Literal("scheduled")]),
  title: Type.String({ minLength: 1 }),
  scheduledFor: Type.String({ format: "date-time" }),
}, { additionalProperties: false });

export const StudentProgressGoalSchema = Type.Object({
  caseId: Type.String({ format: "uuid" }),
  title: Type.String({ minLength: 1 }),
  source: LearningRecordSourceSchema,
  stage: ProgressStageSchema,
  updatedAt: Type.String({ format: "date-time" }),
  completedTaskCount: Type.Integer({ minimum: 0 }),
  nextTask: Type.Union([ProgressNextTaskSchema, Type.Null()]),
}, { additionalProperties: false });

export const ProgressTimelineKindSchema = Type.Union([
  Type.Literal("material_confirmed"),
  Type.Literal("diagnosis_checked"),
  Type.Literal("practice_completed"),
  Type.Literal("d1_passed"),
  Type.Literal("d1_needs_follow_up"),
  Type.Literal("d7_passed"),
  Type.Literal("d7_needs_follow_up"),
  Type.Literal("plan_adjusted"),
]);

export const ProgressTimelineEntrySchema = Type.Object({
  eventId: Type.String({ format: "uuid" }),
  caseId: Type.String({ format: "uuid" }),
  source: LearningRecordSourceSchema,
  kind: ProgressTimelineKindSchema,
  occurredAt: Type.String({ format: "date-time" }),
}, { additionalProperties: false });

export const StudentProgressViewSchema = Type.Object({
  studentId: Type.String({ format: "uuid" }),
  timeZone: Type.String({ minLength: 1 }),
  goals: Type.Array(StudentProgressGoalSchema),
  timeline: Type.Array(ProgressTimelineEntrySchema),
}, { additionalProperties: false });

const ReportRetestResultSchema = Type.Union([
  Type.Literal("passed"),
  Type.Literal("needs_follow_up"),
  Type.Literal("not_recorded"),
]);

export const StudentFactReportSchema = Type.Object({
  caseId: Type.String({ format: "uuid" }),
  title: Type.String({ minLength: 1 }),
  source: LearningRecordSourceSchema,
  conclusion: Type.Union([
    Type.Literal("repair_verified"),
    Type.Literal("support_required"),
  ]),
  d1Result: ReportRetestResultSchema,
  d7Result: ReportRetestResultSchema,
  completedTaskCount: Type.Integer({ minimum: 0 }),
  evidenceThrough: Type.String({ format: "date-time" }),
}, { additionalProperties: false });

export const StudentFactReportsViewSchema = Type.Object({
  studentId: Type.String({ format: "uuid" }),
  timeZone: Type.String({ minLength: 1 }),
  reports: Type.Array(StudentFactReportSchema),
}, { additionalProperties: false });

export type LearningRecordSource = Static<typeof LearningRecordSourceSchema>;
export type ProgressStage = Static<typeof ProgressStageSchema>;
export type ProgressTimelineKind = Static<typeof ProgressTimelineKindSchema>;
export type StudentProgressView = Static<typeof StudentProgressViewSchema>;
export type StudentFactReportsView = Static<typeof StudentFactReportsViewSchema>;
