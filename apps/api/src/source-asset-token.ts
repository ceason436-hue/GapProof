import { createHmac, timingSafeEqual } from "node:crypto";

export interface SourceAssetTokenClaims {
  readonly assetId: string;
  readonly studentId: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly mimeType: string;
  readonly expiresAt: number;
}

function claimsPayload(claims: SourceAssetTokenClaims): string {
  return [
    claims.assetId,
    claims.studentId,
    claims.sha256,
    String(claims.byteSize),
    claims.mimeType,
    String(claims.expiresAt),
  ].join(".");
}

function signature(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSourceAssetUploadToken(
  secret: string,
  claims: SourceAssetTokenClaims,
): string {
  const payload = claimsPayload(claims);
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${signature(secret, payload)}`;
}

export function verifySourceAssetUploadToken(
  secret: string,
  token: string,
  expected: Omit<SourceAssetTokenClaims, "expiresAt">,
  now = Date.now(),
): boolean {
  const [encodedPayload, providedSignature] = token.split(".");
  if (encodedPayload === undefined || providedSignature === undefined) {
    return false;
  }
  let payload: string;
  try {
    payload = Buffer.from(encodedPayload, "base64url").toString("utf8");
  } catch {
    return false;
  }
  const expectedSignature = signature(secret, payload);
  const left = Buffer.from(providedSignature);
  const right = Buffer.from(expectedSignature);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return false;
  }
  const parts = payload.split(".");
  if (parts.length !== 6) {
    return false;
  }
  const [assetId, studentId, sha256, byteSizeText, mimeType, expiresAtText] = parts;
  const byteSize = Number(byteSizeText);
  const expiresAt = Number(expiresAtText);
  return (
    assetId === expected.assetId &&
    studentId === expected.studentId &&
    sha256 === expected.sha256 &&
    byteSize === expected.byteSize &&
    mimeType === expected.mimeType &&
    Number.isSafeInteger(expiresAt) &&
    expiresAt >= now
  );
}
