import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, apiGet, apiPost, apiPostOnce, apiPut } from "./api-client";

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("parses a shared response envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { ok: true }, requestId: "r", traceId: "t" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiGet("/api/v1/health", Type.Object({ ok: Type.Boolean() }))).resolves.toMatchObject({ data: { ok: true } });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/health");
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

  it("does not retry a mutation when the caller must recover an unknown result first", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiPostOnce("/api/v1/write", Type.Object({ ok: Type.Boolean() }), { value: 1 }, "once-key")).rejects.toThrow("network");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once when a same-origin proxy returns a non-JSON unknown result", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("proxy failure", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ok: true }, requestId: "r", traceId: "t" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiPost("/api/v1/write", Type.Object({ ok: Type.Boolean() }), { value: 1 }, "stable-key");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers["Idempotency-Key"]).toBe("stable-key");
    expect(fetchMock.mock.calls[1]?.[1]?.headers["Idempotency-Key"]).toBe("stable-key");
  });

  it("retries a raw PUT once with the same token and bytes", async () => {
    const body = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { uploaded: true }, requestId: "r", traceId: "t",
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiPut(
      "/api/v1/source-assets/0198c111-1111-7000-8000-000000000002/content",
      Type.Object({ uploaded: Type.Boolean() }),
      body,
      { "x-gapproof-upload-token": "short-lived-token", "Content-Type": "image/png" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(body);
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(body);
    expect(fetchMock.mock.calls[0]?.[1]?.headers["x-gapproof-upload-token"]).toBe("short-lived-token");
    expect(fetchMock.mock.calls[1]?.[1]?.headers["Content-Type"]).toBe("image/png");
  });
});
