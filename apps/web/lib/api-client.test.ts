import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, apiGet, apiPost } from "./api-client";

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("parses a shared response envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { ok: true }, requestId: "r", traceId: "t" }), { status: 200 })));
    await expect(apiGet("/api/v1/health", Type.Object({ ok: Type.Boolean() }))).resolves.toMatchObject({ data: { ok: true } });
  });
  it("forwards AbortSignal", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError"));
    vi.stubGlobal("fetch", fetchMock);
    controller.abort();
    await expect(apiGet("/api/v1/health", Type.Object({ ok: Type.Boolean() }), controller.signal)).rejects.toThrow();
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
  it("parses the shared error envelope without exposing a second error shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "INVALID_INPUT", message: "internal detail", retryable: false }, requestId: "request-1", traceId: "trace-1" }), { status: 400 })));
    const error = await apiGet("/api/v1/health", Type.Object({ ok: Type.Boolean() })).catch(value => value);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.response).toMatchObject({ error: { code: "INVALID_INPUT" }, requestId: "request-1" });
  });
  it("reuses one idempotency key when a POST network result is unknown", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("network")).mockResolvedValueOnce(new Response(JSON.stringify({ data: { ok: true }, requestId: "r", traceId: "t" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await apiPost("/api/v1/write", Type.Object({ ok: Type.Boolean() }), { value: 1 }, "same-key");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers["Idempotency-Key"]).toBe("same-key");
    expect(fetchMock.mock.calls[1]?.[1]?.headers["Idempotency-Key"]).toBe("same-key");
  });
});
