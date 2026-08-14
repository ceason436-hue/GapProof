CREATE SCHEMA "app";
--> statement-breakpoint
CREATE SCHEMA "evidence";
--> statement-breakpoint
CREATE TYPE "app"."case_state" AS ENUM('awaiting_evidence', 'awaiting_confirmation', 'ready_for_diagnosis', 'probe_required', 'intervention_ready', 'd1_scheduled', 'd7_scheduled', 'replan_required', 'report_ready');--> statement-breakpoint
CREATE TYPE "evidence"."evidence_event_type" AS ENUM('evidence_ingested', 'recognition_confirmed', 'hypotheses_generated', 'probe_evaluated', 'intervention_completed', 'retest_evaluated', 'plan_replanned');--> statement-breakpoint
CREATE TYPE "app"."student_status" AS ENUM('active', 'deleted');--> statement-breakpoint
CREATE TABLE "app"."cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"state" "app"."case_state" DEFAULT 'awaiting_evidence' NOT NULL,
	"state_version" integer DEFAULT 0 NOT NULL,
	"title" text,
	"current_skill_id" uuid,
	"simulation" boolean DEFAULT false NOT NULL,
	"synthetic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "cases_state_version_nonnegative" CHECK ("app"."cases"."state_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "evidence"."learning_evidence_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"event_type" "evidence"."evidence_event_type" NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text,
	"payload" jsonb NOT NULL,
	"confidence" numeric(5, 4),
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text NOT NULL,
	CONSTRAINT "learning_evidence_events_confidence_range" CHECK ("evidence"."learning_evidence_events"."confidence" is null or ("evidence"."learning_evidence_events"."confidence" >= 0 and "evidence"."learning_evidence_events"."confidence" <= 1))
);
--> statement-breakpoint
CREATE TABLE "app"."students" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"anonymous_key" text NOT NULL,
	"grade" text,
	"region" text,
	"curriculum_version" text,
	"timezone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"status" "app"."student_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app"."cases" ADD CONSTRAINT "cases_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "app"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence"."learning_evidence_events" ADD CONSTRAINT "learning_evidence_events_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "app"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence"."learning_evidence_events" ADD CONSTRAINT "learning_evidence_events_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "app"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cases_student_updated_idx" ON "app"."cases" USING btree ("student_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_evidence_events_idempotency_key_uidx" ON "evidence"."learning_evidence_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "learning_evidence_events_case_occurred_idx" ON "evidence"."learning_evidence_events" USING btree ("case_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "students_anonymous_key_uidx" ON "app"."students" USING btree ("anonymous_key");--> statement-breakpoint
CREATE INDEX "students_tenant_status_idx" ON "app"."students" USING btree ("tenant_id","status");