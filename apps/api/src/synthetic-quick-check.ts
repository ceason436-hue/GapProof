import type {
  SubmitSyntheticQuickCheckRequest,
  SyntheticQuickCheckResult,
  SyntheticQuickCheckView,
} from "@gapproof/contracts";

const questions = [
  {
    itemId: "quick-check-participle-v1",
    prompt: "Mia has ___ the message to her teacher.",
    choices: [
      { id: "choice-wrote", label: "wrote" },
      { id: "choice-written", label: "written" },
      { id: "choice-writing", label: "writing" },
    ],
    expectedChoiceId: "choice-written",
    finding: "irregular_participle" as const,
  },
  {
    itemId: "quick-check-past-v1",
    prompt: "They ___ to the museum yesterday.",
    choices: [
      { id: "choice-go", label: "go" },
      { id: "choice-went", label: "went" },
      { id: "choice-gone", label: "gone" },
    ],
    expectedChoiceId: "choice-went",
    finding: "past_tense" as const,
  },
  {
    itemId: "quick-check-passive-v1",
    prompt: "The class poster ___ by Leo last week.",
    choices: [
      { id: "choice-is-written", label: "is written" },
      { id: "choice-was-written", label: "was written" },
      { id: "choice-wrote", label: "wrote" },
    ],
    expectedChoiceId: "choice-was-written",
    finding: "passive_voice" as const,
  },
] as const;

export class SyntheticQuickCheckInputError extends Error {
  constructor() {
    super("SYNTHETIC_QUICK_CHECK_INPUT_INVALID");
    this.name = "SyntheticQuickCheckInputError";
  }
}

export function syntheticQuickCheckView(): SyntheticQuickCheckView {
  return {
    mode: "synthetic_demo",
    source: "original_fixture",
    estimatedMinutes: 3,
    questions: questions.map(({ expectedChoiceId: _, finding: __, ...question }) => ({
      ...question,
      choices: question.choices.map((choice) => ({ ...choice })),
    })),
  };
}

export function scoreSyntheticQuickCheck(
  request: SubmitSyntheticQuickCheckRequest,
): SyntheticQuickCheckResult {
  const answers = new Map(request.answers.map((answer) => [answer.itemId, answer.selectedChoiceId]));
  if (answers.size !== questions.length) throw new SyntheticQuickCheckInputError();

  let correctCount = 0;
  const missed = [] as Array<(typeof questions)[number]["finding"]>;
  for (const question of questions) {
    const selectedChoiceId = answers.get(question.itemId);
    if (
      selectedChoiceId === undefined ||
      !question.choices.some((choice) => choice.id === selectedChoiceId)
    ) {
      throw new SyntheticQuickCheckInputError();
    }
    if (selectedChoiceId === question.expectedChoiceId) correctCount += 1;
    else missed.push(question.finding);
  }

  const finding = missed[0] ?? "mixed_review";
  const copy = {
    irregular_participle: {
      summary: "这组三题提示：不规则动词的过去分词形式值得先检查。",
      recommendation: "下一步可以用一个例子区分 wrote 与 written，再换一道题确认。",
    },
    past_tense: {
      summary: "这组三题提示：一般过去时的动词形式值得先检查。",
      recommendation: "下一步可以先抓住明确的过去时间，再选择对应的动词形式。",
    },
    passive_voice: {
      summary: "这组三题提示：一般过去时的被动结构值得先检查。",
      recommendation: "下一步可以先确认动作承受者，再组合 was/were 与过去分词。",
    },
    mixed_review: {
      summary: "这组三道合成题没有显示出单一、稳定的问题方向。",
      recommendation: "可以上传一张真实错题继续确认；本结果不会写入学习记录。",
    },
  } as const;

  return {
    mode: "synthetic_demo",
    source: "original_fixture",
    scoringMethod: "exact-choice-v1",
    correctCount,
    totalCount: 3,
    finding,
    ...copy[finding],
    learningRecordCreated: false,
    reportReady: false,
  };
}
