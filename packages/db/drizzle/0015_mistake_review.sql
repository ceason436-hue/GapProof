ALTER TYPE "app"."task_type" ADD VALUE IF NOT EXISTS 'mistake_review';
ALTER TYPE "evidence"."evidence_event_type" ADD VALUE IF NOT EXISTS 'mistake_review_created';
ALTER TYPE "evidence"."evidence_event_type" ADD VALUE IF NOT EXISTS 'mistake_review_completed';
