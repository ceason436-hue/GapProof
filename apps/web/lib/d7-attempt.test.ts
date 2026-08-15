import { afterEach, describe, expect, it, vi } from "vitest";
import { createD7AttemptIntent, createD7AttemptRequest, d7AttemptGuards, submitD7Attempt } from "./d7-attempt";

const taskId = "0198b111-1111-7000-8000-000000000013";
const body = { expectedVersion: 4, itemId: "synthetic-d7-item-v1", selectedChoiceId: "choice-written" };
const response = (data: unknown) => new Response(JSON.stringify({ data, requestId: "request-1", traceId: "trace-1" }), { status: 200 });
const d7Result = {
  attemptId: "0198b111-1111-7000-8000-000000000022",
  caseId: "0198b111-1111-7000-8000-000000000002",
  taskId,
  itemId: body.itemId,
  selectedChoiceId: body.selectedChoiceId,
  passed: true,
  scoringMethod: "exact-choice-v1" as const,
  state: "repair_verified" as const,
  stateVersion: 5,
  completedTask: {
    id: taskId,
    caseId: "0198b111-1111-7000-8000-000000000002",
    studentId: "0198b111-1111-7000-8000-000000000003",
    taskType: "d7_retest" as const,
    status: "completed" as const,
    title: "D7",
    rationale: "fixture",
    estimatedMinutes: 5,
    scheduledFor: "2026-08-22T00:00:00.000Z",
    dueAt: "2026-08-22T12:00:00.000Z",
    completedAt: "2026-08-22T00:05:00.000Z",
    item: { id: body.itemId, prompt: "x", choices: [{ id: "a", label: "A" }, { id: body.selectedChoiceId, label: "B" }] },
  },
  scheduledRetest: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("D7 attempt request boundary", () => {
  it("requires a choice and creates one UUIDv7 intent", () => {
    const createKey = vi.fn(() => "0198b111-1111-7000-8000-000000000099");
    expect(createD7AttemptRequest(4, body.itemId, null)).toBeNull();
    expect(createD7AttemptIntent(4, body.itemId, null, createKey)).toBeNull();
    expect(createKey).not.toHaveBeenCalled();
    expect(createD7AttemptIntent(4, body.itemId, body.selectedChoiceId, createKey)).toEqual({ body, idempotencyKey: "0198b111-1111-7000-8000-000000000099" });
    expect(createKey).toHaveBeenCalledTimes(1);
  });

  it("locks editing and submission after an unknown result", () => {
    expect(d7AttemptGuards(4, body.selectedChoiceId, true)).toEqual({ editable: false, submitAllowed: false });
    expect(d7AttemptGuards(4, body.selectedChoiceId, false)).toEqual({ editable: true, submitAllowed: true });
  });

  it("retries one unknown result with the same key and body", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("network")).mockResolvedValueOnce(response(d7Result));
    vi.stubGlobal("fetch", fetchMock);
    await expect(submitD7Attempt(taskId, body, "0198b111-1111-7000-8000-000000000099")).resolves.toMatchObject({ data: { state: "repair_verified" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers["Idempotency-Key"]).toBe(fetchMock.mock.calls[1]?.[1]?.headers["Idempotency-Key"]);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(fetchMock.mock.calls[1]?.[1]?.body);
  });

  it("retries one explicitly retryable response with the same key and body", async () => {
    const retryable = new Response(JSON.stringify({
      error: { code: "TEMPORARY_UNAVAILABLE", message: "retry", retryable: true },
      requestId: "request-retry",
      traceId: "trace-retry",
    }), { status: 503 });
    const fetchMock = vi.fn().mockResolvedValueOnce(retryable).mockResolvedValueOnce(response(d7Result));
    vi.stubGlobal("fetch", fetchMock);
    await expect(submitD7Attempt(taskId, body, "0198b111-1111-7000-8000-000000000098")).resolves.toMatchObject({ data: { state: "repair_verified" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers["Idempotency-Key"]).toBe(fetchMock.mock.calls[1]?.[1]?.headers["Idempotency-Key"]);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(fetchMock.mock.calls[1]?.[1]?.body);
  });
});
