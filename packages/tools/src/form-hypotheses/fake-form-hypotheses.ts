import type {
  FormHypothesesInput,
  FormHypothesesOutput,
  ToolRequest,
  ToolResult,
} from "@gapproof/contracts";

export interface FormHypothesesAdapter {
  execute(
    request: ToolRequest<FormHypothesesInput>,
  ): Promise<ToolResult<FormHypothesesOutput>>;
}

export class FakeFormHypothesesAdapter implements FormHypothesesAdapter {
  async execute(
    request: ToolRequest<FormHypothesesInput>,
  ): Promise<ToolResult<FormHypothesesOutput>> {
    const evidenceRefs = [...request.input.confirmedEvidenceRefs];
    const candidates = [
      {
        id: "hyp-participle-form-gap",
        title: "可能还不熟悉过去分词形式",
        explanation:
          "回答使用了过去式 wrote；需要确认是否知道 have/has 后应使用过去分词 written。",
        confidence: 0.72,
        evidenceRefs,
      },
      {
        id: "hyp-auxiliary-meaning-confusion",
        title: "可能没有把 has 识别为完成时助动词",
        explanation:
          "也可能知道 written，但把 has 理解成普通实义动词；需要用最小对比题区分。",
        confidence: 0.58,
        evidenceRefs,
      },
    ];

    return {
      status: "succeeded",
      data: {
        candidates,
        probe: {
          id: "probe-present-perfect-form-v1",
          prompt:
            "Mina has ___ three short notes this week. 请选择最合适的词形。",
          choices: [
            { id: "choice-write", label: "write" },
            { id: "choice-wrote", label: "wrote" },
            { id: "choice-written", label: "written" },
          ],
          testedHypothesisIds: candidates.map((candidate) => candidate.id),
          expectedChoiceId: "choice-written",
        },
      },
      confidence: 0.72,
      evidenceRefs,
      citations: [],
      warnings: ["SYNTHETIC_DIAGNOSIS_FIXTURE"],
      toolVersion: "fake-form-hypotheses-v1",
      latencyMs: 10,
    };
  }
}
