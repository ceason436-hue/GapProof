import { Value } from "@sinclair/typebox/value";
import {
  SocraticTutorOutputSchema,
  type SocraticTutorContext,
  type SocraticTutorOutput,
  type ToolRequest,
} from "@gapproof/contracts";

import {
  DeepSeekHttpTransport,
  DeepSeekStructuredAdapter,
  readDeepSeekEnvironment,
  type DeepSeekStructuredInput,
  type DeepSeekStructuredResult,
} from "./deepseek-structured.ts";

export const SOCRATIC_TUTOR_TOOL_VERSION = "socratic-tutor-v1";

const unsafeOutputPatterns = [
  /答案(?:是|为)/u,
  /直接(?:填|选|写)/u,
  /身份证|手机号|家庭住址|学校全名|真实姓名/u,
  /心理诊断|你有(?:病|障碍)/u,
];

export function deidentifyTutorText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/https?:\/\/\S+/giu, "[链接已隐藏]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, "[邮箱已隐藏]")
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/gu, "[手机号已隐藏]")
    .replace(/(?<!\d)\d{15,18}[0-9Xx]?(?!\d)/gu, "[证件号已隐藏]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 800);
}

export function guardSocraticTutorOutput(value: unknown): SocraticTutorOutput | undefined {
  if (!Value.Check(SocraticTutorOutputSchema, value)) return undefined;
  const output = value as SocraticTutorOutput;
  const visibleText = `${output.question}\n${output.hint ?? ""}`;
  if (unsafeOutputPatterns.some((pattern) => pattern.test(visibleText))) return undefined;
  if (!/[?？]$/u.test(output.question.trim())) return undefined;
  return output;
}

export function ruleTutorFallback(context: Pick<SocraticTutorContext, "stepTitle">): SocraticTutorOutput {
  return {
    question: `先回到“${context.stepTitle}”：你能用自己的话说出这一步最关键的依据吗？`,
    hint: "先指出题目中的一个线索，再说明它和规则的关系。",
    nextAction: "reflect",
  };
}

type StructuredModel = Pick<DeepSeekStructuredAdapter<typeof SocraticTutorOutputSchema>, "execute">;

export class SocraticTutorAdapter {
  constructor(private readonly model: StructuredModel) {}

  async execute(request: ToolRequest<SocraticTutorContext>): Promise<DeepSeekStructuredResult<SocraticTutorOutput>> {
    const context = {
      ...request.input,
      subject: deidentifyTutorText(request.input.subject).slice(0, 40),
      grade: deidentifyTutorText(request.input.grade).slice(0, 40),
      taskTitle: deidentifyTutorText(request.input.taskTitle).slice(0, 160),
      stepTitle: deidentifyTutorText(request.input.stepTitle).slice(0, 120),
      stepContent: deidentifyTutorText(request.input.stepContent).slice(0, 1_000),
      learnerText: deidentifyTutorText(request.input.learnerText),
    } satisfies SocraticTutorContext;

    const modelRequest: ToolRequest<DeepSeekStructuredInput<SocraticTutorOutput>> = {
      toolCallId: request.toolCallId,
      caseId: request.caseId,
      studentId: request.studentId,
      traceId: request.traceId,
      policyVersion: request.policyVersion,
      input: {
        inputKind: "desensitized",
        systemPrompt: [
          "You are a bounded Socratic learning tutor for a minor student.",
          "Return exactly one age-appropriate question, an optional hint, and one allowed next action.",
          "Do not reveal the answer, request personal information, diagnose the learner, score mastery, or claim a teacher has intervened.",
        ].join(" "),
        userPrompt: JSON.stringify(context),
        outputExample: {
          question: "你从题目中的哪个线索判断应该使用这条规则？",
          hint: "先找出和时态或结构有关的词。",
          nextAction: "reflect",
        },
      },
    };
    const result = await this.model.execute(modelRequest);
    if (result.status !== "succeeded" || result.data === undefined) return result;
    const guarded = guardSocraticTutorOutput(result.data);
    if (guarded === undefined) {
      return {
        status: "failed",
        evidenceRefs: [],
        citations: [],
        warnings: [],
        toolVersion: SOCRATIC_TUTOR_TOOL_VERSION,
        latencyMs: result.latencyMs,
        error: { code: "TUTOR_OUTPUT_REJECTED", message: "Tutor output failed the local teaching guard.", retryable: false },
      };
    }
    return { ...result, data: guarded, toolVersion: SOCRATIC_TUTOR_TOOL_VERSION };
  }
}

export function createSocraticTutorAdapterFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): SocraticTutorAdapter {
  const config = readDeepSeekEnvironment(environment);
  const transport = config.enabled && config.apiKey !== undefined
    ? new DeepSeekHttpTransport({ apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model })
    : { execute: async () => ({ status: 503, payload: undefined }) };
  return new SocraticTutorAdapter(new DeepSeekStructuredAdapter({
    transport,
    outputSchema: SocraticTutorOutputSchema,
    enabled: config.enabled,
    timeoutMs: config.timeoutMs,
    maxTokens: 384,
  }));
}
