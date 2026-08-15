import type { Static, TSchema } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import type { ToolRequest, ToolResult } from "@gapproof/contracts";

export const DEEPSEEK_STRUCTURED_TOOL_VERSION = "deepseek-structured-v1";
export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
export const DEFAULT_DEEPSEEK_TIMEOUT_MS = 30_000;
export const DEFAULT_DEEPSEEK_MAX_TOKENS = 512;

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const MIN_MAX_TOKENS = 64;
const MAX_MAX_TOKENS = 2_048;
const MAX_SYSTEM_PROMPT_CHARS = 4_000;
const MAX_USER_PROMPT_CHARS = 12_000;
const MAX_SCHEMA_CHARS = 8_000;
const MAX_EXAMPLE_CHARS = 4_000;

export type DeepSeekModel = "deepseek-v4-flash" | "deepseek-v4-pro";
export type DeepSeekStructuredInputKind = "synthetic" | "desensitized";

export interface DeepSeekEnvironmentConfig {
  readonly enabled: boolean;
  readonly apiKey?: string;
  readonly baseUrl: typeof DEFAULT_DEEPSEEK_BASE_URL;
  readonly model: DeepSeekModel;
  readonly timeoutMs: number;
}

export interface DeepSeekStructuredInput<T> {
  readonly inputKind: DeepSeekStructuredInputKind;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly outputExample: T;
}

export type DeepSeekStructuredRequest<T> = ToolRequest<DeepSeekStructuredInput<T>>;

export interface DeepSeekTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export type DeepSeekStructuredResult<T> = ToolResult<T> & {
  readonly model?: string;
  readonly usage?: DeepSeekTokenUsage;
};

export interface DeepSeekTransportRequest {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export interface DeepSeekTransportResponse {
  readonly status: number;
  /** Provider-neutral normalized payload. Raw responses stay inside the transport. */
  readonly payload: unknown;
}

export interface DeepSeekTransport {
  execute(request: DeepSeekTransportRequest): Promise<DeepSeekTransportResponse>;
}

export class DeepSeekTransportError extends Error {
  constructor(readonly reason: "timeout" | "network") {
    super(reason === "timeout" ? "Model provider request timed out." : "Model provider request failed.");
    this.name = "DeepSeekTransportError";
  }
}

export interface DeepSeekHttpTransportOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model?: DeepSeekModel;
  readonly fetchImpl?: typeof fetch;
}

