import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { FormatRegistry } from "@sinclair/typebox";
import {
  AddRealOcrBatchPageRequestSchema,
  CreateRealOcrBatchRequestSchema,
  RealOcrBatchViewSchema,
  ExtractionViewSchema,
  StartRealOcrBatchRequestSchema,
} from "./api.ts";

const id = "0198c111-1111-7000-8000-000000000001";
if (!FormatRegistry.Has("uuid")) FormatRegistry.Set("uuid", (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));

describe("real OCR batch contracts", () => {
  it("keeps processing consent explicit and public status free of provider payloads", () => {
    expect(Value.Check(CreateRealOcrBatchRequestSchema, { studentId: id })).toBe(true);
    expect(Value.Check(StartRealOcrBatchRequestSchema, { guardianConfirmed: true, processingNoticeAccepted: true })).toBe(true);
    expect(Value.Check(StartRealOcrBatchRequestSchema, { guardianConfirmed: true })).toBe(false);
    expect(Value.Check(AddRealOcrBatchPageRequestSchema, { fileName: "page-1.png", mimeType: "image/png", byteSize: 20, sha256: "a".repeat(64) })).toBe(true);
    expect(Value.Check(RealOcrBatchViewSchema, { batchId: id, caseId: id, status: "needs_confirmation", guardianConfirmed: true, version: 1, pages: [{ pageId: id, assetId: id, order: 1, status: "needs_confirmation", retryable: false, needsReview: true }] })).toBe(true);
    expect(Value.Check(ExtractionViewSchema, { caseId: id, state: "awaiting_confirmation", stateVersion: 1, recognitionSource: "real_alibaba", uploadedAssetUsedForRecognition: true, items: [{ itemId: "page-1-item-1", prompt: "题目文本" }] })).toBe(true);
  });
});
