import type {
  BuildInterventionInput,
  BuildInterventionOutput,
  ToolRequest,
  ToolResult,
} from "@gapproof/contracts";

export interface BuildInterventionAdapter {
  execute(
    request: ToolRequest<BuildInterventionInput>,
  ): Promise<ToolResult<BuildInterventionOutput>>;
}

export class FakeBuildInterventionAdapter
  implements BuildInterventionAdapter
{
  async execute(
    request: ToolRequest<BuildInterventionInput>,
  ): Promise<ToolResult<BuildInterventionOutput>> {
    const hasConfirmedCause =
      request.input.selectedHypothesisId === "hyp-participle-form-gap";

    return {
      status: "succeeded",
      data: {
        title: "用 has + written 修复过去分词混淆",
        rationale: hasConfirmedCause
          ? "确认小题支持“过去式与过去分词形式混淆”，先用一个规则和例子完成最小修复。"
          : "确认小题尚未确认单一原因，先用中性的完成时词形复习收集更多证据。",
        knowledgeTarget: "现在完成时中 write 的过去分词形式",
        estimatedMinutes: 8,
        steps: [
          {
            id: "step-understand-rule",
            kind: "explain",
            title: "先看规则",
            content:
              "have/has 后使用过去分词。write 的过去式是 wrote，过去分词是 written。",
          },
          {
            id: "step-worked-example",
            kind: "worked_example",
            title: "看一个例子",
            content:
              "She has written two notes. has 后使用 written，而不是 wrote。",
          },
          {
            id: "step-guided-practice",
            kind: "guided_practice",
            title: "跟着做一次",
            content:
              "朗读并补全：Mina has written three notes. 然后说明为什么不用 wrote。",
          },
        ],
        retests: {
          d1: {
            id: "synthetic-d1-unseen-item-v1",
            prompt: "Mina has ___ three short notes about saving water this week.",
            choices: [
              { id: "choice-wrote", label: "wrote" },
              { id: "choice-written", label: "written" },
              { id: "choice-writing", label: "writing" },
            ],
            expectedChoiceId: "choice-written",
            scoringMethod: "exact-choice-v1",
          },
          d7: {
            id: "synthetic-d7-transfer-item-v1",
            prompt: "The volunteers have ___ three notes about saving water.",
            choices: [
              { id: "choice-wrote", label: "wrote" },
              { id: "choice-written", label: "written" },
              { id: "choice-writing", label: "writing" },
            ],
            expectedChoiceId: "choice-written",
            scoringMethod: "exact-choice-v1",
          },
        },
      },
      confidence: 1,
      evidenceRefs: [request.input.probeEvaluationEventId],
      citations: [],
      warnings: ["SYNTHETIC_INTERVENTION_FIXTURE"],
      toolVersion: "fake-build-intervention-v1",
      latencyMs: 10,
    };
  }
}
