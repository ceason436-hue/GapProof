import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./student-session-server", () => ({
  getCurrentStudentSession: vi.fn().mockResolvedValue({
    session: { studentId: "0198c111-1111-7000-8000-000000000001" },
    cookieHeader: "gapproof_device=opaque-token",
  }),
}));

const originalOrigin = process.env.GAPPROOF_API_ORIGIN;
const studentId = "0198c111-1111-7000-8000-000000000001";

afterEach(() => {
  if (originalOrigin === undefined) delete process.env.GAPPROOF_API_ORIGIN;
  else process.env.GAPPROOF_API_ORIGIN = originalOrigin;
  vi.unstubAllGlobals();
});

describe("server-side question archive fetch", () => {
  it("uses only the active device student's path and cookie", async () => {
    process.env.GAPPROOF_API_ORIGIN = "http://127.0.0.1:3001";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { timeZone: "Asia/Shanghai", items: [] },
      requestId: "request-archive-1",
      traceId: "trace-archive-1",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchCurrentStudentQuestionArchive } = await import("./question-archive-server");

    await expect(fetchCurrentStudentQuestionArchive()).resolves.toMatchObject({ data: { items: [] } });
    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:3001/v1/students/${studentId}/question-archive`,
      expect.objectContaining({ cache: "no-store", headers: { Cookie: "gapproof_device=opaque-token", Accept: "application/json" } }),
    );
  });
});
