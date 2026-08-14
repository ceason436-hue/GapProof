import { Value } from "@sinclair/typebox/value";
import { StudentIdParamsSchema } from "@gapproof/contracts";
import { ensureContractFormats } from "./contract-formats";

export type WebConfigurationErrorCode =
  | "API_ORIGIN_MISSING"
  | "API_ORIGIN_INVALID"
  | "DEMO_STUDENT_ID_MISSING"
  | "DEMO_STUDENT_ID_INVALID";

export class WebConfigurationError extends Error {
  constructor(readonly code: WebConfigurationErrorCode) {
    super(code);
    this.name = "WebConfigurationError";
  }
}

export function parseApiOrigin(value: string | undefined): string {
  if (!value?.trim()) throw new WebConfigurationError("API_ORIGIN_MISSING");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WebConfigurationError("API_ORIGIN_INVALID");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username || url.password || url.search || url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new WebConfigurationError("API_ORIGIN_INVALID");
  }
  return url.origin;
}

export function parseDemoStudentId(value: string | undefined): string {
  if (!value?.trim()) throw new WebConfigurationError("DEMO_STUDENT_ID_MISSING");
  ensureContractFormats();
  const params: unknown = { studentId: value.trim() };
  if (!Value.Check(StudentIdParamsSchema, params)) {
    throw new WebConfigurationError("DEMO_STUDENT_ID_INVALID");
  }
  return params.studentId;
}

export function serverApiUrl(origin: string, path: `/api/v1/${string}`): string {
  const normalizedOrigin = parseApiOrigin(origin);
  return new URL(path.slice("/api".length), `${normalizedOrigin}/`).toString();
}
