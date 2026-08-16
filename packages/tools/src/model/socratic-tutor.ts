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
import { deidentifyLearningText } from "./deidentify-learning-text.ts";

export const SOCRATIC_TUTOR_TOOL_VERSION = "socratic-tutor-v1";

const unsafeOutputPatterns = [
  /(?:答案|正确选项|标准答案|参考答案|应选|应该选|选项)(?:是|为|应为|应该是|[:：])?\s*[A-D一二三四1234]/iu,
  /答案(?:是|为)/u,
  /直接(?:填|选|写)/u,
  /身份证|手机号|电话号码|联系方式|家庭住址|学校全名|哪所学校|真实姓名|微信|QQ|学号|班级/u,
  /https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?<!\d)1[3-9]\d{9}(?!\d)|(?<!\d)\d{15,18}[0-9Xx]?(?!\d)/iu,
  /心理诊断|你有(?:病|障碍)/u,
];

export function deidentifyTutorText(value: string): string {
  return deidentifyLearningText(value, 800).text;
}

export function guardSocraticTutorOutput(value: unknown): SocraticTutorOutput | undefined {
  if (!Value.Check(SocraticTutorOutputSchema, value)) return undefined;
  const output = value as SocraticTutorOutput;
  const visibleText = `${output.question}\n${output.hint ?? ""}`;
  if (unsafeOutputPatterns.some((pattern) => pattern.test(visibleText))) return undefined;
  const question = output.question.trim();
  if (!/[?？]$/u.test(question) || (question.match(/[?？]/gu)?.length ?? 0) !== 1) return undefined;
  if (/分别/u.test(question) || /(?:什么|哪个|哪种|如何|怎么).{0,80}(?:以及|并且|同时|和|、).{0,80}(?:什么|哪个|哪种|如何|怎么)/u.test(question)) return undefined;
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
      ...(request.input.history === undefined ? {} : {
        history: request.input.history.slice(-5).map(turn => ({
          learnerText: deidentifyTutorText(turn.learnerText),
          question: deidentifyTutorText(turn.question).slice(0, 240),
          hint: turn.hint === null ? null : deidentifyTutorText(turn.hint).slice(0, 240),
        })),
      }),
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
          "Use prior turns to continue the same line of inquiry without repeating a resolved question.",
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
