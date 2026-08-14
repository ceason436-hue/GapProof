CREATE TABLE "app"."api_idempotency_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"resource_id" uuid,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "api_idempotency_records_scope_key_uidx" ON "app"."api_idempotency_records" USING btree ("scope","idempotency_key");