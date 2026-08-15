import {
  AlibabaOcrSpikeAdapter,
  createAlibabaEduPaperSdkTransportFromEnv,
  type AlibabaOcrSpikeInputKind,
} from "../src/parse-paper/index.ts";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message: string): never {
  console.error(JSON.stringify({ status: "not_executed", reason: message }));
  process.exit(1);
}

const sourceUrl = argument("--source-url");
const inputKind = argument("--input-kind") as
  | AlibabaOcrSpikeInputKind
  | undefined;
if (sourceUrl === undefined) fail("SOURCE_URL_REQUIRED");
if (inputKind !== "synthetic" && inputKind !== "desensitized") {
  fail("INPUT_KIND_MUST_BE_SYNTHETIC_OR_DESENSITIZED");
}

let transport;
try {
  transport = createAlibabaEduPaperSdkTransportFromEnv(process.env);
} catch {
  fail("ALIBABA_CREDENTIALS_OR_ENDPOINT_INVALID");
}

const result = await new AlibabaOcrSpikeAdapter({
  transport,
  enabled: true,
  timeoutMs: 30_000,
}).execute({
  toolCallId: "dev-alibaba-ocr-smoke",
  caseId: "dev-desensitized-ocr-smoke",
  studentId: "dev-desensitized-ocr-smoke",
  traceId: "dev-alibaba-ocr-smoke",
  input: { inputKind, sourceUrl, pageHints: ["single-page"] },
  policyVersion: "ocr-sdk-spike-policy-v1",
});

console.log(
  JSON.stringify({
    status: result.status,
    ...(result.data === undefined ? {} : { data: result.data }),
    ...(result.error === undefined
      ? {}
      : {
          error: {
            code: result.error.code,
            retryable: result.error.retryable,
          },
        }),
    warnings: result.warnings,
  }),
);
if (result.status !== "succeeded" && result.status !== "needs_confirmation") {
  process.exitCode = 1;
}
