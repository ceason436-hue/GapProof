import { describe, expect, it } from "vitest";
import {
  SYNTHETIC_RECOGNITION_SUCCESS,
  buildStartSyntheticRecognitionRequest,
  createSyntheticRecognitionIntent,
  syntheticRecognitionErrorMessage,
} from "./source-recognition";
import { ApiClientError } from "./api-client";

describe("source recognition start", () => {
  it("builds the exact shared synthetic request and a fresh UUID intent", () => {
    expect(buildStartSyntheticRecognitionRequest()).toEqual({
      mode: "synthetic_demo",
      guardianConfirmed: true,
    });
    const keys = ["0198c111-1111-7000-8000-000000000010", "0198c111-1111-7000-8000-000000000011"];
    const first = createSyntheticRecognitionIntent(() => keys[0]!);
    const second = createSyntheticRecognitionIntent(() => keys[1]!);
    expect(first.body).toEqual(second.body);
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
    expect(first.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("keeps bounded failure copy free of internal facts", () => {
    expect(SYNTHETIC_RECOGNITION_SUCCESS).toBe("体验内容已准备，正在整理识别内容");
    expect(syntheticRecognitionErrorMessage(new Error("network"))).toContain("暂时无法确认");
    expect(syntheticRecognitionErrorMessage(new Error("network"))).not.toMatch(/asset|case|token|objectKey|OCR/i);
  });

  it("maps controlled API errors and a retryable final response safely", () => {
    const alreadyBound = new ApiClientError({
      error: { code: "SOURCE_ASSET_ALREADY_BOUND", message: "bound", retryable: false },
      requestId: "request",
      traceId: "trace",
    }, 409);
    const retryable = new ApiClientError({
      error: { code: "TEMPORARY", message: "retry", retryable: true },
      requestId: "request",
      traceId: "trace",
    }, 503);
    expect(syntheticRecognitionErrorMessage(alreadyBound)).toContain("已经开始过一次检查");
    expect(syntheticRecognitionErrorMessage(retryable)).toContain("暂时无法确认");
  });
});
