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

describe("server-side progress and report fetch", () => {
  it("uses the device cookie and validates both fact projections", async () => {
    process.env.GAPPROOF_API_ORIGIN = "http://127.0.0.1:3001";
    const fetchMock = vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify({
      data: url.endsWith("/progress")
        ? { studentId, timeZone: "Asia/Shanghai", goals: [], timeline: [] }
        : { studentId, timeZone: "Asia/Shanghai", reports: [] },
      requestId: "request-progress-1",
      traceId: "trace-progress-1",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchCurrentStudentProgress, fetchCurrentStudentReports } = await import("./progress-report-server");

    await expect(fetchCurrentStudentProgress()).resolves.toMatchObject({ data: { studentId, goals: [] } });
    await expect(fetchCurrentStudentReports()).resolves.toMatchObject({ data: { studentId, reports: [] } });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `http://127.0.0.1:3001/v1/students/${studentId}/progress`,
      `http://127.0.0.1:3001/v1/students/${studentId}/reports`,
    ]);
    for (const call of fetchMock.mock.calls) expect(call[1]).toMatchObject({ cache: "no-store", headers: { Cookie: "gapproof_device=opaque-token" } });
  });
});
