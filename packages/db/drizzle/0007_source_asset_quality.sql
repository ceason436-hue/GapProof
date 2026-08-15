ALTER TABLE "app"."source_assets" ADD COLUMN "quality" jsonb;
ALTER TABLE "app"."source_assets" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
