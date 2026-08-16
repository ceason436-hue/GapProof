import {
  CompleteMistakeReviewRequestSchema,
  CreateMistakeReviewRequestSchema,
  LearningTaskViewSchema,
  MistakeReviewCompletionViewSchema,
  type CompleteMistakeReviewRequest,
  type MistakeReviewTaskView,
} from "@gapproof/contracts";
import { Value } from "@sinclair/typebox/value";
import { apiPost } from "./api-client";
import { createBrowserUuidV7 } from "./browser-uuidv7";

export function createMistakeReviewRequest(entryRef: string) {
  const body = { entryRef };
  return Value.Check(CreateMistakeReviewRequestSchema, body) ? body : null;
}

export function createMistakeReviewResponseRequest(responseText: string): CompleteMistakeReviewRequest | null {
  const body = { responseText: responseText.trim() };
  return Value.Check(CompleteMistakeReviewRequestSchema, body) ? body : null;
}

export function startMistakeReview(studentId: string, entryRef: string, idempotencyKey = createBrowserUuidV7()) {
  const body = createMistakeReviewRequest(entryRef);
  if (!body) throw new Error("INVALID_REVIEW_REQUEST");
  return apiPost(`/api/v1/students/${studentId}/question-archive/reviews`, LearningTaskViewSchema, body, idempotencyKey);
}

export function completeMistakeReview(taskId: string, body: CompleteMistakeReviewRequest, idempotencyKey = createBrowserUuidV7()) {
  return apiPost(`/api/v1/tasks/${taskId}/mistake-review/complete`, MistakeReviewCompletionViewSchema, body, idempotencyKey);
}

export function isMistakeReviewTask(task: { taskType: string }): task is MistakeReviewTaskView {
  return task.taskType === "mistake_review";
}
