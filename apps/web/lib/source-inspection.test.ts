import { describe, expect, it } from "vitest";
import type { SourceAssetProcessingView } from "@gapproof/contracts";
import {
  pollSourceAssetInspection,
  sourceAssetInspectionPath,
  sourceInspectionMessage,
} from "./source-inspection";

const assetId = "0198c111-1111-7000-8000-000000000002";
const baseView = (processingStatus: SourceAssetProcessingView["processingStatus"]): SourceAssetProcessingView => ({
  assetId,
  stage: "image_quality_check",
  processingStatus,
  mimeType: "image/png",
  byteSize: 32,
  quality: null,
});

describe("source inspection client helpers", () => {
  it("uses the same-origin asset status path", () => {
    expect(sourceAssetInspectionPath(assetId)).toBe(`/api/v1/source-assets/${assetId}`);
  });

  it("polls the server status chain with 1s, 2s, 3s backoff", async () => {
    const views = [baseView("queued"), baseView("processing"), baseView("succeeded")];
    const delays: number[] = [];
    const seen: string[] = [];
    const controller = new AbortController();
    await expect(pollSourceAssetInspection({
      assetId,
      signal: controller.signal,
      fetchView: async () => views.shift() ?? baseView("succeeded"),
      sleep: async milliseconds => { delays.push(milliseconds); },
      onView: view => { seen.push(view.processingStatus); },
    })).resolves.toMatchObject({ processingStatus: "succeeded" });
    expect(delays).toEqual([1000, 2000]);
    expect(seen).toEqual(["queued", "processing", "succeeded"]);
  });

  it("stops on abort without inventing a terminal state", async () => {
    const controller = new AbortController();
    await expect(pollSourceAssetInspection({
      assetId,
      signal: controller.signal,
      fetchView: async () => baseView("processing"),
      sleep: async (_milliseconds, signal) => {
        controller.abort("PAGE_HIDDEN");
        throw signal.reason;
      },
    })).rejects.toBe("PAGE_HIDDEN");
  });

  it("times out after the bounded polling budget", async () => {
    const controller = new AbortController();
    await expect(pollSourceAssetInspection({
      assetId,
      signal: controller.signal,
      fetchView: async () => baseView("processing"),
      sleep: async () => undefined,
    })).rejects.toThrow("SOURCE_INSPECTION_TIMEOUT");
  });

  it("maps only stable quality reasons and keeps OCR unstarted", () => {
    expect(sourceInspectionMessage({
      ...baseView("needs_confirmation"),
      quality: {
        status: "needs_confirmation",
        detectedMimeType: "image/png",
        width: 20,
        height: 20,
        reasons: ["low_resolution"],
        checkerVersion: "image-header-v1",
      },
    })).toContain("分辨率偏低");
    expect(sourceInspectionMessage(baseView("succeeded"))).toBe("图片基础检查通过，识别尚未开始。");
  });
});
