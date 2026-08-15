ALTER TABLE "app"."students" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "app"."students" ADD COLUMN "term" text;--> statement-breakpoint
ALTER TABLE "app"."students" ADD COLUMN "learning_state" text;--> statement-breakpoint
ALTER TABLE "app"."students" ADD COLUMN "profile_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE "app"."student_profile_revisions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "student_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" char(64) NOT NULL,
  "grade" text NOT NULL,
  "subject" text NOT NULL,
  "term" text NOT NULL,
  "region" text NOT NULL,
  "learning_state" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "student_profile_revisions_version_positive" CHECK ("app"."student_profile_revisions"."version" > 0),
  CONSTRAINT "student_profile_revisions_hash_lower_hex" CHECK ("app"."student_profile_revisions"."request_hash" ~ '^[0-9a-f]{64}$')
);--> statement-breakpoint
ALTER TABLE "app"."student_profile_revisions" ADD CONSTRAINT "student_profile_revisions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "app"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "student_profile_revisions_student_key_uidx" ON "app"."student_profile_revisions" USING btree ("student_id", "idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "student_profile_revisions_student_version_uidx" ON "app"."student_profile_revisions" USING btree ("student_id", "version");
