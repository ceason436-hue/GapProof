import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  CreateTutorTurnRequestSchema,
  isTutorTurnJobData,
  SocraticTutorContextSchema,
  SocraticTutorOutputSchema,
} from "./tutor.ts";

describe("Socratic tutor contracts", () => {
  it("accepts only a bounded de-identified context and one bounded response", () => {
    expect(Value.Check(SocraticTutorContextSchema, {
      subject: "英语",
      grade: "八年级",
      taskTitle: "理解过去分词",
      stepTitle: "先说出规则",
      stepContent: "have 或 has 后使用过去分词。",
      learnerText: "我觉得这里应该用过去式。",
    })).toBe(true);
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
});
