import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  PrepareSourceAssetRequestSchema,
  SourceAssetPrepareQueuedViewSchema,
  SourceAssetProcessingViewSchema,
  SourceAssetQualityCheckJobDataSchema,
} from "./api.ts";

if (!FormatRegistry.Has("uuid")) {
  FormatRegistry.Set("uuid", (value) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

const assetId = "0198d111-1111-7000-8000-000000000001";

describe("source asset inspection contracts", () => {
  it("freezes an empty prepare command and an identifier-only job payload", () => {
    expect(Value.Check(PrepareSourceAssetRequestSchema, {})).toBe(true);
    expect(Value.Check(PrepareSourceAssetRequestSchema, { provider: "fake" })).toBe(false);
    expect(Value.Check(SourceAssetQualityCheckJobDataSchema, { assetId })).toBe(true);
    expect(Value.Check(SourceAssetQualityCheckJobDataSchema, {
      assetId,
      objectKey: "must-not-cross-the-queue",
    })).toBe(false);
  });

  it("accepts a queued command response without storage or OCR fields", () => {
    expect(Value.Check(SourceAssetPrepareQueuedViewSchema, {
      assetId,
      stage: "image_quality_check",
      processingStatus: "queued",
    })).toBe(true);
    expect(Value.Check(SourceAssetPrepareQueuedViewSchema, {
      assetId,
      stage: "ocr",
      processingStatus: "queued",
    })).toBe(false);
  });

  it("exposes only deterministic image-header quality facts", () => {
    const view = {
      assetId,
      stage: "image_quality_check",
      processingStatus: "needs_confirmation",
      mimeType: "image/png",
      byteSize: 4096,
      quality: {
        status: "needs_confirmation",
        detectedMimeType: "image/png",
        width: 480,
        height: 320,
        reasons: ["low_resolution"],
        checkerVersion: "image-header-v1",
      },
    };
    expect(Value.Check(SourceAssetProcessingViewSchema, view)).toBe(true);
    expect(Value.Check(SourceAssetProcessingViewSchema, {
      ...view,
      ocrText: "must not be exposed",
    })).toBe(false);
    expect(Value.Check(SourceAssetProcessingViewSchema, {
      ...view,
      quality: { ...view.quality, confidence: 0.9 },
    })).toBe(false);
  });

  it("keeps pending work neutral and rejects database-only upload state", () => {
    expect(Value.Check(SourceAssetProcessingViewSchema, {
      assetId,
      stage: "image_quality_check",
      processingStatus: "processing",
      mimeType: "image/webp",
      byteSize: 512,
      quality: null,
    })).toBe(true);
    expect(Value.Check(SourceAssetProcessingViewSchema, {
      assetId,
      stage: "image_quality_check",
      processingStatus: "pending_upload",
      mimeType: "image/webp",
      byteSize: 512,
      quality: null,
    })).toBe(false);
  });
});
