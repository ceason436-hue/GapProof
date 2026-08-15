import { Value } from "@sinclair/typebox/value";
import {
  InitiateSourceAssetUploadRequestSchema,
  PrepareSourceAssetRequestSchema,
  type InitiateSourceAssetUploadRequest,
  type PrepareSourceAssetRequest,
} from "@gapproof/contracts";
import { ensureContractFormats } from "./contract-formats";

export const MAX_SOURCE_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_SOURCE_UPLOAD_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const satisfies readonly InitiateSourceAssetUploadRequest["mimeType"][];

export type SourceUploadValidation =
  | { ok: true }
  | { ok: false; message: string };

export function validateSourceUploadFile(file: Pick<File, "type" | "size">): SourceUploadValidation {
  if (!(ACCEPTED_SOURCE_UPLOAD_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, message: "请选择 JPG、PNG 或 WebP 图片。" };
  }
  if (file.size < 1 || file.size > MAX_SOURCE_UPLOAD_BYTES) {
    return { ok: false, message: "图片大小需在 1B 到 10MiB 之间。" };
  }
  return { ok: true };
}

export async function sha256Hex(file: Pick<File, "arrayBuffer">): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function buildSourceAssetUploadRequest(
  studentId: string,
  file: Pick<File, "name" | "type" | "size">,
  sha256: string,
): InitiateSourceAssetUploadRequest {
  const request: InitiateSourceAssetUploadRequest = {
    studentId,
    caseId: null,
    fileName: file.name,
    mimeType: file.type as InitiateSourceAssetUploadRequest["mimeType"],
    byteSize: file.size,
    sha256,
  };
  ensureContractFormats();
  if (!Value.Check(InitiateSourceAssetUploadRequestSchema, request)) {
    throw new Error("UPLOAD_REQUEST_INVALID");
  }
  return request;
}

export function buildSourceAssetPrepareRequest(): PrepareSourceAssetRequest {
  const request: PrepareSourceAssetRequest = {};
  ensureContractFormats();
  if (!Value.Check(PrepareSourceAssetRequestSchema, request)) {
    throw new Error("PREPARE_REQUEST_INVALID");
  }
  return request;
}
