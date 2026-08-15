import { Value } from "@sinclair/typebox/value";
import {
  StartSyntheticRecognitionRequestSchema,
  StartSyntheticRecognitionViewSchema,
  type StartSyntheticRecognitionRequest,
} from "@gapproof/contracts";
import { ApiClientError, apiPost } from "./api-client";
import { createBrowserUuidV7 } from "./browser-uuidv7";
import { ensureContractFormats } from "./contract-formats";

export const SYNTHETIC_RECOGNITION_NOTICE =
  "这是合成 OCR 演示；当前上传图片字节不会用于识别；真实 OCR Provider 后置。未满18岁需监护确认。";
export const SYNTHETIC_RECOGNITION_SUCCESS = "案例已创建，合成识别已排队";
export const SYNTHETIC_RECOGNITION_SUCCESS_DETAIL = "上传图片未用于识别";

export type SyntheticRecognitionIntent = {
  idempotencyKey: string;
  body: StartSyntheticRecognitionRequest;
};

export function buildStartSyntheticRecognitionRequest(): StartSyntheticRecognitionRequest {
  const body: StartSyntheticRecognitionRequest = {
    mode: "synthetic_demo",
    guardianConfirmed: true,
  };
  ensureContractFormats();
  if (!Value.Check(StartSyntheticRecognitionRequestSchema, body)) {
    throw new Error("START_RECOGNITION_REQUEST_INVALID");
  }
  return body;
}

export function createSyntheticRecognitionIntent(
  createKey: () => string = createBrowserUuidV7,
): SyntheticRecognitionIntent {
  return {
    idempotencyKey: createKey(),
    body: buildStartSyntheticRecognitionRequest(),
  };
}

export function startSyntheticRecognition(
  assetId: string,
  intent: SyntheticRecognitionIntent,
  signal?: AbortSignal,
) {
  return apiPost(
    `/api/v1/source-assets/${assetId}/commands/start-recognition`,
    StartSyntheticRecognitionViewSchema,
    intent.body,
    intent.idempotencyKey,
    signal,
  );
}

export function syntheticRecognitionErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.response.error.retryable) {
      return "识别启动结果未确认；启动已锁定，页面不会再次启动。";
    }
    switch (error.response.error.code) {
      case "SCHEMA_INVALID":
      case "INVALID_INPUT":
        return "识别启动请求无效；请重新明确确认后再试。";
      case "SOURCE_ASSET_RECOGNITION_NOT_READY":
        return "图片基础检查尚未达到可启动识别的条件；请稍后刷新检查。";
      case "SOURCE_ASSET_ALREADY_BOUND":
        return "这张图片已经绑定到一个案例；页面不会自动再次启动，请重新明确确认后再试。";
      case "IDEMPOTENCY_KEY_REUSED":
        return "这次启动标识已被占用；页面不会自动重交，请重新明确确认后再试。";
      default:
        return "识别启动未完成；请重新明确确认后再试。";
    }
  }
  return "识别启动结果未确认；启动已锁定，页面不会再次启动。";
}

export function isSyntheticRecognitionRetryUnknown(error: unknown): boolean {
  return !(error instanceof ApiClientError) || error.response.error.retryable;
}
