import { Type } from "@sinclair/typebox";

import {
  DeepSeekHttpTransport,
  DeepSeekStructuredAdapter,
  readDeepSeekEnvironment,
  type DeepSeekStructuredInputKind,
} from "../src/model/index.ts";

const SmokeOutputSchema = Type.Object(
  {
    misconception: Type.String({ minLength: 1, maxLength: 160 }),
    evidenceRefs: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
      maxItems: 2,
    }),
    nextPrompt: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(reason: string): never {
  console.error(JSON.stringify({ status: "not_executed", reason }));
  process.exit(1);
}

if (!process.argv.includes("--execute")) fail("EXPLICIT_EXECUTE_FLAG_REQUIRED");

const inputKind = argument("--input-kind") as DeepSeekStructuredInputKind | undefined;
if (inputKind !== "synthetic" && inputKind !== "desensitized") {
  fail("INPUT_KIND_MUST_BE_SYNTHETIC_OR_DESENSITIZED");
}

let config;
try {
  config = readDeepSeekEnvironment(process.env);
} catch {
  fail("DEEPSEEK_CONFIGURATION_INVALID");
}
if (!config.enabled) fail("DEEPSEEK_PROVIDER_DISABLED");
if (config.apiKey === undefined) fail("DEEPSEEK_CREDENTIALS_INVALID");

const result = await new DeepSeekStructuredAdapter({
  transport: new DeepSeekHttpTransport({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
  }),
  outputSchema: SmokeOutputSchema,
  enabled: true,
  timeoutMs: config.timeoutMs,
  maxTokens: 512,
}).execute({
  toolCallId: "dev-deepseek-structured-smoke",
  caseId: "dev-synthetic-model-smoke",
  studentId: "dev-synthetic-model-smoke",
  traceId: "dev-deepseek-structured-smoke",
  policyVersion: "deepseek-structured-smoke-v1",
  input: {
    inputKind,
    systemPrompt:
      "Analyze only the supplied original fictional English exercise. Return a bounded evidence-linked json draft, not a student diagnosis or learning record.",
    userPrompt:
      "Original fictional exercise synthetic-item-1: Complete 'She did not ___ the note.' The fictional answer was 'wrote'; the expected grammar form is 'write'.",
    outputExample: {
      misconception: "The fictional answer uses a past form after did not.",
      evidenceRefs: ["synthetic-item-1"],
      nextPrompt: "Which verb form normally follows did not?",
    },
  },
});

console.log(
  JSON.stringify({
    status: result.status,
    model: result.model ?? config.model,
    latencyMs: result.latencyMs,
    ...(result.usage === undefined ? {} : { usage: result.usage }),
    ...(result.error === undefined
      ? {}
      : { error: { code: result.error.code, retryable: result.error.retryable } }),
    warnings: result.warnings,
  }),
);
if (result.status !== "succeeded") process.exitCode = 1;
