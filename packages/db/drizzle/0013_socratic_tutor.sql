CREATE TYPE "app"."tutor_session_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "app"."tutor_turn_status" AS ENUM('queued', 'running', 'succeeded', 'fallback', 'failed');--> statement-breakpoint
CREATE TABLE "app"."tutor_sessions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "task_id" uuid NOT NULL,
  "status" "app"."tutor_session_status" DEFAULT 'active' NOT NULL,
  "policy_version" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "app"."tutor_turns" (
  "id" uuid PRIMARY KEY NOT NULL,
  "session_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "task_id" uuid NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" char(64) NOT NULL,
  "status" "app"."tutor_turn_status" DEFAULT 'queued' NOT NULL,
  "context" jsonb NOT NULL,
  "response" jsonb,
  "provider" text,
  "model" text,
  "input_tokens" integer,
  "output_tokens" integer,
  "error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "tutor_turns_request_hash_lower_hex" CHECK ("app"."tutor_turns"."request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "tutor_turns_input_tokens_nonnegative" CHECK ("app"."tutor_turns"."input_tokens" is null or "app"."tutor_turns"."input_tokens" >= 0),
  CONSTRAINT "tutor_turns_output_tokens_nonnegative" CHECK ("app"."tutor_turns"."output_tokens" is null or "app"."tutor_turns"."output_tokens" >= 0)
);--> statement-breakpoint
ALTER TABLE "app"."tutor_sessions" ADD CONSTRAINT "tutor_sessions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "app"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tutor_sessions" ADD CONSTRAINT "tutor_sessions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "app"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tutor_sessions" ADD CONSTRAINT "tutor_sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "app"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tutor_turns" ADD CONSTRAINT "tutor_turns_session_id_tutor_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "app"."tutor_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tutor_turns" ADD CONSTRAINT "tutor_turns_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "app"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tutor_turns" ADD CONSTRAINT "tutor_turns_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "app"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tutor_sessions_task_uidx" ON "app"."tutor_sessions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "tutor_sessions_student_updated_idx" ON "app"."tutor_sessions" USING btree ("student_id", "updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tutor_turns_student_key_uidx" ON "app"."tutor_turns" USING btree ("student_id", "idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tutor_turns_one_outstanding_uidx" ON "app"."tutor_turns" USING btree ("session_id") WHERE "status" IN ('queued', 'running');--> statement-breakpoint
CREATE INDEX "tutor_turns_session_created_idx" ON "app"."tutor_turns" USING btree ("session_id", "created_at");--> statement-breakpoint
CREATE INDEX "tutor_turns_student_created_idx" ON "app"."tutor_turns" USING btree ("student_id", "created_at");
