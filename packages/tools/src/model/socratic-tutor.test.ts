import { describe, expect, it } from "vitest";
import type { DeepSeekStructuredResult } from "./deepseek-structured.ts";
import {
  deidentifyTutorText,
  guardSocraticTutorOutput,
  ruleTutorFallback,
  SocraticTutorAdapter,
} from "./socratic-tutor.ts";

const baseResult = {
  status: "succeeded",
  evidenceRefs: [],
  citations: [],
  warnings: ["MODEL_OUTPUT_REQUIRES_LOCAL_GUARD"],
  toolVersion: "deepseek-structured-v1",
  latencyMs: 3,
} as const;

describe("Socratic tutor adapter", () => {
  it("removes common direct identifiers before the provider call", () => {
    expect(deidentifyTutorText("联系 13812345678 或 me@example.com https://example.com"))
      .toBe("联系 [手机号已隐藏] 或 [邮箱已隐藏] [链接已隐藏]");
  });

  it("accepts one guarded question and rejects direct-answer or non-question output", () => {
    expect(guardSocraticTutorOutput({ question: "你看到了哪个时态线索？", hint: null, nextAction: "reflect" }))
      .toBeDefined();
    expect(guardSocraticTutorOutput({ question: "答案是 written？", hint: null, nextAction: "reflect" }))
      .toBeUndefined();
    expect(guardSocraticTutorOutput({ question: "请再想一下", hint: null, nextAction: "reflect" }))
      .toBeUndefined();
  });

  it("sends only a desensitized bounded context and locally guards the response", async () => {
    let captured: unknown;
    const model = {
      async execute(request: unknown): Promise<DeepSeekStructuredResult<{ question: string; hint: string | null; nextAction: "reflect" }>> {
        captured = request;
        return { ...baseResult, data: { question: "你能指出支持这条规则的词吗？", hint: null, nextAction: "reflect" } };
      },
    };
    const result = await new SocraticTutorAdapter(model).execute({
      toolCallId: "turn-1",
      caseId: "case-1",
      studentId: "student-1",
      traceId: "trace-1",
      policyVersion: "socratic-tutor-v1",
      input: {
        subject: "英语",
        grade: "八年级",
        taskTitle: "理解过去分词",
        stepTitle: "先找结构",
        stepContent: "have 后使用过去分词。",
        learnerText: "我的手机号 13812345678，我觉得用过去式。",
      },
    });
    expect(result.status).toBe("succeeded");
    expect(JSON.stringify(captured)).not.toContain("13812345678");
    const providerContext = JSON.parse((captured as { input: { userPrompt: string } }).input.userPrompt);
    expect(JSON.stringify(providerContext)).not.toContain("case-1");
    expect(JSON.stringify(providerContext)).not.toContain("student-1");
    expect((captured as { input: { inputKind: string } }).input.inputKind).toBe("desensitized");
  });

  it("offers a deterministic fallback without claiming mastery", () => {
    const fallback = ruleTutorFallback({ stepTitle: "先找结构" });
    expect(fallback.question).toContain("先找结构");
    expect(JSON.stringify(fallback)).not.toMatch(/掌握|修复|答对/u);
  });
});
