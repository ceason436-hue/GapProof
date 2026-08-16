import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./api-client";

vi.mock("server-only", () => ({}));

const studentId = "11111111-1111-4111-8111-111111111111";
const originalOrigin = process.env.GAPPROOF_API_ORIGIN;

afterEach(() => {
  if (originalOrigin === undefined) delete process.env.GAPPROOF_API_ORIGIN;
  else process.env.GAPPROOF_API_ORIGIN = originalOrigin;
  vi.unstubAllGlobals();
});

describe("server-side Today fetch", () => {
  it("uses an absolute server URL and preserves the API empty state", async () => {
    process.env.GAPPROOF_API_ORIGIN = "http://127.0.0.1:3001";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        studentId,
        timeZone: "Asia/Tokyo",
        profile: {
          studentId,
          grade: null,
          subject: null,
          term: null,
          region: null,
          learningState: null,
          timeZone: "Asia/Tokyo",
          version: 0,
          completed: false,
        },
        currentTaskId: null,
        tasks: [],
        overview: {
          hasStartedJourney: false,
          activityDays: Array.from({ length: 7 }, (_, index) => ({ localDate: `2026-08-${String(10 + index).padStart(2, "0")}`, completedTaskCount: 0 })),
          weeklyGoal: null,
          pendingConfirmationCount: 0,
          recentProgress: [],
          nextCheck: null,
        },
      },
      requestId: "request-1",
      traceId: "trace-1",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchStudentToday } = await import("./today-server");

    await expect(fetchStudentToday(studentId, "gapproof_device=test-token")).resolves.toMatchObject({
      data: { studentId, timeZone: "Asia/Tokyo", currentTaskId: null, tasks: [] },
    });
    expect(fetchMock.mock.calls[0]?.[0])
      .toBe(`http://127.0.0.1:3001/v1/students/${studentId}/today`);
    expect(fetchMock.mock.calls[0]?.[1]?.cache).toBe("no-store");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Cookie: "gapproof_device=test-token" });
  });

  it("surfaces an API error without supplying fallback data", async () => {
    process.env.GAPPROOF_API_ORIGIN = "http://127.0.0.1:3001";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "RESOURCE_NOT_FOUND", message: "not found", retryable: false },
      requestId: "request-2",
      traceId: "trace-2",
    }), { status: 404 })));
    const { fetchStudentToday } = await import("./today-server");

    const error: unknown = await fetchStudentToday(studentId, "gapproof_device=test-token").catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiClientError);
    if (!(error instanceof ApiClientError)) throw new Error("Expected ApiClientError");
    expect(error.response.error.code).toBe("RESOURCE_NOT_FOUND");
    expect(error).not.toHaveProperty("data");
  });

  it("rejects a Today response that omits the shared timeZone contract", async () => {
    process.env.GAPPROOF_API_ORIGIN = "http://127.0.0.1:3001";
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      data: { studentId, currentTaskId: null, tasks: [] },
      requestId: "request-3",
      traceId: "trace-3",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchStudentToday } = await import("./today-server");

    await expect(fetchStudentToday(studentId, "gapproof_device=test-token")).rejects.toThrow("API_RESPONSE_INVALID");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
