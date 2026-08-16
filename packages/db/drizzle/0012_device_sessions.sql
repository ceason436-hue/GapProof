CREATE TABLE "app"."device_sessions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "token_hash" char(64) NOT NULL,
  "idempotency_key" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "last_seen_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "device_sessions_token_hash_lower_hex" CHECK ("app"."device_sessions"."token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "device_sessions_expiry_after_creation" CHECK ("app"."device_sessions"."expires_at" > "app"."device_sessions"."created_at")
);--> statement-breakpoint
ALTER TABLE "app"."device_sessions" ADD CONSTRAINT "device_sessions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "app"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_sessions_token_hash_uidx" ON "app"."device_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "device_sessions_idempotency_key_uidx" ON "app"."device_sessions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "device_sessions_student_expires_idx" ON "app"."device_sessions" USING btree ("student_id", "expires_at");
