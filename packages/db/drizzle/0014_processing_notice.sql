ALTER TABLE "app"."ocr_batches" ADD COLUMN "processing_notice_version" text;
ALTER TABLE "app"."ocr_batches" ADD COLUMN "processing_notice_accepted_at" timestamptz;
