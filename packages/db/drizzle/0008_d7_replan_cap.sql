ALTER TYPE "app"."case_state" ADD VALUE IF NOT EXISTS 'repair_verified';--> statement-breakpoint
ALTER TYPE "app"."case_state" ADD VALUE IF NOT EXISTS 'support_required';--> statement-breakpoint
ALTER TABLE "app"."cases" ADD COLUMN "replan_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."cases" ADD CONSTRAINT "cases_replan_count_bounded" CHECK ("app"."cases"."replan_count" >= 0);
