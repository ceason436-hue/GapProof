import { describe, expect, it } from "vitest";
import type { BuildInterventionInput, ToolRequest } from "@gapproof/contracts";
import type { DeepSeekTransport, DeepSeekTransportRequest, DeepSeekTransportResponse } from "../model/deepseek-structured.ts";
import { RealBuildInterventionAdapter } from "./real-build-intervention.ts";

const output = {
  title: "分清现在完成时的过去分词",
  rationale: "先澄清形式，再用新句子独立判断。",
  knowledgeTarget: "have 或 has 后使用过去分词",
  estimatedMinutes: 8,
  steps: [
    { kind: "explain", title: "想规则", content: "have 或 has 后需要过去分词。" },
    { kind: "worked_example", title: "看例子", content: "They have finished the work." },
    { kind: "guided_practice", title: "说理由", content: "补全一个新句子，并说明选择依据。" },
  ],
  retests: {
    d1: { prompt: "She has ___ the letter.", choices: ["write", "wrote", "written"], correctIndex: 2 },
    d7: { prompt: "We have ___ our notes.", choices: ["review", "reviewed", "reviewing"], correctIndex: 1 },
  },
};

class Transport implements DeepSeekTransport {
  constructor(private readonly content: unknown = output) {}
  async execute(_request: DeepSeekTransportRequest): Promise<DeepSeekTransportResponse> {
    return { status: 200, payload: { content: JSON.stringify(this.content), model: "fixture" } };
  }
}

const request: ToolRequest<BuildInterventionInput> = {
  toolCallId: "real-intervention-1",
  caseId: "case-real-1",
  studentId: "student-1",
  traceId: "trace-1",
  policyVersion: "real-intervention-policy-v1",
  input: {
    contentSource: "confirmed_real_material",
    probeEvaluationEventId: "event-probe-1",
    selectedHypothesisId: "real-hypothesis-1",
    selectedHypothesis: { title: "可能混淆词形", explanation: "需要确认过去式与过去分词。" },
    probePassed: false,
    confirmedItems: [{ prompt: "They have ___ the task.", studentAnswer: "wrote" }],
  },
};

describe("RealBuildInterventionAdapter", () => {
  it("creates guarded intervention and independent private D1/D7 items", async () => {
    const result = await new RealBuildInterventionAdapter({ transport: new Transport(), enabled: true }).execute(request);
    expect(result.status).toBe("succeeded");
    expect(result.data?.knowledgeTarget).toContain("过去分词");
    expect(result.data?.retests.d1.prompt).not.toBe(result.data?.retests.d7.prompt);
    expect(result.data?.retests.d1.expectedChoiceId).toBe("d1-choice-3");
    expect(result.evidenceRefs).toEqual(["event-probe-1"]);
  });

  it("rejects non-real input instead of falling back to a fixture", async () => {
    const result = await new RealBuildInterventionAdapter({ transport: new Transport(), enabled: true }).execute({
      ...request,
      input: { ...request.input, contentSource: "synthetic_fixture" },
    });
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("REAL_INTERVENTION_CONTEXT_REQUIRED");
  });

  it("fails closed when generated retests copy confirmed material or leak private data", async () => {
    const copied = await new RealBuildInterventionAdapter({ transport: new Transport({
      ...output,
      retests: { ...output.retests, d1: { ...output.retests.d1, prompt: "They have ___ the task." } },
    }), enabled: true }).execute(request);
    expect(copied.error?.code).toBe("MODEL_OUTPUT_LOCAL_GUARD_FAILED");

    const leaked = await new RealBuildInterventionAdapter({ transport: new Transport({ ...output, rationale: "学生姓名：小明" }), enabled: true }).execute(request);
    expect(leaked.error?.code).toBe("MODEL_OUTPUT_LOCAL_GUARD_FAILED");
  });
});
