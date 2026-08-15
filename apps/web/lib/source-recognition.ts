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
  "当前识别结果来自预设体验内容，不会读取你上传图片中的文字。未满 18 岁请先获得监护人确认。";
export const SYNTHETIC_RECOGNITION_SUCCESS = "体验内容已准备，正在整理识别内容";
export const SYNTHETIC_RECOGNITION_SUCCESS_DETAIL = "本次不会读取上传图片中的文字";

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
      return "暂时无法确认是否已开始识别。为避免重复操作，请返回今日页稍后查看。";
    }
    switch (error.response.error.code) {
      case "SCHEMA_INVALID":
      case "INVALID_INPUT":
        return "暂时无法开始识别，请重新确认后再试。";
      case "SOURCE_ASSET_RECOGNITION_NOT_READY":
        return "图片检查还未完成，请稍后刷新再试。";
      case "SOURCE_ASSET_ALREADY_BOUND":
        return "这张图片已经开始过一次检查，请返回今日页继续。";
      case "IDEMPOTENCY_KEY_REUSED":
        return "这次操作没有完成，请重新确认后再试。";
      default:
        return "识别暂时没有开始，请重新确认后再试。";
    }
  }
  return "暂时无法确认是否已开始识别。为避免重复操作，请返回今日页稍后查看。";
}

export function isSyntheticRecognitionRetryUnknown(error: unknown): boolean {
  return !(error instanceof ApiClientError) || error.response.error.retryable;
}
