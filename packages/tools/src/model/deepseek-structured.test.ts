import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";

import type { ToolRequest } from "@gapproof/contracts";

import {
  DeepSeekHttpTransport,
  DeepSeekStructuredAdapter,
  DeepSeekTransportError,
  readDeepSeekEnvironment,
  type DeepSeekStructuredInput,
  type DeepSeekTransport,
  type DeepSeekTransportRequest,
  type DeepSeekTransportResponse,
} from "./deepseek-structured.ts";

const outputSchema = Type.Object({ answer: Type.String({ minLength: 1 }) }, { additionalProperties: false });
type Output = { answer: string };

const request: ToolRequest<DeepSeekStructuredInput<Output>> = {
  toolCallId: "tool-call-deepseek-1",
  caseId: "case-synthetic-deepseek-1",
  studentId: "student-synthetic-deepseek-1",
  traceId: "trace-deepseek-1",
  input: {
    inputKind: "synthetic",
    systemPrompt: "Return one bounded answer.",
    userPrompt: "Use the fixture evidence.",
    outputExample: { answer: "fixture" },
  },
  policyVersion: "deepseek-policy-v1",
};

class FakeTransport implements DeepSeekTransport {
  calls: DeepSeekTransportRequest[] = [];

  constructor(private readonly response: DeepSeekTransportResponse) {}

  async execute(transportRequest: DeepSeekTransportRequest): Promise<DeepSeekTransportResponse> {
    this.calls.push(transportRequest);
    return this.response;
  }
}

function adapter(transport: DeepSeekTransport, enabled = true) {
  return new DeepSeekStructuredAdapter({ transport, outputSchema, enabled });
}

describe("DeepSeek environment", () => {
  it("is disabled by default without requiring a key", () => {
    expect(readDeepSeekEnvironment({})).toMatchObject({
      enabled: false,
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      timeoutMs: 30_000,
    });
  });

  it("requires a key and official HTTPS origin when enabled", () => {
    expect(() => readDeepSeekEnvironment({ GAPPROOF_DEEPSEEK_ENABLED: "true" })).toThrow("credentials");
    expect(() => readDeepSeekEnvironment({ DEEPSEEK_BASE_URL: "http://localhost:8080" })).toThrow("official HTTPS");
    expect(() => readDeepSeekEnvironment({ DEEPSEEK_MODEL: "unknown", DEEPSEEK_API_KEY: "key" })).toThrow("not supported");
    expect(() => readDeepSeekEnvironment({ GAPPROOF_DEEPSEEK_ENABLED: "true", DEEPSEEK_API_KEY: "invalid\nheader" })).toThrow("credentials");
  });
});

