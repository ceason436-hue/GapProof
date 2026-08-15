import {
  SourceAssetProcessingViewSchema,
  type SourceAssetProcessingView,
} from "@gapproof/contracts";
import { apiGet } from "./api-client";

export const SOURCE_INSPECTION_MAX_WAIT_MS = 30_000;
export const SOURCE_INSPECTION_POLL_DELAYS_MS = [1_000, 2_000, 3_000] as const;

export type SourceInspectionViewFetcher = (
  assetId: string,
  signal: AbortSignal,
) => Promise<SourceAssetProcessingView>;

export type SourceInspectionSleeper = (
  milliseconds: number,
  signal: AbortSignal,
) => Promise<void>;

const wait = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, milliseconds);
  signal.addEventListener("abort", () => {
    clearTimeout(timer);
    reject(signal.reason);
  }, { once: true });
});

export const sourceAssetInspectionPath = (assetId: string): `/api/v1/${string}` =>
  `/api/v1/source-assets/${assetId}`;

export const fetchSourceAssetInspection: SourceInspectionViewFetcher = async (assetId, signal) => {
  const response = await apiGet(sourceAssetInspectionPath(assetId), SourceAssetProcessingViewSchema, signal);
  return response.data;
};

export const isTerminalSourceInspectionStatus = (
  status: SourceAssetProcessingView["processingStatus"],
) => status === "needs_confirmation" || status === "succeeded" || status === "retryable_error" || status === "failed";

export async function pollSourceAssetInspection({
  assetId,
  signal,
  onView,
  fetchView = fetchSourceAssetInspection,
  sleep = wait,
}: {
  assetId: string;
  signal: AbortSignal;
  onView?: (view: SourceAssetProcessingView) => void;
  fetchView?: SourceInspectionViewFetcher;
  sleep?: SourceInspectionSleeper;
}): Promise<SourceAssetProcessingView> {
  let elapsedMilliseconds = 0;
  let delayIndex = 0;
  let firstRead = true;

  while (firstRead || elapsedMilliseconds < SOURCE_INSPECTION_MAX_WAIT_MS) {
    firstRead = false;
    const view = await fetchView(assetId, signal);
    if (view.assetId !== assetId) throw new Error("SOURCE_INSPECTION_ASSET_MISMATCH");
    onView?.(view);
    if (isTerminalSourceInspectionStatus(view.processingStatus)) return view;

    const delay = SOURCE_INSPECTION_POLL_DELAYS_MS[Math.min(delayIndex, SOURCE_INSPECTION_POLL_DELAYS_MS.length - 1)];
    delayIndex += 1;
    await sleep(delay, signal);
    elapsedMilliseconds += delay;
  }

  throw new Error("SOURCE_INSPECTION_TIMEOUT");
}

const qualityReasonMessages: Record<string, string> = {
  low_resolution: "图片分辨率偏低，可能需要重新选择更清楚的图片。",
  mime_mismatch: "图片格式需要重新确认，请重新选择图片。",
  invalid_or_truncated_image: "图片内容不完整，请重新选择图片。",
  pixel_limit_exceeded: "图片尺寸超出检查范围，请重新选择图片。",
  stored_bytes_mismatch: "图片文件校验未通过，请重新选择图片。",
  stored_bytes_missing: "图片文件暂时不可用，请重新选择图片。",
};

export function sourceInspectionMessage(view: SourceAssetProcessingView): string {
  switch (view.processingStatus) {
    case "uploaded":
      return "上传完成，正在准备图片检查。";
    case "queued":
      return "图片检查已排队，可以稍后回来查看。";
    case "processing":
      return "正在检查图片。";
    case "needs_confirmation": {
      const reason = view.quality?.reasons[0];
      return reason ? qualityReasonMessages[reason] : "这张图片需要你确认后才能继续。";
    }
    case "succeeded":
      return "图片基础检查通过，识别尚未开始。";
    case "retryable_error":
      return "图片检查暂时没有完成，可以稍后再试。";
    case "failed":
      return "这张图片暂时无法完成基础检查，请重新选择图片。";
  }
}
