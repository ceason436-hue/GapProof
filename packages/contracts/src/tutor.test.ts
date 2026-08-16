import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  CreateTutorTurnRequestSchema,
  isTutorTurnJobData,
  SocraticTutorContextSchema,
  SocraticTutorOutputSchema,
  TutorSessionViewSchema,
} from "./tutor.ts";

if (!FormatRegistry.Has("uuid")) {
  FormatRegistry.Set("uuid", (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

describe("Socratic tutor contracts", () => {
  it("accepts only a bounded de-identified context and one bounded response", () => {
    expect(Value.Check(SocraticTutorContextSchema, {
      subject: "英语",
      grade: "八年级",
      taskTitle: "理解过去分词",
      stepTitle: "先说出规则",
      stepContent: "have 或 has 后使用过去分词。",
      learnerText: "我觉得这里应该用过去式。",
      history: [{ learnerText: "我先找时间线索。", question: "你看到了哪个时间词？", hint: null }],
    })).toBe(true);
    expect(Value.Check(SocraticTutorContextSchema, {
      subject: "英语", grade: "八年级", taskTitle: "任务", stepTitle: "步骤", stepContent: "内容", learnerText: "思路",
      history: Array.from({ length: 6 }, () => ({ learnerText: "思路", question: "问题？", hint: null })),
    })).toBe(false);
    expect(Value.Check(SocraticTutorOutputSchema, {
      question: "have 后面的词形和一般过去时有什么不同？",
      hint: "先找句子里的 have。",
      nextAction: "reflect",
    })).toBe(true);
    expect(Value.Check(SocraticTutorOutputSchema, {
      question: "直接抄答案",
      hint: null,
      nextAction: "complete_task",
    })).toBe(false);
  });

  it("validates tutor job identity", () => {
    expect(isTutorTurnJobData({
      turnId: "0198b111-1111-7000-8000-000000000004",
      traceId: "trace-1",
    })).toBe(true);
    expect(isTutorTurnJobData({ turnId: "turn-1", traceId: "trace-1" })).toBe(false);
  });

  it("requires bounded student input and an authoritative version", () => {
    expect(Value.Check(CreateTutorTurnRequestSchema, { expectedVersion: 4, stepId: "step-1", learnerText: "我先找句子结构。" })).toBe(true);
    expect(Value.Check(CreateTutorTurnRequestSchema, { stepId: "step-1", learnerText: "我先找句子结构。" })).toBe(false);
    expect(Value.Check(CreateTutorTurnRequestSchema, { expectedVersion: 4, stepId: "step-1", learnerText: "x".repeat(801) })).toBe(false);
  });

  it("exposes only a bounded student-safe conversation history", () => {
    const turn = {
      turnId: "0198b111-1111-7000-8000-000000000004",
      taskId: "0198b111-1111-7000-8000-000000000012",
      status: "succeeded",
      learnerText: "我先找句子里的时间线索。",
      response: {
        question: "这个时间线索说明动作发生在什么时候？",
        hint: "先比较过去和现在。",
        nextAction: "reflect",
      },
      retryable: false,
    };
    expect(Value.Check(TutorSessionViewSchema, { taskId: turn.taskId, turns: [turn] })).toBe(true);
    expect(Value.Check(TutorSessionViewSchema, {
      taskId: turn.taskId,
      turns: [{ ...turn, provider: "deepseek", model: "private-model", inputTokens: 42 }],
    })).toBe(false);
    expect(Value.Check(TutorSessionViewSchema, { taskId: turn.taskId, turns: Array.from({ length: 7 }, () => turn) })).toBe(false);
  });
});
