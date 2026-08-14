CREATE TYPE "app"."asset_type" AS ENUM('student_upload', 'synthetic_fixture', 'managed_content');
CREATE TYPE "app"."asset_processing_status" AS ENUM('pending_upload', 'uploaded', 'queued', 'processing', 'needs_confirmation', 'succeeded', 'retryable_error', 'failed');
CREATE TABLE "app"."source_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid,
	"case_id" uuid,
	"object_key" text NOT NULL,
	"sha256" char(64) NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"asset_type" "app"."asset_type" NOT NULL,
	"retention_until" timestamp with time zone,
	"processing_status" "app"."asset_processing_status" DEFAULT 'pending_upload' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "source_assets_sha256_lower_hex_chk" CHECK ("app"."source_assets"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "source_assets_byte_size_positive_chk" CHECK ("app"."source_assets"."byte_size" > 0)
);
ALTER TABLE "app"."source_assets" ADD CONSTRAINT "source_assets_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "app"."students"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app"."source_assets" ADD CONSTRAINT "source_assets_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "app"."cases"("id") ON DELETE no action ON UPDATE no action;
CREATE UNIQUE INDEX "source_assets_object_key_uidx" ON "app"."source_assets" USING btree ("object_key");
CREATE INDEX "source_assets_tenant_created_idx" ON "app"."source_assets" USING btree ("tenant_id", "created_at");
CREATE INDEX "source_assets_student_created_idx" ON "app"."source_assets" USING btree ("student_id", "created_at");
CREATE INDEX "source_assets_case_created_idx" ON "app"."source_assets" USING btree ("case_id", "created_at");
CREATE INDEX "source_assets_status_created_idx" ON "app"."source_assets" USING btree ("processing_status", "created_at");
CREATE INDEX "source_assets_retention_idx" ON "app"."source_assets" USING btree ("retention_until");