const NormalizedResponseSchema = Type.Object(
  {
    content: Type.String(),
    finishReason: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    model: Type.String({ minLength: 1, maxLength: 128 }),
    usage: Type.Optional(
      Type.Object(
        {
          inputTokens: Type.Integer({ minimum: 0 }),
          outputTokens: Type.Integer({ minimum: 0 }),
          totalTokens: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : undefined;
}

function assertServerRuntime(): void {
  if (typeof (globalThis as { window?: unknown }).window !== "undefined") {
    throw new Error("DeepSeek provider code can only run on the server.");
  }
}

function validApiKey(value: string | undefined): value is string {
  return value !== undefined && /^[\x21-\x7e]{1,2048}$/.test(value);
}

function normalizeProviderPayload(value: unknown): Static<typeof NormalizedResponseSchema> | undefined {
  const root = record(value);
  const choices = Array.isArray(root?.choices) ? root.choices : undefined;
  const choice = record(choices?.[0]);
  const message = record(choice?.message);
  const content = message?.content;
  const finishReason = choice?.finish_reason;
  const model = root?.model;
  if (
    (typeof content !== "string" && content !== null) ||
    (finishReason !== undefined && finishReason !== null && typeof finishReason !== "string") ||
    typeof model !== "string"
  ) {
    return undefined;
  }

  const rawUsage = record(root?.usage);
  const inputTokens = nonNegativeInteger(rawUsage?.prompt_tokens);
  const outputTokens = nonNegativeInteger(rawUsage?.completion_tokens);
  const totalTokens = nonNegativeInteger(rawUsage?.total_tokens);
  const usage =
    inputTokens === undefined || outputTokens === undefined || totalTokens === undefined
      ? undefined
      : { inputTokens, outputTokens, totalTokens };

  return {
    content: content ?? "",
    ...(typeof finishReason === "string" ? { finishReason } : {}),
    model,
    ...(usage === undefined ? {} : { usage }),
  };
}

function parseBaseUrl(value: string): typeof DEFAULT_DEEPSEEK_BASE_URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DeepSeek base URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.deepseek.com" ||
    url.port.length > 0 ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error("DeepSeek base URL must be the official HTTPS API origin.");
  }
  return DEFAULT_DEEPSEEK_BASE_URL;
}

function parseModel(value: string): DeepSeekModel {
  if (value !== "deepseek-v4-flash" && value !== "deepseek-v4-pro") {
    throw new Error("DeepSeek model is not supported by this adapter version.");
  }
  return value;
}

function parseTimeout(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error("DeepSeek timeout must be an integer number of milliseconds.");
  }
  const timeoutMs = Number(value);
  if (timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error("DeepSeek timeout must be between 1000 and 120000 milliseconds.");
  }
  return timeoutMs;
}

export function readDeepSeekEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): DeepSeekEnvironmentConfig {
  assertServerRuntime();
  const enabledValue = environment.GAPPROOF_DEEPSEEK_ENABLED?.trim() ?? "false";
  if (enabledValue !== "true" && enabledValue !== "false") {
    throw new Error("GAPPROOF_DEEPSEEK_ENABLED must be true or false.");
  }
  const enabled = enabledValue === "true";
  const baseUrl = parseBaseUrl(
    environment.DEEPSEEK_BASE_URL?.trim() || DEFAULT_DEEPSEEK_BASE_URL,
  );
  const model = parseModel(environment.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL);
  const timeoutMs = parseTimeout(
    environment.DEEPSEEK_TIMEOUT_MS?.trim() || String(DEFAULT_DEEPSEEK_TIMEOUT_MS),
  );

  if (!enabled) return { enabled, baseUrl, model, timeoutMs };

  const apiKey = environment.DEEPSEEK_API_KEY?.trim();
  if (!validApiKey(apiKey)) {
    throw new Error("DeepSeek API credentials are missing or invalid.");
  }
  return { enabled, apiKey, baseUrl, model, timeoutMs };
}

export class DeepSeekHttpTransport implements DeepSeekTransport {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: DeepSeekModel;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DeepSeekHttpTransportOptions) {
    assertServerRuntime();
    this.endpoint = `${parseBaseUrl(options.baseUrl ?? DEFAULT_DEEPSEEK_BASE_URL)}/chat/completions`;
    this.apiKey = options.apiKey.trim();
    if (!validApiKey(this.apiKey)) {
      throw new Error("DeepSeek API credentials are missing or invalid.");
    }
    this.model = parseModel(options.model ?? DEFAULT_DEEPSEEK_MODEL);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async execute(request: DeepSeekTransportRequest): Promise<DeepSeekTransportResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: request.userPrompt },
          ],
          thinking: { type: "disabled" },
          response_format: { type: "json_object" },
          max_tokens: request.maxTokens,
          stream: false,
        }),
        signal: request.signal,
      });
    } catch {
      if (request.signal.aborted) throw new DeepSeekTransportError("timeout");
      throw new DeepSeekTransportError("network");
    }

    if (!response.ok) return { status: response.status, payload: undefined };

    let parsed: unknown;
    try {
      parsed = JSON.parse(await response.text());
    } catch {
      parsed = undefined;
    }
    return { status: response.status, payload: normalizeProviderPayload(parsed) };
  }
}

