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
    expect(deidentifyTutorText("我叫张小明，我在上海实验中学读书，班级：八年级一班，地址：上海市某区某路 1 号"))
      .not.toMatch(/张小明|上海实验中学|八年级一班|上海市某区/u);
  });

  it("accepts one guarded question and rejects direct-answer or non-question output", () => {
    expect(guardSocraticTutorOutput({ question: "你看到了哪个时态线索？", hint: null, nextAction: "reflect" }))
      .toBeDefined();
    expect(guardSocraticTutorOutput({ question: "答案是 written？", hint: null, nextAction: "reflect" }))
      .toBeUndefined();
    expect(guardSocraticTutorOutput({ question: "请再想一下", hint: null, nextAction: "reflect" }))
      .toBeUndefined();
    expect(guardSocraticTutorOutput({ question: "正确选项是 C，你能看出来吗？", hint: null, nextAction: "reflect" }))
      .toBeUndefined();
    expect(guardSocraticTutorOutput({ question: "你看到了什么？它说明哪个时态？", hint: null, nextAction: "reflect" }))
      .toBeUndefined();
    expect(guardSocraticTutorOutput({ question: "你在哪所学校读书？", hint: null, nextAction: "reflect" }))
      .toBeUndefined();
    expect(guardSocraticTutorOutput({ question: "write 的过去分词和过去式分别是什么？", hint: null, nextAction: "reflect" }))
      .toBeUndefined();
    expect(guardSocraticTutorOutput({ question: "请联系 13812345678 后再想想？", hint: null, nextAction: "reflect" }))
      .toBeUndefined();
    expect(guardSocraticTutorOutput({ question: "你能把答案发到 student@example.com 吗？", hint: null, nextAction: "reflect" }))
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
        history: [{ learnerText: "我先看到了 yesterday。", question: "你从哪个词看出时间？", hint: "联系 13812345678" }],
      },
    });
    expect(result.status).toBe("succeeded");
    expect(JSON.stringify(captured)).not.toContain("13812345678");
    const providerContext = JSON.parse((captured as { input: { userPrompt: string } }).input.userPrompt);
    expect(JSON.stringify(providerContext)).not.toContain("case-1");
    expect(JSON.stringify(providerContext)).not.toContain("student-1");
    expect(JSON.stringify(providerContext)).not.toContain("13812345678");
    expect(providerContext.history).toEqual([{
      learnerText: "我先看到了 yesterday。",
      question: "你从哪个词看出时间?",
      hint: "联系 [手机号已隐藏]",
    }]);
    expect((captured as { input: { inputKind: string } }).input.inputKind).toBe("desensitized");
  });

  it("offers a deterministic fallback without claiming mastery", () => {
    const fallback = ruleTutorFallback({ stepTitle: "先找结构" });
    expect(fallback.question).toContain("先找结构");
    expect(JSON.stringify(fallback)).not.toMatch(/掌握|修复|答对/u);
  });
});
