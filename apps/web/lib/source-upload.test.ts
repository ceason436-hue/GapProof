import { describe, expect, it } from "vitest";
import {
  buildSourceAssetUploadRequest,
  MAX_SOURCE_UPLOAD_BYTES,
  sha256Hex,
  validateSourceUploadFile,
} from "./source-upload";

const studentId = "0198c111-1111-7000-8000-000000000001";

describe("source upload client helpers", () => {
  it("accepts only supported image types within the inclusive size bound", () => {
    expect(validateSourceUploadFile({ type: "image/jpeg", size: 1 })).toEqual({ ok: true });
    expect(validateSourceUploadFile({ type: "image/png", size: MAX_SOURCE_UPLOAD_BYTES })).toEqual({ ok: true });
    expect(validateSourceUploadFile({ type: "image/gif", size: 100 })).toMatchObject({ ok: false });
    expect(validateSourceUploadFile({ type: "image/png", size: MAX_SOURCE_UPLOAD_BYTES + 1 })).toMatchObject({ ok: false });
  });

  it("computes the lowercase SHA-256 of the actual bytes", async () => {
    const bytes = new TextEncoder().encode("GapProof upload fixture");
    await expect(sha256Hex({ arrayBuffer: async () => bytes.buffer as ArrayBuffer })).resolves.toBe(
      "aaf0235c23147b4817b18afc74f003058a51624e076af24034aacb3aa85c456a",
    );
  });

  it("builds the exact shared initiation body without creating a case", () => {
    expect(buildSourceAssetUploadRequest(studentId, {
      name: "wrong-answer.png",
      type: "image/png",
      size: 2048,
    }, "a".repeat(64))).toEqual({
      studentId,
      caseId: null,
      fileName: "wrong-answer.png",
      mimeType: "image/png",
      byteSize: 2048,
      sha256: "a".repeat(64),
    });
  });
});
