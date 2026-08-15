import { describe, expect, it } from "vitest";
import { ApiClientError } from "./api-client";
import {
  attemptPath,
  confirmExtractionPath,
  createConfirmExtractionIntent,
  createProbeIntent,
  createRunNextIntent,
  extractionPath,
  hypothesesPath,
  reviewErrorMessage,
  runNextPath,
} from "./case-review";

const caseId = "0198c111-1111-7000-8000-000000000003";

describe("same Case recognition review client", () => {
  it("builds shared DTOs with independent idempotency intents", () => {
    const keys = [
      "0198c111-1111-7000-8000-000000000010",
      "0198c111-1111-7000-8000-000000000011",
      "0198c111-1111-7000-8000-000000000012",
    ];
    const confirm = createConfirmExtractionIntent(1, ["item-1"], [], () => keys[0]!);
    const next = createRunNextIntent(2, () => keys[1]!);
    const probe = createProbeIntent(3, "probe-1", "choice-1", () => keys[2]!);
    expect(confirm.body).toEqual({ expectedVersion: 1, confirmedItemIds: ["item-1"], corrections: [] });
    expect(next.body).toEqual({ expectedVersion: 2 });
    expect(probe.body).toEqual({ expectedVersion: 3, probeId: "probe-1", selectedChoiceId: "choice-1" });
    expect(new Set([confirm.idempotencyKey, next.idempotencyKey, probe.idempotencyKey]).size).toBe(3);
  });

  it("uses only same-origin same-Case paths and controlled copy", () => {
    expect(extractionPath(caseId)).toBe(`/api/v1/cases/${caseId}/extraction`);
    expect(confirmExtractionPath(caseId)).toBe(`/api/v1/cases/${caseId}/extraction/confirm`);
    expect(hypothesesPath(caseId)).toBe(`/api/v1/cases/${caseId}/hypotheses`);
    expect(runNextPath(caseId)).toBe(`/api/v1/cases/${caseId}/commands/run-next`);
    expect(attemptPath(caseId)).toBe(`/api/v1/cases/${caseId}/attempts`);
    const notFound = new ApiClientError({ error: { code: "RESOURCE_NOT_FOUND", message: "not found", retryable: false }, requestId: "request", traceId: "trace" }, 404);
    expect(reviewErrorMessage(notFound, "fallback")).toContain("返回今日页");
    expect(reviewErrorMessage(notFound, "fallback")).not.toMatch(/assetId|caseId|jobId|answer|confidence|objectKey/i);
    expect(reviewErrorMessage(notFound, "fallback")).not.toMatch(/Case|服务端|请求编号/);
  });
});
