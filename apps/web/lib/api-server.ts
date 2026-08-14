import "server-only";

import type { TSchema } from "@sinclair/typebox";
import { apiRequestUrl } from "./api-client";
import { parseApiOrigin, serverApiUrl } from "./runtime-config";

export function apiServerGet<S extends TSchema>(
  path: `/api/v1/${string}`,
  schema: S,
  signal?: AbortSignal,
) {
  const origin = parseApiOrigin(process.env.GAPPROOF_API_ORIGIN);
  return apiRequestUrl(serverApiUrl(origin, path), schema, signal ? { signal } : {});
}
