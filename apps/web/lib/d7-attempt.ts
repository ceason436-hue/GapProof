import { Value } from "@sinclair/typebox/value";
import {
  CaseViewSchema,
  D7RetestAttemptViewSchema,
  SubmitRetestAttemptRequestSchema,
  type SubmitRetestAttemptRequest,
} from "@gapproof/contracts";
import { apiGet, apiPost } from "./api-client";
import { createBrowserUuidV7 } from "./browser-uuidv7";

export type D7AttemptIntent = {
  body: SubmitRetestAttemptRequest;
  idempotencyKey: string;
};

export function createD7AttemptRequest(
  expectedVersion: number,
  itemId: string,
  selectedChoiceId: string | null,
): SubmitRetestAttemptRequest | null {
  const request = { expectedVersion, itemId, selectedChoiceId };
  return Value.Check(SubmitRetestAttemptRequestSchema, request) ? request : null;
}

export function createD7AttemptIntent(
  expectedVersion: number,
  itemId: string,
  selectedChoiceId: string | null,
  createIdempotencyKey: () => string = createBrowserUuidV7,
): D7AttemptIntent | null {
  const body = createD7AttemptRequest(expectedVersion, itemId, selectedChoiceId);
  return body ? { body, idempotencyKey: createIdempotencyKey() } : null;
}

export function d7AttemptGuards(
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

export const getCaseForD7Attempt = (caseId: string) =>
  apiGet(`/api/v1/cases/${caseId}`, CaseViewSchema);

export const submitD7Attempt = (
  taskId: string,
  body: SubmitRetestAttemptRequest,
  idempotencyKey: string,
) => apiPost(`/api/v1/tasks/${taskId}/attempts`, D7RetestAttemptViewSchema, body, idempotencyKey);
