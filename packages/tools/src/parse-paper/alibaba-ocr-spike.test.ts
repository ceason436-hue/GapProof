import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  ParsePaperResultSchema,
  type ToolRequest,
} from "@gapproof/contracts";

import {
  AlibabaOcrHttpTransport,
  AlibabaOcrSpikeAdapter,
  type AlibabaOcrSpikeInput,
  type AlibabaOcrTransport,
  type AlibabaOcrTransportRequest,
  type AlibabaOcrTransportResponse,
} from "./alibaba-ocr-spike.ts";

const signedSourceUrl = "https://signed.example.invalid/source?fixture=one";

const request: ToolRequest<AlibabaOcrSpikeInput> = {
  toolCallId: "tool-call-alibaba-spike-1",
  caseId: "case-synthetic-spike-1",
  studentId: "student-synthetic-spike-1",
  traceId: "trace-alibaba-spike-1",
  input: {
    inputKind: "synthetic",
    sourceUrl: signedSourceUrl,
    pageHints: ["single-page"],
  },
  policyVersion: "ocr-spike-policy-v1",
};

const normalizedOutput = {
  pages: [{ page: 1, width: 1200, height: 1600 }],
  items: [
    {
      id: "desensitized-item-1",
      prompt: "Choose the correct form.",
      studentAnswer: "wrote",
      coordinates: { page: 1, x: 10, y: 20, width: 100, height: 30 },
      confidence: 0.91,
    },
  ],
  coordinates: [{ page: 1, x: 10, y: 20, width: 100, height: 30 }],
  confidence: 0.91,
  warnings: ["provider-warning-must-not-escape"],
};

class FakeTransport implements AlibabaOcrTransport {
  calls: AlibabaOcrTransportRequest[] = [];

  constructor(private readonly response: AlibabaOcrTransportResponse) {}

  async execute(
    transportRequest: AlibabaOcrTransportRequest,
  ): Promise<AlibabaOcrTransportResponse> {
    this.calls.push(transportRequest);
    return this.response;
  }
}

function adapter(
  transport: AlibabaOcrTransport,
  options: { timeoutMs?: number; minimumConfidence?: number } = {},
) {
  return new AlibabaOcrSpikeAdapter({
    transport,
    enabled: true,
    ...options,
  });
}

