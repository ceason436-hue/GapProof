import { Value } from "@sinclair/typebox/value";
import type { Static, TSchema } from "@sinclair/typebox";
import { ApiErrorResponseSchema, apiResponseSchema, type ApiErrorResponse, type ApiResponse } from "@gapproof/contracts";
import { ensureContractFormats } from "./contract-formats";

export class ApiClientError extends Error {
  constructor(readonly response: ApiErrorResponse, readonly status: number) {
    super(response.error.code);
    this.name = "ApiClientError";
  }
}

type RequestOptions = { signal?: AbortSignal; method?: "GET" | "POST"; body?: unknown; idempotencyKey?: string; cache?: "no-store" };

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});

export async function apiRequestUrl<S extends TSchema>(
  url: string,
  schema: S,
  options: RequestOptions = {},
): Promise<ApiResponse<Static<S>>> {
  ensureContractFormats();
  const method = options.method ?? "GET";
  if (method === "POST" && !options.idempotencyKey) throw new Error("POST requests require an Idempotency-Key");
  const maxAttempts = method === "GET" ? 3 : 2;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.cache ? { cache: options.cache } : {}),
        headers: {
          Accept: "application/json",
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      const payload: unknown = await response.json();
      if (response.ok) {
        if (!Value.Check(apiResponseSchema(schema), payload)) throw new Error("API_RESPONSE_INVALID");
        return payload as unknown as ApiResponse<Static<S>>;
      }
      if (!Value.Check(ApiErrorResponseSchema, payload)) throw new Error("API_ERROR_RESPONSE_INVALID");
      const apiError = new ApiClientError(payload, response.status);
      const mayRetry = method === "GET" ? response.status >= 500 && attempt < 2 : payload.error.retryable && attempt < 1;
      if (!mayRetry) throw apiError;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (error instanceof ApiClientError) throw error;
      if (attempt === maxAttempts - 1) throw error;
    }
    await wait(method === "GET" ? 250 * (attempt + 1) : 500, options.signal);
  }
  throw new Error("API_REQUEST_EXHAUSTED");
}

export function apiRequest<S extends TSchema>(
  path: `/api/v1/${string}`,
  schema: S,
  options: RequestOptions = {},
) {
  return apiRequestUrl(path, schema, options);
}

export const apiGet = <S extends TSchema>(path: `/api/v1/${string}`, schema: S, signal?: AbortSignal) =>
  apiRequest(path, schema, signal ? { signal } : {});

export const apiPost = <S extends TSchema>(
  path: `/api/v1/${string}`,
  schema: S,
  body: unknown,
  idempotencyKey: string,
  signal?: AbortSignal,
) => apiRequest(path, schema, { method: "POST", body, idempotencyKey, ...(signal ? { signal } : {}) });
