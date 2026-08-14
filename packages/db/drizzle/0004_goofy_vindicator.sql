ALTER TYPE "evidence"."evidence_event_type" ADD VALUE 'demo_clock_advanced' BEFORE 'retest_evaluated';--> statement-breakpoint
CREATE TABLE "app"."demo_clocks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"clock_version" integer DEFAULT 0 NOT NULL,
	"effective_now" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_clocks_version_nonnegative" CHECK ("app"."demo_clocks"."clock_version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."demo_clocks" ADD CONSTRAINT "demo_clocks_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "app"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "demo_clocks_case_id_uidx" ON "app"."demo_clocks" USING btree ("case_id");