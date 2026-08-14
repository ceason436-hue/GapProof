import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const appSchema = pgSchema("app");
export const evidenceSchema = pgSchema("evidence");

export const studentStatus = appSchema.enum("student_status", [
  "active",
  "deleted",
]);

export const caseState = appSchema.enum("case_state", [
  "awaiting_evidence",
  "awaiting_confirmation",
  "ready_for_diagnosis",
  "probe_required",
  "intervention_ready",
  "d1_scheduled",
  "d7_scheduled",
  "replan_required",
  "report_ready",
]);

export const evidenceEventType = evidenceSchema.enum("evidence_event_type", [
  "evidence_ingested",
  "recognition_confirmed",
  "hypotheses_generated",
  "probe_evaluated",
  "intervention_completed",
  "retest_evaluated",
  "plan_replanned",
]);

export const students = appSchema.table(
  "students",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    anonymousKey: text("anonymous_key").notNull(),
    grade: text("grade"),
    region: text("region"),
    curriculumVersion: text("curriculum_version"),
    timezone: text("timezone").notNull().default("Asia/Shanghai"),
    status: studentStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("students_anonymous_key_uidx").on(table.anonymousKey),
    index("students_tenant_status_idx").on(table.tenantId, table.status),
  ],
);

export const cases = appSchema.table(
  "cases",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id),
    state: caseState("state").notNull().default("awaiting_evidence"),
    stateVersion: integer("state_version").notNull().default(0),
    title: text("title"),
    currentSkillId: uuid("current_skill_id"),
    simulation: boolean("simulation").notNull().default(false),
    synthetic: boolean("synthetic").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("cases_student_updated_idx").on(table.studentId, table.updatedAt),
    check("cases_state_version_nonnegative", sql`${table.stateVersion} >= 0`),
  ],
);

export const apiIdempotencyRecords = appSchema.table(
  "api_idempotency_records",
  {
    id: uuid("id").primaryKey(),
    scope: text("scope").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    resourceId: uuid("resource_id"),
    jobId: uuid("job_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("api_idempotency_records_scope_key_uidx").on(
      table.scope,
      table.idempotencyKey,
    ),
  ],
);

export const learningEvidenceEvents = evidenceSchema.table(
  "learning_evidence_events",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id),
    eventType: evidenceEventType("event_type").notNull(),
    sourceType: text("source_type").notNull(),
    sourceRef: text("source_ref"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    idempotencyKey: text("idempotency_key").notNull(),
  },
  (table) => [
    uniqueIndex("learning_evidence_events_idempotency_key_uidx").on(
      table.idempotencyKey,
    ),
    index("learning_evidence_events_case_occurred_idx").on(
      table.caseId,
      table.occurredAt,
    ),
    check(
      "learning_evidence_events_confidence_range",
      sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`,
    ),
  ],
);

export type StudentRow = typeof students.$inferSelect;
export type NewStudentRow = typeof students.$inferInsert;
export type CaseRow = typeof cases.$inferSelect;
export type NewCaseRow = typeof cases.$inferInsert;
export type ApiIdempotencyRecordRow =
  typeof apiIdempotencyRecords.$inferSelect;
export type LearningEvidenceEventRow =
  typeof learningEvidenceEvents.$inferSelect;
export type NewLearningEvidenceEventRow =
  typeof learningEvidenceEvents.$inferInsert;
