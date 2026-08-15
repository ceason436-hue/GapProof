import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./api-client";

vi.mock("server-only", () => ({}));

const studentId = "11111111-1111-4111-8111-111111111111";
const originalOrigin = process.env.GAPPROOF_API_ORIGIN;
const originalStudentId = process.env.GAPPROOF_DEMO_STUDENT_ID;

afterEach(() => {
  if (originalOrigin === undefined) delete process.env.GAPPROOF_API_ORIGIN;
  else process.env.GAPPROOF_API_ORIGIN = originalOrigin;
  if (originalStudentId === undefined) delete process.env.GAPPROOF_DEMO_STUDENT_ID;
  else process.env.GAPPROOF_DEMO_STUDENT_ID = originalStudentId;
  vi.unstubAllGlobals();
});

describe("server-side Today fetch", () => {
  it("uses an absolute server URL and preserves the API empty state", async () => {
    process.env.GAPPROOF_API_ORIGIN = "http://127.0.0.1:3001";
    process.env.GAPPROOF_DEMO_STUDENT_ID = studentId;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        studentId,
        timeZone: "Asia/Tokyo",
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
    const { fetchDemoStudentToday } = await import("./today-server");

    await expect(fetchDemoStudentToday()).resolves.toMatchObject({
      data: { studentId, timeZone: "Asia/Tokyo", currentTaskId: null, tasks: [] },
    });
    expect(fetchMock.mock.calls[0]?.[0])
      .toBe(`http://127.0.0.1:3001/v1/students/${studentId}/today`);
    expect(fetchMock.mock.calls[0]?.[1]?.cache).toBe("no-store");
  });

  it("surfaces an API error without supplying fallback data", async () => {
    process.env.GAPPROOF_API_ORIGIN = "http://127.0.0.1:3001";
    process.env.GAPPROOF_DEMO_STUDENT_ID = studentId;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "RESOURCE_NOT_FOUND", message: "not found", retryable: false },
      requestId: "request-2",
      traceId: "trace-2",
    }), { status: 404 })));
    const { fetchDemoStudentToday } = await import("./today-server");

    const error = await fetchDemoStudentToday().catch(value => value);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.response.error.code).toBe("RESOURCE_NOT_FOUND");
    expect(error).not.toHaveProperty("data");
  });

  it("rejects a Today response that omits the shared timeZone contract", async () => {
    process.env.GAPPROOF_API_ORIGIN = "http://127.0.0.1:3001";
    process.env.GAPPROOF_DEMO_STUDENT_ID = studentId;
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      data: { studentId, currentTaskId: null, tasks: [] },
      requestId: "request-3",
      traceId: "trace-3",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchDemoStudentToday } = await import("./today-server");

    await expect(fetchDemoStudentToday()).rejects.toThrow("API_RESPONSE_INVALID");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
