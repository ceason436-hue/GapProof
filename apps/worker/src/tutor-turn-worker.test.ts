import { describe, expect, it } from "vitest";
import type { TutorTurnRow } from "@gapproof/db";
import { createTutorTurnWorker } from "./tutor-turn-worker.ts";

const turn = {
  id: "0198b111-1111-7000-8000-000000000004",
  sessionId: "0198b111-1111-7000-8000-000000000005",
  studentId: "0198b111-1111-7000-8000-000000000006",
  taskId: "0198b111-1111-7000-8000-000000000007",
  idempotencyKey: "0198b111-1111-7000-8000-000000000008",
  requestHash: "a".repeat(64),
  status: "queued",
  context: {
    subject: "英语", grade: "八年级", taskTitle: "理解过去分词",
    stepTitle: "先找结构", stepContent: "have 后使用过去分词。", learnerText: "我觉得应该用过去式。",
  },
  response: null, provider: null, model: null, inputTokens: null, outputTokens: null,
  errorCode: null, createdAt: new Date(), updatedAt: new Date(), completedAt: null,
} satisfies TutorTurnRow;

function harness(results: Array<Record<string, unknown>>) {
  let handler: ((job: { data: { turnId: string; traceId: string } }) => Promise<object>) | undefined;
  const finished: Array<Record<string, unknown>> = [];
  const store = {
    find: async () => turn,
    claim: async () => ({ ...turn, status: "running" as const }),
    finish: async (input: Record<string, unknown>) => { finished.push(input); return { ...turn, status: input.status as TutorTurnRow["status"] }; },
    fail: async () => undefined,
  };
  const queue = {
    workTutorTurn: async (next: typeof handler) => { handler = next; return "worker-1"; },
    stopTutorTurnWorker: async () => undefined,
  };
  const tutor = { execute: async () => results.shift() as never };
  const worker = createTutorTurnWorker({ database: {} as never, queue: queue as never, store: store as never, tutor });
  return { worker, finished, run: async () => handler?.({ data: { turnId: turn.id, traceId: "trace-1" } }) };
}

describe("tutor turn worker", () => {
  it("persists only the guarded structured model response", async () => {
    const h = harness([{ status: "succeeded", data: { question: "哪个词提示了这条规则？", hint: null, nextAction: "reflect" }, model: "deepseek-v4-flash", usage: { inputTokens: 10, outputTokens: 8 } }]);
    await h.worker.start();
    expect(await h.run()).toMatchObject({ status: "succeeded" });
    expect(h.finished[0]).toMatchObject({ provider: "deepseek", inputTokens: 10, outputTokens: 8 });
    expect(JSON.stringify(h.finished)).not.toContain("reasoning_content");
  });

  it("retries once then persists a rule fallback", async () => {
    const failed = { status: "retryable_error", error: { code: "PROVIDER_TIMEOUT", retryable: true } };
    const h = harness([failed, failed]);
    await h.worker.start();
    expect(await h.run()).toMatchObject({ status: "fallback" });
    expect(h.finished[0]).toMatchObject({ provider: "rule_fallback", errorCode: "PROVIDER_TIMEOUT" });
  });

  it("does not retry a non-retryable safety or schema failure", async () => {
    const h = harness([{ status: "failed", error: { code: "TUTOR_OUTPUT_REJECTED", retryable: false } }]);
    // The harness queue invokes exactly the adapter supplied result; a single result
    // is enough to prove the worker takes the conservative fallback path.
    await h.worker.start();
    expect(await h.run()).toMatchObject({ status: "fallback" });
    expect(h.finished[0]).toMatchObject({ provider: "rule_fallback", errorCode: "TUTOR_OUTPUT_REJECTED" });
  });
});
