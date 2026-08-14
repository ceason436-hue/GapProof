import { describe, expect, it } from "vitest";

import {
  createSourceAssetUploadToken,
  verifySourceAssetUploadToken,
} from "./source-asset-token.ts";

const claims = {
  assetId: "0198a111-1111-7000-8000-000000000002",
  studentId: "0198a111-1111-7000-8000-000000000003",
  sha256: "a".repeat(64),
  byteSize: 12,
  mimeType: "image/png",
  expiresAt: 1_900_000_000_000,
};

describe("source asset upload tokens", () => {
  it("binds the asset intent and rejects tampering or expiry", () => {
    const token = createSourceAssetUploadToken("test-secret", claims);
    expect(verifySourceAssetUploadToken("test-secret", token, claims, 1_800_000_000_000)).toBe(true);
    expect(verifySourceAssetUploadToken("wrong-secret", token, claims, 1_800_000_000_000)).toBe(false);
    expect(verifySourceAssetUploadToken("test-secret", `${token}x`, claims, 1_800_000_000_000)).toBe(false);
    expect(verifySourceAssetUploadToken("test-secret", `${token}.ignored`, claims, 1_800_000_000_000)).toBe(false);
    expect(verifySourceAssetUploadToken("test-secret", token, claims, 1_900_000_000_001)).toBe(false);
    expect(
      verifySourceAssetUploadToken(
        "test-secret",
        token,
        { ...claims, byteSize: claims.byteSize + 1 },
        1_800_000_000_000,
      ),
    ).toBe(false);
  });
});
