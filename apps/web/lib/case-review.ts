import { Value } from "@sinclair/typebox/value";
import {
  AttemptViewSchema,
  CaseSourceAssetsStatusViewSchema,
  CaseViewSchema,
  ConfirmExtractionRequestSchema,
  HypothesesViewSchema,
  RunNextRequestSchema,
  RunNextQueuedSchema,
  SubmitAttemptRequestSchema,
  ExtractionViewSchema,
  DeletedCaseSourceAssetsViewSchema,
  type ConfirmExtractionRequest,
  type ReviewedExtractionQuestion,
  type SubmitAttemptRequest,
  type ExtractionView,
} from "@gapproof/contracts";
import { ApiClientError, apiDeleteOnce, apiGet, apiPost } from "./api-client";
import { createBrowserUuidV7 } from "./browser-uuidv7";
import { ensureContractFormats } from "./contract-formats";

export const REVIEW_POLL_DELAYS_MS = [1_000, 2_000, 3_000] as const;
export const REVIEW_POLL_MAX_WAIT_MS = 30_000;

export type WriteIntent<T> = {
  body: T;
  idempotencyKey: string;
};

export function buildExtractionCorrections(
  items: ExtractionView["items"],
  promptValues: Readonly<Record<string, string>>,
  answerValues: Readonly<Record<string, string>>,
): ConfirmExtractionRequest["corrections"] {
  return items.flatMap(item => {
    const corrections: ConfirmExtractionRequest["corrections"] = [];
    const prompt = promptValues[item.itemId] ?? item.prompt;
    if (prompt !== item.prompt) corrections.push({ itemId: item.itemId, field: "prompt", value: prompt });
    const answer = answerValues[item.itemId]?.trim();
    if (answer) corrections.push({ itemId: item.itemId, field: "student_answer", value: answer });
    return corrections;
  });
}

export function buildReviewedQuestions(
  drafts: readonly { sourceItemId: string; prompt: string; studentAnswer: string }[],
): ReviewedExtractionQuestion[] {
  return drafts.map(draft => ({
    sourceItemId: draft.sourceItemId,
    prompt: draft.prompt.trim(),
    studentAnswer: draft.studentAnswer.trim() || null,
  }));
}

export const extractionPath = (caseId: string): `/api/v1/${string}` =>
  `/api/v1/cases/${caseId}/extraction`;
export const confirmExtractionPath = (caseId: string): `/api/v1/${string}` =>
  `/api/v1/cases/${caseId}/extraction/confirm`;
export const caseOriginalImagesPath = (caseId: string): `/api/v1/${string}` =>
  `/api/v1/cases/${caseId}/source-assets`;

export const hypothesesPath = (caseId: string): `/api/v1/${string}` =>
  `/api/v1/cases/${caseId}/hypotheses`;
export const runNextPath = (caseId: string): `/api/v1/${string}` =>
  `/api/v1/cases/${caseId}/commands/run-next`;
export const attemptPath = (caseId: string): `/api/v1/${string}` =>
  `/api/v1/cases/${caseId}/attempts`;

function validateConfirm(body: ConfirmExtractionRequest): ConfirmExtractionRequest {
  ensureContractFormats();
  if (!Value.Check(ConfirmExtractionRequestSchema, body)) throw new Error("CASE_REVIEW_REQUEST_INVALID");
  return body;
}

function validateSubmit(body: SubmitAttemptRequest): SubmitAttemptRequest {
  ensureContractFormats();
  if (!Value.Check(SubmitAttemptRequestSchema, body)) throw new Error("CASE_REVIEW_REQUEST_INVALID");
  return body;
}

