import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./student-session-server", () => ({
  getCurrentStudentSession: vi.fn().mockResolvedValue({
    session: { studentId: "0198c111-1111-7000-8000-000000000001" },
    cookieHeader: "gapproof_device=opaque-token",
  }),
}));

const originalOrigin = process.env.GAPPROOF_API_ORIGIN;

afterEach(() => {
  if (originalOrigin === undefined) delete process.env.GAPPROOF_API_ORIGIN;
  else process.env.GAPPROOF_API_ORIGIN = originalOrigin;
  vi.unstubAllGlobals();
});

describe("server-side OCR recovery fetch", () => {
  it("uses the device cookie and validates recoverable batch facts", async () => {
    process.env.GAPPROOF_API_ORIGIN = "http://127.0.0.1:3001";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { batches: [{
        batchId: "0198c111-1111-7000-8000-000000000002",
        caseId: "0198c111-1111-7000-8000-000000000003",
        status: "processing",
        pageCount: 2,
        resumeKind: "wait",
        updatedAt: "2026-08-16T08:00:00.000Z",
      }] },
      requestId: "request-recovery-1",
      traceId: "trace-recovery-1",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchRecoverableOcrBatches } = await import("./ocr-recovery-server");

    await expect(fetchRecoverableOcrBatches()).resolves.toMatchObject({
      data: { batches: [{ status: "processing", resumeKind: "wait", pageCount: 2 }] },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:3001/v1/device-session/ocr-batches");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Cookie: "gapproof_device=opaque-token" });
    expect(fetchMock.mock.calls[0]?.[1]?.cache).toBe("no-store");
  });
});
