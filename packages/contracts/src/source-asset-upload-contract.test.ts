import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  DeletedCaseSourceAssetsViewSchema,
  InitiatedSourceAssetUploadViewSchema,
  InitiateSourceAssetUploadRequestSchema,
  UploadedSourceAssetViewSchema,
} from "./api.ts";

if (!FormatRegistry.Has("uuid")) {
  FormatRegistry.Set("uuid", (value) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}
if (!FormatRegistry.Has("date-time")) {
  FormatRegistry.Set("date-time", (value) => !Number.isNaN(Date.parse(value)));
}

const studentId = "0198c111-1111-7000-8000-000000000001";
const assetId = "0198c111-1111-7000-8000-000000000002";
const sha256 = "a".repeat(64);

describe("source asset upload contract", () => {
  it("represents original-image deletion without claiming extracted content was removed", () => {
    expect(Value.Check(DeletedCaseSourceAssetsViewSchema, {
      caseId: "0198c111-1111-7000-8000-000000000003",
      deletedCount: 2,
      originalImagesDeleted: true,
      extractedContentRetained: true,
    })).toBe(true);
  });

  it("accepts a bounded image upload intent and same-origin target", () => {
    expect(Value.Check(InitiateSourceAssetUploadRequestSchema, {
      studentId,
      caseId: null,
      fileName: "wrong-answer.png",
      mimeType: "image/png",
      byteSize: 1024,
      sha256,
    })).toBe(true);

    expect(Value.Check(InitiatedSourceAssetUploadViewSchema, {
      assetId,
      processingStatus: "pending_upload",
      upload: {
        method: "PUT",
        path: `/api/v1/source-assets/${assetId}/content`,
        token: "t".repeat(32),
        expiresAt: "2026-08-15T01:10:00.000Z",
        mimeType: "image/png",
        byteSize: 1024,
      },
    })).toBe(true);
  });

  it("rejects paths, unsupported media, oversized bytes, and noncanonical hashes", () => {
    const base = {
      studentId,
      caseId: null,
      fileName: "wrong-answer.png",
      mimeType: "image/png",
      byteSize: 1024,
      sha256,
    };
    expect(Value.Check(InitiateSourceAssetUploadRequestSchema, {
      ...base,
      fileName: "../answer.png",
    })).toBe(false);
    expect(Value.Check(InitiateSourceAssetUploadRequestSchema, {
      ...base,
      mimeType: "application/pdf",
    })).toBe(false);
    expect(Value.Check(InitiateSourceAssetUploadRequestSchema, {
      ...base,
      byteSize: 10_485_761,
    })).toBe(false);
    expect(Value.Check(InitiateSourceAssetUploadRequestSchema, {
      ...base,
      sha256: "A".repeat(64),
    })).toBe(false);
  });

  it("keeps object keys, tokens, and filenames out of the completed public view", () => {
    const completed = {
      assetId,
      processingStatus: "uploaded",
      mimeType: "image/webp",
      byteSize: 2048,
      sha256,
    };
    expect(Value.Check(UploadedSourceAssetViewSchema, completed)).toBe(true);
    expect(Value.Check(UploadedSourceAssetViewSchema, {
      ...completed,
      objectKey: "private/object-key",
    })).toBe(false);
    expect(Value.Check(UploadedSourceAssetViewSchema, {
      ...completed,
      token: "t".repeat(32),
    })).toBe(false);
  });
});
