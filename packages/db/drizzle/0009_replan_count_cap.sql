ALTER TABLE "app"."cases" DROP CONSTRAINT IF EXISTS "cases_replan_count_bounded";--> statement-breakpoint
ALTER TABLE "app"."cases" ADD CONSTRAINT "cases_replan_count_bounded" CHECK ("app"."cases"."replan_count" >= 0 AND "app"."cases"."replan_count" <= 2);
