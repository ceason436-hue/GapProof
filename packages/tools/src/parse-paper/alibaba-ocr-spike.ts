import {
  ParsePaperOutputSchema,
  type ParsePaperOutput,
  type ToolRequest,
  type ToolResult,
} from "@gapproof/contracts";
import { Value } from "@sinclair/typebox/value";

export const ALIBABA_OCR_SPIKE_TOOL_VERSION = "alibaba-ocr-spike-v1";
export const DEFAULT_ALIBABA_OCR_TIMEOUT_MS = 3_000;
export const DEFAULT_ALIBABA_OCR_MIN_CONFIDENCE = 0.8;
const MIN_ALIBABA_OCR_TIMEOUT_MS = 100;
const MAX_ALIBABA_OCR_TIMEOUT_MS = 30_000;
const PAGE_HINT_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

export type AlibabaOcrSpikeInputKind = "synthetic" | "desensitized";

/** Internal-only input. It is not an API or student-facing DTO. */
export interface AlibabaOcrSpikeInput {
  readonly inputKind: AlibabaOcrSpikeInputKind;
  readonly sourceUrl: string;
  readonly pageHints: readonly string[];
}

export type AlibabaOcrSpikeRequest = ToolRequest<AlibabaOcrSpikeInput>;

export interface AlibabaOcrTransportRequest {
  readonly inputKind: AlibabaOcrSpikeInputKind;
  readonly sourceUrl: string;
  readonly pageHints: readonly string[];
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export interface AlibabaOcrTransportResponse {
  readonly status: number;
  /** Provider-neutral normalized payload; raw provider responses stay in the transport. */
  readonly payload: unknown;
}

export interface AlibabaOcrTransport {
  execute(request: AlibabaOcrTransportRequest): Promise<AlibabaOcrTransportResponse>;
}

export class AlibabaOcrTransportError extends Error {
  constructor(readonly reason: "timeout" | "network") {
    super(reason === "timeout" ? "OCR provider request timed out." : "OCR provider request failed.");
    this.name = "AlibabaOcrTransportError";
  }
}

export interface AlibabaOcrHttpTransportOptions {
  readonly endpoint: string;
  /** Server-injected headers. They are never copied into a ToolResult. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetchImpl?: typeof fetch;
}

/** Generic HTTP seam only; the official Alibaba response protocol is intentionally not frozen here. */
export class AlibabaOcrHttpTransport implements AlibabaOcrTransport {
  private readonly endpoint: string;
  private readonly headers: Readonly<Record<string, string>>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AlibabaOcrHttpTransportOptions) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== "https:") {
      throw new Error("OCR transport endpoint must use HTTPS.");
    }
    this.endpoint = endpoint.toString();
    this.headers = { ...options.headers };
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async execute(
    request: AlibabaOcrTransportRequest,
  ): Promise<AlibabaOcrTransportResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.headers,
        },
        body: JSON.stringify({
          inputKind: request.inputKind,
          sourceUrl: request.sourceUrl,
          pageHints: request.pageHints,
        }),
        signal: request.signal,
      });
    } catch {
      if (request.signal.aborted) {
        throw new AlibabaOcrTransportError("timeout");
      }
      throw new AlibabaOcrTransportError("network");
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    return { status: response.status, payload };
  }
}