export interface DeepSeekStructuredAdapterOptions<T extends TSchema> {
  readonly transport: DeepSeekTransport;
  readonly outputSchema: T;
  readonly enabled?: boolean;
  readonly timeoutMs?: number;
  readonly maxTokens?: number;
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function resultBase<T>(latencyMs: number): Pick<
  DeepSeekStructuredResult<T>,
  "evidenceRefs" | "citations" | "toolVersion" | "latencyMs"
> {
  return {
    evidenceRefs: [],
    citations: [],
    toolVersion: DEEPSEEK_STRUCTURED_TOOL_VERSION,
    latencyMs,
  };
}

function errorResult<T>(
  latencyMs: number,
  status: ToolResult<T>["status"],
  code: string,
  message: string,
  retryable: boolean,
  providerCode?: string,
): DeepSeekStructuredResult<T> {
  return {
    ...resultBase<T>(latencyMs),
    status,
    warnings: [],
    error: {
      code,
      message,
      retryable,
      ...(providerCode === undefined ? {} : { providerCode }),
    },
  };
}

function validPrompt(value: string, maximumLength: number): boolean {
  return value.trim().length > 0 && value.length <= maximumLength && !value.includes("\0");
}

interface PreparedStructuredInput {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly serializedExample: string;
}

function prepareStructuredInput<T extends TSchema>(
  request: unknown,
  outputSchema: T,
): PreparedStructuredInput | undefined {
  try {
    const requestRecord = record(request);
    const input = record(requestRecord?.input);
    const inputKind = input?.inputKind;
    const systemPrompt = input?.systemPrompt;
    const userPrompt = input?.userPrompt;
    const outputExample = input?.outputExample;
    if (
      (inputKind !== "synthetic" && inputKind !== "desensitized") ||
      typeof systemPrompt !== "string" ||
      typeof userPrompt !== "string" ||
      !validPrompt(systemPrompt, MAX_SYSTEM_PROMPT_CHARS) ||
      !validPrompt(userPrompt, MAX_USER_PROMPT_CHARS) ||
      !Value.Check(outputSchema, outputExample)
    ) {
      return undefined;
    }

    const serializedExample = JSON.stringify(outputExample);
    if (
      typeof serializedExample !== "string" ||
      serializedExample.length > MAX_EXAMPLE_CHARS
    ) {
      return undefined;
    }
    return {
      systemPrompt: systemPrompt.trim(),
      userPrompt: userPrompt.trim(),
      serializedExample,
    };
  } catch {
    return undefined;
  }
}

export class DeepSeekStructuredAdapter<T extends TSchema> {
  private readonly transport: DeepSeekTransport;
  private readonly outputSchema: T;
  private readonly enabled: boolean;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;
  private readonly serializedSchema: string;

