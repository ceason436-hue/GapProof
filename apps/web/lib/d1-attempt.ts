import { Value } from "@sinclair/typebox/value";
import {
  CaseViewSchema,
  D1RetestAttemptViewSchema,
  SubmitD1RetestAttemptRequestSchema,
  type SubmitD1RetestAttemptRequest,
} from "@gapproof/contracts";
import { apiGet, apiPost } from "./api-client";

export function createD1AttemptRequest(
  expectedVersion: number,
  itemId: string,
  selectedChoiceId: string | null,
): SubmitD1RetestAttemptRequest | null {
  const request = { expectedVersion, itemId, selectedChoiceId };
  return Value.Check(SubmitD1RetestAttemptRequestSchema, request)
    ? request
    : null;
}

export function canBeginD1Attempt(
  expectedVersion: number | null,
  selectedChoiceId: string | null,
  resultUnconfirmed: boolean,
): boolean {
  return expectedVersion !== null && selectedChoiceId !== null && !resultUnconfirmed;
}

export const getCaseForD1Attempt = (caseId: string) =>
  apiGet(`/api/v1/cases/${caseId}`, CaseViewSchema);

export const submitD1Attempt = (
  taskId: string,
  body: SubmitD1RetestAttemptRequest,
  idempotencyKey: string,
) => apiPost(`/api/v1/tasks/${taskId}/attempts`, D1RetestAttemptViewSchema, body, idempotencyKey);