export interface AlibabaOcrSpikeAdapterOptions {
  readonly transport: AlibabaOcrTransport;
  readonly enabled?: boolean;
  readonly timeoutMs?: number;
  readonly minimumConfidence?: number;
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function resultBase(latencyMs: number): Pick<
  ToolResult<ParsePaperOutput>,
  "evidenceRefs" | "citations" | "toolVersion" | "latencyMs"
> {
  return {
    evidenceRefs: [],
    citations: [],
    toolVersion: ALIBABA_OCR_SPIKE_TOOL_VERSION,
    latencyMs,
  };
}

function errorResult(
  latencyMs: number,
  status: ToolResult<ParsePaperOutput>["status"],
  code: string,
  message: string,
  retryable: boolean,
  providerCode?: string,
): ToolResult<ParsePaperOutput> {
  return {
    ...resultBase(latencyMs),
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

function validSourceUrl(sourceUrl: string): boolean {
  try {
    const url = new URL(sourceUrl);
    return (
      url.protocol === "https:" &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.hash.length === 0
    );
  } catch {
    return false;
  }
}

function validInput(input: AlibabaOcrSpikeInput): boolean {
  return (
    (input.inputKind === "synthetic" || input.inputKind === "desensitized") &&
    validSourceUrl(input.sourceUrl) &&
    input.pageHints.length <= 8 &&
    input.pageHints.every((hint) => PAGE_HINT_PATTERN.test(hint))
  );
}

function coarseConfidence(value: number, minimumConfidence: number): number {
  return value < minimumConfidence ? 0.5 : 0.9;
}

function sanitizeOutput(
  output: ParsePaperOutput,
  minimumConfidence: number,
): { output: ParsePaperOutput; lowConfidence: boolean; empty: boolean } {
  const lowConfidence =
    output.confidence < minimumConfidence ||
    output.items.some((item) => item.confidence < minimumConfidence);
  const empty = output.items.length === 0;
  const warnings = empty
    ? ["EMPTY_RESULT"]
    : lowConfidence
      ? ["LOW_CONFIDENCE_RESULT"]
      : [];

  return {
    lowConfidence,
    empty,
    output: {
      pages: output.pages.map((page) => ({ ...page })),
      items: output.items.map((item) => ({
        id: item.id,
        prompt: item.prompt,
        ...(item.studentAnswer === undefined
          ? {}
          : { studentAnswer: item.studentAnswer }),
        coordinates: { ...item.coordinates },
        confidence: coarseConfidence(item.confidence, minimumConfidence),
      })),
      coordinates: output.coordinates.map((coordinate) => ({ ...coordinate })),
      confidence: coarseConfidence(output.confidence, minimumConfidence),
      warnings,
    },
  };
}

export class AlibabaOcrSpikeAdapter {
  private readonly transport: AlibabaOcrTransport;
  private readonly enabled: boolean;
  private readonly timeoutMs: number;
  private readonly minimumConfidence: number;

  constructor(options: AlibabaOcrSpikeAdapterOptions) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_ALIBABA_OCR_TIMEOUT_MS;
    if (
      !Number.isInteger(timeoutMs) ||
      timeoutMs < MIN_ALIBABA_OCR_TIMEOUT_MS ||
      timeoutMs > MAX_ALIBABA_OCR_TIMEOUT_MS
    ) {
      throw new Error("OCR timeout must be an integer between 100 and 30000 milliseconds.");
    }
    const minimumConfidence =
      options.minimumConfidence ?? DEFAULT_ALIBABA_OCR_MIN_CONFIDENCE;
    if (
      !Number.isFinite(minimumConfidence) ||
      minimumConfidence <= 0 ||
      minimumConfidence >= 1
    ) {
      throw new Error("OCR minimum confidence must be between zero and one.");
    }
    this.transport = options.transport;
    this.enabled = options.enabled ?? false;
    this.timeoutMs = timeoutMs;
    this.minimumConfidence = minimumConfidence;
  }

  async execute(request: AlibabaOcrSpikeRequest): Promise<ToolResult<ParsePaperOutput>> {
    const startedAt = Date.now();
    if (!this.enabled) {
      return errorResult(
        elapsedMs(startedAt),
        "failed",
        "PROVIDER_DISABLED",
        "The Alibaba OCR spike is disabled.",
        false,
      );
    }
    if (!validInput(request.input)) {
      return errorResult(
        elapsedMs(startedAt),
        "failed",
        "INVALID_INPUT",
        "Only synthetic or desensitized HTTPS source input is accepted.",
        false,
      );
    }

    const controller = new AbortController();
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new AlibabaOcrTransportError("timeout"));
      }, this.timeoutMs);
    });

    try {
      const response = await Promise.race([
        this.transport.execute({
          inputKind: request.input.inputKind,
          sourceUrl: request.input.sourceUrl,
          pageHints: [...request.input.pageHints],
          timeoutMs: this.timeoutMs,
          signal: controller.signal,
        }),
        timeout,
      ]);

      if (timedOut || controller.signal.aborted) {
        return errorResult(
          elapsedMs(startedAt),
          "retryable_error",
          "PROVIDER_TIMEOUT",
          "The OCR provider request timed out.",
          true,
        );
      }
      if (response.status === 401) {
        return errorResult(
          elapsedMs(startedAt),
          "failed",
          "AUTHENTICATION_FAILED",
          "The OCR provider rejected authentication.",
          false,
          "HTTP_401",
        );
      }
      if (response.status === 403) {
        return errorResult(
          elapsedMs(startedAt),
          "failed",
          "PERMISSION_DENIED",
          "The OCR provider denied permission.",
          false,
          "HTTP_403",
        );
      }
      if (response.status === 408) {
        return errorResult(
          elapsedMs(startedAt),
          "retryable_error",
          "PROVIDER_TIMEOUT",
          "The OCR provider request timed out.",
          true,
          "HTTP_408",
        );
      }
      if (response.status === 429) {
        return errorResult(
          elapsedMs(startedAt),
          "retryable_error",
          "RATE_LIMITED",
          "The OCR provider rate limit was reached.",
          true,
          "HTTP_429",
        );
      }
      if (response.status >= 500 && response.status <= 599) {
        return errorResult(
          elapsedMs(startedAt),
          "retryable_error",
          "PROVIDER_UNAVAILABLE",
          "The OCR provider is temporarily unavailable.",
          true,
          "HTTP_5XX",
        );
      }
      if (response.status < 200 || response.status > 299) {
        return errorResult(
          elapsedMs(startedAt),
          "failed",
          "PROVIDER_REJECTED",
          "The OCR provider rejected the request.",
          false,
          "HTTP_4XX",
        );
      }

      if (!Value.Check(ParsePaperOutputSchema, response.payload)) {
        return errorResult(
          elapsedMs(startedAt),
          "failed",
          "PROVIDER_INVALID_RESPONSE",
          "The OCR provider returned an invalid normalized response.",
          false,
        );
      }
      const sanitized = sanitizeOutput(
        response.payload,
        this.minimumConfidence,
      );
      const needsConfirmation = sanitized.lowConfidence || sanitized.empty;
      return {
        ...resultBase(elapsedMs(startedAt)),
        status: needsConfirmation ? "needs_confirmation" : "succeeded",
        data: sanitized.output,
        confidence: sanitized.output.confidence,
        warnings: sanitized.output.warnings,
      };
    } catch (error) {
      const transportError =
        error instanceof AlibabaOcrTransportError
          ? error
          : new AlibabaOcrTransportError("network");
      if (timedOut || transportError.reason === "timeout") {
        return errorResult(
          elapsedMs(startedAt),
          "retryable_error",
          "PROVIDER_TIMEOUT",
          "The OCR provider request timed out.",
          true,
        );
      }
      return errorResult(
        elapsedMs(startedAt),
        "retryable_error",
        "PROVIDER_TRANSPORT_ERROR",
        "The OCR provider could not be reached.",
        true,
      );
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  }
}