describe("DeepSeekStructuredAdapter", () => {
  it("is disabled by default and never calls the provider", async () => {
    const transport = new FakeTransport({ status: 200, payload: undefined });
    const result = await adapter(transport, false).execute(request);

    expect(result.error).toMatchObject({ code: "PROVIDER_DISABLED", retryable: false });
    expect(transport.calls).toHaveLength(0);
  });

  it("accepts a bounded structured result and keeps provider details out of the result", async () => {
    const transport = new FakeTransport({
      status: 200,
      payload: {
        content: JSON.stringify({ answer: "fixture result" }),
        model: "deepseek-v4-flash",
        usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
      },
    });
    const result = await adapter(transport).execute(request);

    expect(result).toMatchObject({ status: "succeeded", data: { answer: "fixture result" }, model: "deepseek-v4-flash" });
    expect(result.usage).toEqual({ inputTokens: 4, outputTokens: 2, totalTokens: 6 });
    expect(result.warnings).toEqual(["MODEL_OUTPUT_REQUIRES_LOCAL_GUARD"]);
    expect(transport.calls[0]?.systemPrompt).toContain("Return only valid json");
    expect(JSON.stringify(result)).not.toContain("systemPrompt");
    expect(JSON.stringify(transport.calls[0])).not.toContain(request.caseId);
    expect(JSON.stringify(transport.calls[0])).not.toContain(request.studentId);
    expect(JSON.stringify(transport.calls[0])).not.toContain(request.traceId);
  });

  it("rejects invalid input before transport and validates JSON output locally", async () => {
    const transport = new FakeTransport({ status: 200, payload: { content: "{}", model: "fixture" } });
    const invalidInput = {
      ...request,
      input: { ...request.input, inputKind: "real" },
    } as unknown as ToolRequest<DeepSeekStructuredInput<Output>>;
    const invalidInputResult = await adapter(transport).execute(invalidInput);
    expect(invalidInputResult.error).toMatchObject({ code: "INVALID_INPUT", retryable: false });
    expect(transport.calls).toHaveLength(0);

    const invalidJson = await adapter(new FakeTransport({ status: 200, payload: { content: "not-json", model: "fixture" } })).execute(request);
    expect(invalidJson.error).toMatchObject({ code: "MODEL_OUTPUT_INVALID_JSON", retryable: false });

    const mismatch = await adapter(new FakeTransport({ status: 200, payload: { content: JSON.stringify({ wrong: true }), model: "fixture" } })).execute(request);
    expect(mismatch.error).toMatchObject({ code: "MODEL_OUTPUT_SCHEMA_MISMATCH", retryable: false });

    const empty = await adapter(new FakeTransport({ status: 200, payload: { content: " ", model: "fixture" } })).execute(request);
    expect(empty.error).toMatchObject({ code: "PROVIDER_EMPTY_RESPONSE", retryable: true });

    const malformed = await adapter(new FakeTransport({ status: 200, payload: { raw: "provider-detail" } })).execute(request);
    expect(malformed.error).toMatchObject({ code: "PROVIDER_INVALID_RESPONSE", retryable: false });
    expect(JSON.stringify(malformed)).not.toContain("provider-detail");
  });

  it("returns INVALID_INPUT for missing, malformed, or non-serializable input", async () => {
    const transport = new FakeTransport({ status: 200, payload: { content: "{}", model: "fixture" } });
    const invalidRequests = [
      undefined,
      {},
      { input: null },
      { input: { inputKind: "synthetic" } },
      { input: { ...request.input, systemPrompt: 42 } },
    ];
    for (const invalidRequest of invalidRequests) {
      const result = await adapter(transport).execute(
        invalidRequest as unknown as ToolRequest<DeepSeekStructuredInput<Output>>,
      );
      expect(result.error).toMatchObject({ code: "INVALID_INPUT", retryable: false });
    }

    const anySchemaTransport = new FakeTransport({ status: 200, payload: { content: "{}", model: "fixture" } });
    const anySchemaAdapter = new DeepSeekStructuredAdapter({
      transport: anySchemaTransport,
      outputSchema: Type.Any(),
      enabled: true,
    });
    const undefinedExample = await anySchemaAdapter.execute({
      ...request,
      input: { ...request.input, outputExample: undefined },
    });
    expect(undefinedExample.error).toMatchObject({ code: "INVALID_INPUT", retryable: false });

    const circularExample: Record<string, unknown> = {};
    circularExample.self = circularExample;
    const circularResult = await anySchemaAdapter.execute({
      ...request,
      input: { ...request.input, outputExample: circularExample },
    });
    expect(circularResult.error).toMatchObject({ code: "INVALID_INPUT", retryable: false });
    expect(transport.calls).toHaveLength(0);
    expect(anySchemaTransport.calls).toHaveLength(0);
  });

  it("maps a length finish reason to a retryable truncated-output error", async () => {
    const result = await adapter(new FakeTransport({
      status: 200,
      payload: {
        content: JSON.stringify({ answer: "partial" }),
        finishReason: "length",
        model: "deepseek-v4-flash",
      },
    })).execute(request);

    expect(result).toMatchObject({
      status: "retryable_error",
      error: {
        code: "MODEL_OUTPUT_TRUNCATED",
        retryable: true,
        providerCode: "FINISH_REASON_LENGTH",
      },
    });
    expect(result).not.toHaveProperty("data");
  });

  it.each([
    [400, "INVALID_REQUEST", "failed", false],
    [401, "AUTHENTICATION_FAILED", "failed", false],
    [402, "INSUFFICIENT_BALANCE", "failed", false],
    [403, "PERMISSION_DENIED", "failed", false],
    [408, "PROVIDER_TIMEOUT", "retryable_error", true],
    [422, "INVALID_PARAMETERS", "failed", false],
    [429, "RATE_LIMITED", "retryable_error", true],
    [500, "PROVIDER_UNAVAILABLE", "retryable_error", true],
    [503, "PROVIDER_UNAVAILABLE", "retryable_error", true],
    [404, "PROVIDER_REJECTED", "failed", false],
  ] as const)("maps HTTP %s without leaking provider payload", async (status, code, resultStatus, retryable) => {
    const result = await adapter(new FakeTransport({ status, payload: { secret: "provider-detail" } })).execute(request);
    expect(result).toMatchObject({ status: resultStatus, error: { code, retryable } });
    expect(JSON.stringify(result)).not.toContain("provider-detail");
  });

  it("maps transport errors to stable retryable results", async () => {
    const timeoutTransport: DeepSeekTransport = { execute: async () => { throw new DeepSeekTransportError("timeout"); } };
    const timeoutResult = await adapter(timeoutTransport).execute(request);
    expect(timeoutResult.error).toMatchObject({ code: "PROVIDER_TIMEOUT", retryable: true });

    const networkTransport: DeepSeekTransport = { execute: async () => { throw new Error("raw provider detail"); } };
    const networkResult = await adapter(networkTransport).execute(request);
    expect(networkResult.error).toMatchObject({ code: "PROVIDER_TRANSPORT_ERROR", retryable: true });
    expect(JSON.stringify(networkResult)).not.toContain("raw provider detail");
  });
});

describe("DeepSeekHttpTransport", () => {
  it("uses the official endpoint and keeps the key out of normalized responses", async () => {
    let receivedUrl = "";
    let receivedInit: RequestInit | undefined;
    const transport = new DeepSeekHttpTransport({
      apiKey: "fixture-secret",
      fetchImpl: async (url, init) => {
        receivedUrl = String(url);
        receivedInit = init;
        return new Response(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }], model: "deepseek-v4-flash" }), { status: 200 });
      },
    });
    const response = await transport.execute({
      systemPrompt: "system",
      userPrompt: "user",
      maxTokens: 64,
      timeoutMs: 1_000,
      signal: new AbortController().signal,
    });

    expect(receivedUrl).toBe("https://api.deepseek.com/chat/completions");
    expect(receivedInit?.headers).toMatchObject({ authorization: "Bearer fixture-secret" });
    expect(JSON.parse(String(receivedInit?.body))).toMatchObject({
      model: "deepseek-v4-flash",
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
      max_tokens: 64,
      stream: false,
    });
    expect(JSON.parse(String(receivedInit?.body))).not.toHaveProperty("user_id");
    expect(response).toMatchObject({ status: 200, payload: { content: "{}", finishReason: "stop", model: "deepseek-v4-flash" } });
    expect(JSON.stringify(response)).not.toContain("fixture-secret");
  });

  it("rejects non-official endpoints before a request", () => {
    expect(() => new DeepSeekHttpTransport({ apiKey: "fixture", baseUrl: "http://localhost:8080" })).toThrow("official HTTPS");
  });
});