describe("AlibabaOcrSpikeAdapter", () => {
  it("is disabled by default and never calls the transport", async () => {
    const transport = new FakeTransport({ status: 200, payload: normalizedOutput });
    const result = await new AlibabaOcrSpikeAdapter({ transport }).execute(request);

    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({
      code: "PROVIDER_DISABLED",
      retryable: false,
    });
    expect(transport.calls).toHaveLength(0);
  });

  it("accepts only synthetic or desensitized HTTPS input", async () => {
    const transport = new FakeTransport({ status: 200, payload: normalizedOutput });
    const invalidRequest = {
      ...request,
      input: { ...request.input, inputKind: "real" },
    } as unknown as ToolRequest<AlibabaOcrSpikeInput>;
    const result = await adapter(transport).execute(invalidRequest);

    expect(result.error).toMatchObject({ code: "INVALID_INPUT", retryable: false });
    expect(transport.calls).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain("fixture=one");
  });

  it("rejects free-text page hints before they can reach the transport", async () => {
    const transport = new FakeTransport({ status: 200, payload: normalizedOutput });
    const result = await adapter(transport).execute({
      ...request,
      input: { ...request.input, pageHints: ["student name: fixture learner"] },
    });

    expect(result.error).toMatchObject({ code: "INVALID_INPUT", retryable: false });
    expect(transport.calls).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain("fixture learner");
  });

  it("bounds timeout and confidence configuration", () => {
    const transport = new FakeTransport({ status: 200, payload: normalizedOutput });

    expect(() => adapter(transport, { timeoutMs: 0 })).toThrow("100 and 30000");
    expect(() => adapter(transport, { timeoutMs: 30_001 })).toThrow("100 and 30000");
    expect(() => adapter(transport, { minimumConfidence: Number.NaN })).toThrow(
      "between zero and one",
    );
  });

  it("uses a provider-neutral payload and coarse confidence without leaking the URL", async () => {
    const transport = new FakeTransport({ status: 200, payload: normalizedOutput });
    const result = await adapter(transport).execute(request);

    expect(result.status).toBe("succeeded");
    expect(Value.Check(ParsePaperResultSchema, result)).toBe(true);
    expect(result.data?.confidence).toBe(0.9);
    expect(result.data?.confidence).not.toBe(0.91);
    expect(result.data?.warnings).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("fixture=one");
    expect(JSON.stringify(result)).not.toContain("provider-warning");
    expect(transport.calls[0]).toMatchObject({
      inputKind: "synthetic",
      sourceUrl: signedSourceUrl,
      pageHints: ["single-page"],
      timeoutMs: 3_000,
    });
  });

  it("maps low confidence and empty output to needs_confirmation", async () => {
    const lowConfidence = new FakeTransport({
      status: 200,
      payload: {
        ...normalizedOutput,
        confidence: 0.42,
        items: [{ ...normalizedOutput.items[0], confidence: 0.42 }],
      },
    });
    const lowResult = await adapter(lowConfidence).execute(request);
    expect(lowResult.status).toBe("needs_confirmation");
    expect(lowResult.warnings).toEqual(["LOW_CONFIDENCE_RESULT"]);
    expect(lowResult.data?.confidence).toBe(0.5);
    expect(lowResult.data?.items[0]?.confidence).toBe(0.5);

    const empty = new FakeTransport({
      status: 200,
      payload: { ...normalizedOutput, items: [], coordinates: [] },
    });
    const emptyResult = await adapter(empty).execute(request);
    expect(emptyResult.status).toBe("needs_confirmation");
    expect(emptyResult.warnings).toEqual(["EMPTY_RESULT"]);
  });

  it.each([
    [401, "AUTHENTICATION_FAILED", "failed", false, "HTTP_401"],
    [403, "PERMISSION_DENIED", "failed", false, "HTTP_403"],
    [408, "PROVIDER_TIMEOUT", "retryable_error", true, "HTTP_408"],
    [429, "RATE_LIMITED", "retryable_error", true, "HTTP_429"],
    [503, "PROVIDER_UNAVAILABLE", "retryable_error", true, "HTTP_5XX"],
    [400, "PROVIDER_REJECTED", "failed", false, "HTTP_4XX"],
  ] as const)("maps HTTP %s to stable tool semantics", async (status, code, resultStatus, retryable, providerCode) => {
    const transport = new FakeTransport({ status, payload: { fixtureRawValue: "provider-response" } });
    const result = await adapter(transport).execute(request);

    expect(result.status).toBe(resultStatus);
    expect(result.error).toMatchObject({ code, retryable, providerCode });
    expect(JSON.stringify(result)).not.toContain("provider-response");
  });

  it("rejects an invalid normalized response without returning raw provider data", async () => {
    const transport = new FakeTransport({
      status: 200,
      payload: { rawProviderResponse: "fixture-raw-value", items: "not-an-array" },
    });
    const result = await adapter(transport).execute(request);

    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({
      code: "PROVIDER_INVALID_RESPONSE",
      retryable: false,
    });
    expect(JSON.stringify(result)).not.toContain("rawProviderResponse");
    expect(JSON.stringify(result)).not.toContain("fixture-raw-value");
  });

  it("maps transport timeout and network failures without exposing exception text", async () => {
    const timeoutTransport: AlibabaOcrTransport = {
      execute: ({ signal }) =>
        new Promise<AlibabaOcrTransportResponse>((resolve) => {
          signal.addEventListener("abort", () => resolve({ status: 504, payload: {} }), {
            once: true,
          });
        }),
    };
    const timeoutResult = await adapter(timeoutTransport, { timeoutMs: 100 }).execute(request);
    expect(timeoutResult.error).toMatchObject({
      code: "PROVIDER_TIMEOUT",
      retryable: true,
    });

    const networkResult = await adapter({
      execute: async () => {
        throw new Error("provider transport detail");
      },
    }).execute(request);
    expect(networkResult.error).toMatchObject({
      code: "PROVIDER_TRANSPORT_ERROR",
      retryable: true,
    });
    expect(JSON.stringify(networkResult)).not.toContain("provider transport detail");
  });
});

describe("AlibabaOcrHttpTransport", () => {
  it("keeps the HTTP seam injectable and credentials out of tool results", async () => {
    let receivedUrl = "";
    let receivedInit: RequestInit | undefined;
    const transport = new AlibabaOcrHttpTransport({
      endpoint: "https://ocr.example.invalid/spike",
      headers: { authorization: "fixture-injected-auth-value" },
      fetchImpl: async (url, init) => {
        receivedUrl = String(url);
        receivedInit = init;
        return new Response(JSON.stringify(normalizedOutput), { status: 200 });
      },
    });

    const response = await transport.execute({
      inputKind: "desensitized",
      sourceUrl: signedSourceUrl,
      pageHints: [],
      timeoutMs: 100,
      signal: new AbortController().signal,
    });

    expect(receivedUrl).toBe("https://ocr.example.invalid/spike");
    expect(receivedInit?.headers).toMatchObject({
      authorization: "fixture-injected-auth-value",
    });
    expect(response.status).toBe(200);
    expect(response.payload).toEqual(normalizedOutput);
  });

  it("rejects non-HTTPS endpoints before any request is possible", () => {
    expect(
      () => new AlibabaOcrHttpTransport({ endpoint: "http://localhost:8080" }),
    ).toThrow("HTTPS");
  });
});
