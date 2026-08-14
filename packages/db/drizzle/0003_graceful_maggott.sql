CREATE TYPE "app"."task_status" AS ENUM('ready', 'scheduled', 'completed');--> statement-breakpoint
CREATE TYPE "app"."task_type" AS ENUM('guided_intervention', 'd1_retest');--> statement-breakpoint
ALTER TYPE "app"."case_state" ADD VALUE 'intervention_active' BEFORE 'd1_scheduled';--> statement-breakpoint
ALTER TYPE "evidence"."evidence_event_type" ADD VALUE 'intervention_generated' BEFORE 'intervention_completed';--> statement-breakpoint
CREATE TABLE "app"."tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"task_type" "app"."task_type" NOT NULL,
	"status" "app"."task_status" NOT NULL,
	"title" text NOT NULL,
	"estimated_minutes" integer NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone,
	"payload" jsonb NOT NULL,
	"source_event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "tasks_estimated_minutes_positive" CHECK ("app"."tasks"."estimated_minutes" > 0)
);
--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD CONSTRAINT "tasks_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "app"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD CONSTRAINT "tasks_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "app"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD CONSTRAINT "tasks_source_event_id_learning_evidence_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "evidence"."learning_evidence_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_case_type_source_uidx" ON "app"."tasks" USING btree ("case_id","task_type","source_event_id");--> statement-breakpoint
CREATE INDEX "tasks_student_scheduled_idx" ON "app"."tasks" USING btree ("student_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "tasks_status_scheduled_idx" ON "app"."tasks" USING btree ("status","scheduled_for");