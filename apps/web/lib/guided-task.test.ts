import { describe, expect, it, vi, afterEach } from "vitest";
import { ApiClientError } from "./api-client";
import {
  createGuidedTaskIntent,
  createGuidedTaskRequest,
  guidedTaskGuards,
  submitGuidedTask,
} from "./guided-task";

const taskId = "0198b111-1111-7000-8000-000000000012";
const caseId = "0198b111-1111-7000-8000-000000000002";
const stepIds = ["step-1", "step-2", "step-3"];
const body = { expectedVersion: 4, completedStepIds: stepIds };

const task = {
  id: taskId,
  caseId,
  studentId: "0198b111-1111-7000-8000-000000000003",
  taskType: "guided_intervention" as const,
  status: "ready" as const,
  title: "合成引导任务",
  rationale: "受控 guided fixture",
  estimatedMinutes: 8,
  scheduledFor: "2026-08-16T00:00:00.000Z",
  dueAt: "2026-08-16T12:00:00.000Z",
  completedAt: null,
  steps: stepIds.map((id, index) => ({ id, kind: "explain" as const, title: `步骤 ${index + 1}`, content: `完成 ${index + 1}` })),
};

const completion = {
  caseId,
  state: "d1_scheduled" as const,
  stateVersion: 5,
  completedTask: { ...task, status: "completed" as const, completedAt: "2026-08-16T00:05:00.000Z" },
  scheduledRetest: {
    id: "0198b111-1111-7000-8000-000000000021",
    caseId,
    studentId: task.studentId,
    taskType: "d1_retest" as const,
    status: "scheduled" as const,
    title: "D+1 延迟检查",
    rationale: "服务端安排",
    estimatedMinutes: 5,
    scheduledFor: "2026-08-17T00:05:00.000Z",
    dueAt: "2026-08-17T12:05:00.000Z",
    completedAt: null,
    item: { id: "d1-item", prompt: "新题", choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }] },
  },
};

const response = (data: unknown) => new Response(JSON.stringify({ data, requestId: "request-1", traceId: "trace-1" }), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe("guided task request boundary", () => {
  it("requires every known step and freezes the task order", () => {
    expect(createGuidedTaskRequest(4, stepIds, ["step-1", "step-2"])).toBeNull();
    expect(createGuidedTaskRequest(4, stepIds, ["step-1", "unknown", "step-2"])).toBeNull();
    expect(createGuidedTaskRequest(4, stepIds, ["step-3", "step-1", "step-2"])).toEqual(body);
    expect(guidedTaskGuards(4, stepIds, ["step-1", "step-2", "step-3"], false)).toEqual({ editable: true, submitAllowed: true });
    expect(guidedTaskGuards(4, stepIds, ["step-1"], false).submitAllowed).toBe(false);
  });

  it("creates one UUIDv7 intent for a complete selection", () => {
    const createKey = vi.fn(() => "0198b111-1111-7000-8000-000000000099");
    const intent = createGuidedTaskIntent(4, stepIds, ["step-1", "step-2", "step-3"], createKey);
    expect(intent).toEqual({ body, idempotencyKey: "0198b111-1111-7000-8000-000000000099" });
    expect(createKey).toHaveBeenCalledTimes(1);
  });
});

describe("guided task submission boundary", () => {
  it("retries one unknown result with the same key and body", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("network")).mockResolvedValueOnce(response(completion));
    vi.stubGlobal("fetch", fetchMock);
    await expect(submitGuidedTask(taskId, body, "0198b111-1111-7000-8000-000000000099")).resolves.toMatchObject({ data: { state: "d1_scheduled" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers["Idempotency-Key"]).toBe(fetchMock.mock.calls[1]?.[1]?.headers["Idempotency-Key"]);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(fetchMock.mock.calls[1]?.[1]?.body);
  });

  it("does not retry a non-retryable task-state error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "INVALID_TASK_STATE", message: "changed", retryable: false }, requestId: "request-2", traceId: "trace-2" }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    const error = await submitGuidedTask(taskId, body, "0198b111-1111-7000-8000-000000000098").catch(value => value);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