  constructor(options: DeepSeekStructuredAdapterOptions<T>) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_DEEPSEEK_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
      throw new Error("DeepSeek timeout must be between 1000 and 120000 milliseconds.");
    }
    const maxTokens = options.maxTokens ?? DEFAULT_DEEPSEEK_MAX_TOKENS;
    if (!Number.isInteger(maxTokens) || maxTokens < MIN_MAX_TOKENS || maxTokens > MAX_MAX_TOKENS) {
      throw new Error("DeepSeek max tokens must be between 64 and 2048.");
    }
    const serializedSchema = JSON.stringify(options.outputSchema);
    if (serializedSchema.length > MAX_SCHEMA_CHARS) {
      throw new Error("DeepSeek output schema is too large.");
    }
    this.transport = options.transport;
    this.outputSchema = options.outputSchema;
    this.enabled = options.enabled ?? false;
    this.timeoutMs = timeoutMs;
    this.maxTokens = maxTokens;
    this.serializedSchema = serializedSchema;
  }

  async execute(
    request: DeepSeekStructuredRequest<Static<T>>,
  ): Promise<DeepSeekStructuredResult<Static<T>>> {
    const startedAt = Date.now();
    if (!this.enabled) {
      return errorResult(
        elapsedMs(startedAt),
        "failed",
        "PROVIDER_DISABLED",
        "The DeepSeek provider is disabled.",
        false,
      );
    }
    const preparedInput = prepareStructuredInput(request, this.outputSchema);
    if (preparedInput === undefined) {
      return errorResult(
        elapsedMs(startedAt),
        "failed",
        "INVALID_INPUT",
        "Only bounded synthetic or desensitized structured input is accepted.",
        false,
      );
    }

    const systemPrompt = [
      preparedInput.systemPrompt,
      "Return only valid json. Do not include markdown or hidden reasoning.",
      `JSON schema: ${this.serializedSchema}`,
      `JSON example: ${preparedInput.serializedExample}`,
    ].join("\n");

    const controller = new AbortController();
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new DeepSeekTransportError("timeout"));
      }, this.timeoutMs);
    });

    try {
      const response = await Promise.race([
        this.transport.execute({
          systemPrompt,
          userPrompt: preparedInput.userPrompt,
          maxTokens: this.maxTokens,
          timeoutMs: this.timeoutMs,
          signal: controller.signal,
        }),
        timeout,
      ]);

      if (timedOut || controller.signal.aborted) {
        return errorResult(elapsedMs(startedAt), "retryable_error", "PROVIDER_TIMEOUT", "The model provider request timed out.", true);
      }
      if (response.status === 400) {
        return errorResult(elapsedMs(startedAt), "failed", "INVALID_REQUEST", "The model provider rejected the request format.", false, "HTTP_400");
      }
      if (response.status === 401) {
        return errorResult(elapsedMs(startedAt), "failed", "AUTHENTICATION_FAILED", "The model provider rejected authentication.", false, "HTTP_401");
      }
      if (response.status === 402) {
        return errorResult(elapsedMs(startedAt), "failed", "INSUFFICIENT_BALANCE", "The model provider account has insufficient balance.", false, "HTTP_402");
      }
      if (response.status === 403) {
        return errorResult(elapsedMs(startedAt), "failed", "PERMISSION_DENIED", "The model provider denied permission.", false, "HTTP_403");
      }
      if (response.status === 408) {
        return errorResult(elapsedMs(startedAt), "retryable_error", "PROVIDER_TIMEOUT", "The model provider request timed out.", true, "HTTP_408");
      }
      if (response.status === 422) {
        return errorResult(elapsedMs(startedAt), "failed", "INVALID_PARAMETERS", "The model provider rejected request parameters.", false, "HTTP_422");
      }
      if (response.status === 429) {
        return errorResult(elapsedMs(startedAt), "retryable_error", "RATE_LIMITED", "The model provider rate limit was reached.", true, "HTTP_429");
      }
      if (response.status >= 500 && response.status <= 599) {
        return errorResult(elapsedMs(startedAt), "retryable_error", "PROVIDER_UNAVAILABLE", "The model provider is temporarily unavailable.", true, "HTTP_5XX");
      }
      if (response.status < 200 || response.status > 299) {
        return errorResult(elapsedMs(startedAt), "failed", "PROVIDER_REJECTED", "The model provider rejected the request.", false, "HTTP_4XX");
      }
      if (!Value.Check(NormalizedResponseSchema, response.payload)) {
        return errorResult(elapsedMs(startedAt), "failed", "PROVIDER_INVALID_RESPONSE", "The model provider returned an invalid response.", false);
      }
      if (response.payload.finishReason === "length") {
        return errorResult(elapsedMs(startedAt), "retryable_error", "MODEL_OUTPUT_TRUNCATED", "The model output was truncated before completion.", true, "FINISH_REASON_LENGTH");
      }
      if (response.payload.content.trim().length === 0) {
        return errorResult(elapsedMs(startedAt), "retryable_error", "PROVIDER_EMPTY_RESPONSE", "The model provider returned empty content.", true);
      }

      let output: unknown;
      try {
        output = JSON.parse(response.payload.content);
      } catch {
        return errorResult(elapsedMs(startedAt), "failed", "MODEL_OUTPUT_INVALID_JSON", "The model output was not valid JSON.", false);
      }
      if (!Value.Check(this.outputSchema, output)) {
        return errorResult(elapsedMs(startedAt), "failed", "MODEL_OUTPUT_SCHEMA_MISMATCH", "The model output did not match the required schema.", false);
      }

      return {
        ...resultBase<Static<T>>(elapsedMs(startedAt)),
        status: "succeeded",
        data: output,
        model: response.payload.model,
        ...(response.payload.usage === undefined ? {} : { usage: response.payload.usage }),
        warnings: ["MODEL_OUTPUT_REQUIRES_LOCAL_GUARD"],
      };
    } catch (error) {
      const transportError = error instanceof DeepSeekTransportError ? error : new DeepSeekTransportError("network");
      if (timedOut || transportError.reason === "timeout") {
        return errorResult(elapsedMs(startedAt), "retryable_error", "PROVIDER_TIMEOUT", "The model provider request timed out.", true);
      }
      return errorResult(elapsedMs(startedAt), "retryable_error", "PROVIDER_TRANSPORT_ERROR", "The model provider could not be reached.", true);
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  }
}
