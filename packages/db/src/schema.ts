import { sql } from "drizzle-orm";
import {
  boolean,
  bigint,
  char,
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
  "intervention_active",
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
  "intervention_generated",
  "intervention_completed",
  "demo_clock_advanced",
  "retest_evaluated",
  "plan_replanned",
]);

export const taskType = appSchema.enum("task_type", [
  "guided_intervention",
  "d1_retest",
  "d7_retest",
]);

export const taskStatus = appSchema.enum("task_status", [
  "ready",
  "scheduled",
  "completed",
]);

export const assetType = appSchema.enum("asset_type", [
  "student_upload",
  "synthetic_fixture",
  "managed_content",
]);

export const assetProcessingStatus = appSchema.enum("asset_processing_status", [
  "pending_upload",
  "uploaded",
  "queued",
  "processing",
  "needs_confirmation",
  "succeeded",
  "retryable_error",
  "failed",
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

export const sourceAssets = appSchema.table(
  "source_assets",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    studentId: uuid("student_id").references(() => students.id),
    caseId: uuid("case_id").references(() => cases.id),
    objectKey: text("object_key").notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    assetType: assetType("asset_type").notNull(),
    retentionUntil: timestamp("retention_until", { withTimezone: true }),
    processingStatus: assetProcessingStatus("processing_status")
      .notNull()
      .default("pending_upload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("source_assets_object_key_uidx").on(table.objectKey),
    index("source_assets_tenant_created_idx").on(
      table.tenantId,
      table.createdAt,
    ),
    index("source_assets_student_created_idx").on(
      table.studentId,
      table.createdAt,
    ),
    index("source_assets_case_created_idx").on(table.caseId, table.createdAt),
    index("source_assets_status_created_idx").on(
      table.processingStatus,
      table.createdAt,
    ),
    index("source_assets_retention_idx").on(table.retentionUntil),
    check(
      "source_assets_sha256_lower_hex_chk",
      sql`${table.sha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check("source_assets_byte_size_positive_chk", sql`${table.byteSize} > 0`),
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

export const tasks = appSchema.table(
  "tasks",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id),
    taskType: taskType("task_type").notNull(),
    status: taskStatus("status").notNull(),
    title: text("title").notNull(),
    estimatedMinutes: integer("estimated_minutes").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    sourceEventId: uuid("source_event_id")
      .notNull()
      .references(() => learningEvidenceEvents.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("tasks_case_type_source_uidx").on(
      table.caseId,
      table.taskType,
      table.sourceEventId,
    ),
    index("tasks_student_scheduled_idx").on(
      table.studentId,
      table.scheduledFor,
    ),
    index("tasks_status_scheduled_idx").on(table.status, table.scheduledFor),
    check(
      "tasks_estimated_minutes_positive",
      sql`${table.estimatedMinutes} > 0`,
    ),
  ],
);

export const demoClocks = appSchema.table(
  "demo_clocks",
  {
    id: uuid("id").primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id),
    clockVersion: integer("clock_version").notNull().default(0),
    effectiveNow: timestamp("effective_now", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("demo_clocks_case_id_uidx").on(table.caseId),
    check(
      "demo_clocks_version_nonnegative",
      sql`${table.clockVersion} >= 0`,
    ),
  ],
);

export type StudentRow = typeof students.$inferSelect;
export type NewStudentRow = typeof students.$inferInsert;
export type CaseRow = typeof cases.$inferSelect;
export type NewCaseRow = typeof cases.$inferInsert;
export type SourceAssetRow = typeof sourceAssets.$inferSelect;
export type NewSourceAssetRow = typeof sourceAssets.$inferInsert;
export type ApiIdempotencyRecordRow =
  typeof apiIdempotencyRecords.$inferSelect;
export type LearningEvidenceEventRow =
  typeof learningEvidenceEvents.$inferSelect;
export type NewLearningEvidenceEventRow =
  typeof learningEvidenceEvents.$inferInsert;
export type TaskRow = typeof tasks.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;
export type DemoClockRow = typeof demoClocks.$inferSelect;
