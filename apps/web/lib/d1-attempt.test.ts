import { describe, expect, it, vi, afterEach } from "vitest";
import { ApiClientError } from "./api-client";
import { canBeginD1Attempt, createD1AttemptRequest, getCaseForD1Attempt, submitD1Attempt } from "./d1-attempt";

const caseId = "0198b111-1111-7000-8000-000000000002";
const taskId = "0198b111-1111-7000-8000-000000000011";
const body = { expectedVersion: 4, itemId: "synthetic-d1-item", selectedChoiceId: "choice-written" };

const response = (data: unknown) => new Response(JSON.stringify({ data, requestId: "request-1", traceId: "trace-1" }), { status: 200 });
const d1Result = {
  attemptId: "0198b111-1111-7000-8000-000000000020", caseId, taskId,
  itemId: body.itemId, selectedChoiceId: body.selectedChoiceId, passed: true,
  scoringMethod: "exact-choice-v1", state: "d7_scheduled", stateVersion: 5,
  completedTask: { id: taskId, caseId, studentId: "0198b111-1111-7000-8000-000000000003", taskType: "d1_retest", status: "completed", title: "D1", rationale: "fixture", estimatedMinutes: 5, scheduledFor: "2026-08-16T00:00:00.000Z", dueAt: "2026-08-16T12:00:00.000Z", completedAt: "2026-08-16T00:05:00.000Z", item: { id: body.itemId, prompt: "x", choices: [{ id: "a", label: "A" }, { id: body.selectedChoiceId, label: "B" }] } },
  scheduledRetest: { id: "0198b111-1111-7000-8000-000000000021", caseId, studentId: "0198b111-1111-7000-8000-000000000003", taskType: "d7_retest", status: "scheduled", title: "D7", rationale: "fixture", estimatedMinutes: 5, scheduledFor: "2026-08-22T00:05:00.000Z", dueAt: "2026-08-22T12:05:00.000Z", completedAt: null, item: { id: "d7-item", prompt: "x", choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }] } },
};

afterEach(() => vi.unstubAllGlobals());

describe("D1 attempt client boundary", () => {
  it("does not create a request until a choice is selected", () => {
    expect(createD1AttemptRequest(4, body.itemId, null)).toBeNull();
    expect(createD1AttemptRequest(4, body.itemId, body.selectedChoiceId)).toEqual(body);
  });

  it("blocks a third write intent after the same-key retry result remains unknown", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(submitD1Attempt(taskId, body, "0198b111-1111-7000-8000-000000000096")).rejects.toThrow("network");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(canBeginD1Attempt(4, body.selectedChoiceId, true)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fetches the authoritative Case before a write", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ id: caseId, studentId: "0198b111-1111-7000-8000-000000000003", state: "d1_scheduled", stateVersion: 4, title: "Synthetic", simulation: true, synthetic: true, updatedAt: "2026-08-16T00:00:00.000Z" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getCaseForD1Attempt(caseId)).resolves.toMatchObject({ data: { stateVersion: 4 } });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/v1/cases/${caseId}`);
  });

  it("retries an unknown result once with the same key and body", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("network")).mockResolvedValueOnce(response(d1Result));
    vi.stubGlobal("fetch", fetchMock);
    await expect(submitD1Attempt(taskId, body, "0198b111-1111-7000-8000-000000000099")).resolves.toMatchObject({ data: { passed: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers["Idempotency-Key"]).toBe(fetchMock.mock.calls[1]?.[1]?.headers["Idempotency-Key"]);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(fetchMock.mock.calls[1]?.[1]?.body);
  });

  it("does not retry a non-retryable attempt error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "INVALID_TASK_STATE", message: "changed", retryable: false }, requestId: "request-2", traceId: "trace-2" }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    const error = await submitD1Attempt(taskId, body, "0198b111-1111-7000-8000-000000000098").catch(value => value);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accepts the service failure branch without inventing an answer key", async () => {
    const failed = {
      ...d1Result,
      passed: false,
      state: "replan_required",
      stateVersion: 5,
      scheduledRetest: null,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(failed)));
    await expect(submitD1Attempt(taskId, body, "0198b111-1111-7000-8000-000000000097"))
      .resolves.toMatchObject({ data: { passed: false, state: "replan_required", scheduledRetest: null } });
    expect(JSON.stringify(failed)).not.toContain("expectedChoiceId");
    expect(JSON.stringify(failed)).not.toContain("answerKey");
  });
});