export function createConfirmExtractionIntent(
  expectedVersion: number,
  confirmedItemIds: string[],
  corrections: ConfirmExtractionRequest["corrections"],
  createKey: () => string = createBrowserUuidV7,
  reviewedQuestions?: ConfirmExtractionRequest["reviewedQuestions"],
): WriteIntent<ConfirmExtractionRequest> {
  const body = validateConfirm({
    expectedVersion,
    confirmedItemIds: [...confirmedItemIds],
    corrections: corrections.map(correction => ({ ...correction })),
    ...(reviewedQuestions === undefined ? {} : {
      reviewedQuestions: reviewedQuestions.map(question => ({ ...question })),
    }),
  });
  return { body, idempotencyKey: createKey() };
}

export function createRunNextIntent(
  expectedVersion: number,
  createKey: () => string = createBrowserUuidV7,
): WriteIntent<{ expectedVersion: number }> {
  const body = { expectedVersion };
  ensureContractFormats();
  if (!Value.Check(RunNextRequestSchema, body)) throw new Error("CASE_REVIEW_REQUEST_INVALID");
  return { body, idempotencyKey: createKey() };
}

export function createProbeIntent(
  expectedVersion: number,
  probeId: string,
  selectedChoiceId: string,
  createKey: () => string = createBrowserUuidV7,
): WriteIntent<SubmitAttemptRequest> {
  const body = validateSubmit({
    expectedVersion,
    probeId,
    selectedChoiceId,
  });
  return { body, idempotencyKey: createKey() };
}

export const getExtraction = (caseId: string, signal?: AbortSignal) =>
  apiGet(extractionPath(caseId), ExtractionViewSchema, signal);

export const getCase = (caseId: string, signal?: AbortSignal) =>
  apiGet(`/api/v1/cases/${caseId}`, CaseViewSchema, signal);

export const confirmExtraction = (caseId: string, intent: WriteIntent<ConfirmExtractionRequest>, signal?: AbortSignal) =>
  apiPost(confirmExtractionPath(caseId), CaseViewSchema, intent.body, intent.idempotencyKey, signal);

export const getCaseOriginalImagesStatus = (caseId: string, signal?: AbortSignal) =>
  apiGet(caseOriginalImagesPath(caseId), CaseSourceAssetsStatusViewSchema, signal);

export const deleteCaseOriginalImages = (caseId: string, idempotencyKey: string, signal?: AbortSignal) =>
  apiDeleteOnce(caseOriginalImagesPath(caseId), DeletedCaseSourceAssetsViewSchema, idempotencyKey, signal);

export const queueRunNext = (caseId: string, intent: WriteIntent<{ expectedVersion: number }>, signal?: AbortSignal) =>
  apiPost(runNextPath(caseId), RunNextQueuedSchema, intent.body, intent.idempotencyKey, signal);

export const getHypotheses = (caseId: string, signal?: AbortSignal) =>
  apiGet(hypothesesPath(caseId), HypothesesViewSchema, signal);

export const submitProbe = (caseId: string, intent: WriteIntent<SubmitAttemptRequest>, signal?: AbortSignal) =>
  apiPost(attemptPath(caseId), AttemptViewSchema, intent.body, intent.idempotencyKey, signal);

export function apiErrorCode(error: unknown): string | null {
  return error instanceof ApiClientError ? error.response.error.code : null;
}

export function isUnknownAfterRetry(error: unknown): boolean {
  return !(error instanceof ApiClientError) || error.response.error.retryable;
}

export function reviewErrorMessage(error: unknown, fallback: string): string {
  const code = apiErrorCode(error);
  switch (code) {
    case "SCHEMA_INVALID":
    case "INVALID_INPUT":
      return "有一项内容需要重新确认，已填写的内容仍会保留。";
    case "VERSION_CONFLICT":
      return "内容已更新，请重新确认后提交。";
    case "IDEMPOTENCY_KEY_REUSED":
      return "这次操作没有完成，请重新确认后再试。";
    case "RESOURCE_NOT_FOUND":
      return "没有找到这份内容，请稍后返回今日页再试。";
    case "EXTRACTION_NOT_READY":
      return "识别内容还在准备中，请稍后再试。";
    default:
      return fallback;
  }
}

export function reviewSuccessIsInterventionReady(state: string): boolean {
  return state === "intervention_ready";
}
