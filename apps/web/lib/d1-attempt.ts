import { Value } from "@sinclair/typebox/value";
import {
  CaseViewSchema,
  D1RetestAttemptViewSchema,
  SubmitD1RetestAttemptRequestSchema,
  type SubmitD1RetestAttemptRequest,
} from "@gapproof/contracts";
import { apiGet, apiPost } from "./api-client";
import { createBrowserUuidV7 } from "./browser-uuidv7";

export type D1AttemptIntent = {
  body: SubmitD1RetestAttemptRequest;
  idempotencyKey: string;
};

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

export function createD1AttemptIntent(
  expectedVersion: number,
  itemId: string,
  selectedChoiceId: string | null,
  createIdempotencyKey: () => string = createBrowserUuidV7,
): D1AttemptIntent | null {
  const body = createD1AttemptRequest(expectedVersion, itemId, selectedChoiceId);
  return body ? { body, idempotencyKey: createIdempotencyKey() } : null;
}

export function d1AttemptGuards(
  expectedVersion: number | null,
  selectedChoiceId: string | null,
  resultUnconfirmed: boolean,
): { editable: boolean; submitAllowed: boolean } {
  const editable = !resultUnconfirmed;
  return {
    editable,
    submitAllowed: editable && expectedVersion !== null && selectedChoiceId !== null,
  };
}

export function canBeginD1Attempt(
  expectedVersion: number | null,
  selectedChoiceId: string | null,
  resultUnconfirmed: boolean,
): boolean {
  return d1AttemptGuards(expectedVersion, selectedChoiceId, resultUnconfirmed).submitAllowed;
}

export const getCaseForD1Attempt = (caseId: string) =>
  apiGet(`/api/v1/cases/${caseId}`, CaseViewSchema);

export const submitD1Attempt = (
  taskId: string,
  body: SubmitD1RetestAttemptRequest,
  idempotencyKey: string,
) => apiPost(`/api/v1/tasks/${taskId}/attempts`, D1RetestAttemptViewSchema, body, idempotencyKey);
