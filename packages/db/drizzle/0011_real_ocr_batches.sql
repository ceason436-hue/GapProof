CREATE TYPE "app"."ocr_batch_status" AS ENUM('collecting', 'ready', 'processing', 'needs_confirmation', 'completed', 'retryable_error', 'failed');--> statement-breakpoint
CREATE TABLE "app"."ocr_batches" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "status" "app"."ocr_batch_status" DEFAULT 'collecting' NOT NULL,
  "guardian_confirmed" boolean DEFAULT false NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ocr_batches_version_nonnegative" CHECK ("app"."ocr_batches"."version" >= 0)
);--> statement-breakpoint
ALTER TABLE "app"."ocr_batches" ADD CONSTRAINT "ocr_batches_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "app"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ocr_batches" ADD CONSTRAINT "ocr_batches_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "app"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ocr_batches_case_uidx" ON "app"."ocr_batches" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "ocr_batches_student_updated_idx" ON "app"."ocr_batches" USING btree ("student_id", "updated_at");--> statement-breakpoint
CREATE TABLE "app"."ocr_batch_pages" (
  "id" uuid PRIMARY KEY NOT NULL,
  "batch_id" uuid NOT NULL,
  "asset_id" uuid NOT NULL,
  "page_order" integer NOT NULL,
  "status" "app"."asset_processing_status" DEFAULT 'pending_upload' NOT NULL,
  "extraction" jsonb,
  "failure_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ocr_batch_pages_order_positive" CHECK ("app"."ocr_batch_pages"."page_order" > 0)
);--> statement-breakpoint
ALTER TABLE "app"."ocr_batch_pages" ADD CONSTRAINT "ocr_batch_pages_batch_id_ocr_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "app"."ocr_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ocr_batch_pages" ADD CONSTRAINT "ocr_batch_pages_asset_id_source_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "app"."source_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ocr_batch_pages_asset_uidx" ON "app"."ocr_batch_pages" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ocr_batch_pages_order_uidx" ON "app"."ocr_batch_pages" USING btree ("batch_id", "page_order");--> statement-breakpoint
CREATE INDEX "ocr_batch_pages_batch_status_idx" ON "app"."ocr_batch_pages" USING btree ("batch_id", "status");
