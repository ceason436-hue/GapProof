import { Value } from "@sinclair/typebox/value";
import {
  CaseViewSchema,
  CompleteTaskRequestSchema,
  LearningTaskViewSchema,
  TaskCompletionViewSchema,
  type CompleteTaskRequest,
} from "@gapproof/contracts";
import { apiGet, apiPost } from "./api-client";
import { createBrowserUuidV7 } from "./browser-uuidv7";

export type GuidedTaskIntent = {
  body: CompleteTaskRequest;
  idempotencyKey: string;
};

export function createGuidedTaskRequest(
  expectedVersion: number,
  requiredStepIds: readonly string[],
  completedStepIds: readonly string[],
): CompleteTaskRequest | null {
  const selected = new Set(completedStepIds);
  if (requiredStepIds.length === 0 || selected.size !== requiredStepIds.length) return null;
  if (requiredStepIds.some(stepId => !selected.has(stepId))) return null;
  const body = { expectedVersion, completedStepIds: requiredStepIds.slice() };
  return Value.Check(CompleteTaskRequestSchema, body) ? body : null;
}

export function createGuidedTaskIntent(
  expectedVersion: number,
  requiredStepIds: readonly string[],
  completedStepIds: readonly string[],
  createIdempotencyKey: () => string = createBrowserUuidV7,
): GuidedTaskIntent | null {
  const body = createGuidedTaskRequest(expectedVersion, requiredStepIds, completedStepIds);
  return body ? { body, idempotencyKey: createIdempotencyKey() } : null;
}

export function guidedTaskGuards(
  expectedVersion: number | null,
  requiredStepIds: readonly string[],
  completedStepIds: readonly string[],
  locked: boolean,
): { editable: boolean; submitAllowed: boolean } {
  const complete = createGuidedTaskRequest(expectedVersion ?? 0, requiredStepIds, completedStepIds) !== null;
  return { editable: !locked, submitAllowed: !locked && expectedVersion !== null && complete };
}

export const getCaseForGuidedTask = (caseId: string) =>
  apiGet(`/api/v1/cases/${caseId}`, CaseViewSchema);

export const getGuidedTask = (taskId: string) =>
  apiGet(`/api/v1/tasks/${taskId}`, LearningTaskViewSchema);

export const submitGuidedTask = (
  taskId: string,
  body: CompleteTaskRequest,
  idempotencyKey: string,
) => apiPost(`/api/v1/tasks/${taskId}/submit`, TaskCompletionViewSchema, body, idempotencyKey);
