import {
  AlibabaOcrSpikeAdapter,
  createAlibabaEduPaperSdkTransportFromEnv,
  type AlibabaOcrSpikeInputKind,
  type AlibabaOcrTransport,
} from "../src/parse-paper/index.ts";
import { createReadStream, statSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AUTHORIZED_MATERIAL_ROOT = fileURLToPath(
  new URL("../../../reference/test-materials/", import.meta.url),
);
const SUPPORTED_EXTENSIONS = new Set([
  ".bmp",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message: string): never {
  console.error(JSON.stringify({ status: "not_executed", reason: message }));
  process.exit(1);
}

const sourceUrl = argument("--source-url");
const sourceFile = argument("--file");
const inputKind = argument("--input-kind") as
  | AlibabaOcrSpikeInputKind
  | undefined;
if ((sourceUrl === undefined) === (sourceFile === undefined)) {
  fail("EXACTLY_ONE_SOURCE_REQUIRED");
}
if (inputKind !== "synthetic" && inputKind !== "desensitized") {
  fail("INPUT_KIND_MUST_BE_SYNTHETIC_OR_DESENSITIZED");
}

let transport;
try {
  transport = createAlibabaEduPaperSdkTransportFromEnv(process.env);
} catch {
  fail("ALIBABA_CREDENTIALS_OR_ENDPOINT_INVALID");
}

let adapterTransport: AlibabaOcrTransport = transport;
let adapterSourceUrl = sourceUrl;
if (sourceFile !== undefined) {
  const resolvedFile = resolve(sourceFile);
  const relativeFile = relative(AUTHORIZED_MATERIAL_ROOT, resolvedFile);
  if (
    relativeFile.length === 0 ||
    relativeFile.startsWith("..") ||
    resolve(AUTHORIZED_MATERIAL_ROOT, relativeFile) !== resolvedFile
  ) {
    fail("FILE_OUTSIDE_AUTHORIZED_MATERIAL_ROOT");
  }
  if (!SUPPORTED_EXTENSIONS.has(extname(resolvedFile).toLowerCase())) {
    fail("UNSUPPORTED_IMAGE_FORMAT");
  }
  let size: number;
  try {
    size = statSync(resolvedFile).size;
  } catch {
    fail("SOURCE_FILE_UNAVAILABLE");
  }
  if (size <= 0 || size > MAX_IMAGE_BYTES) fail("SOURCE_FILE_SIZE_INVALID");
  adapterSourceUrl = "https://local.invalid/authorized-test-material";
  adapterTransport = {
    execute: (request) =>
      transport.executeBody({
        body: createReadStream(resolvedFile),
        timeoutMs: request.timeoutMs,
        signal: request.signal,
      }),
  };
}

const result = await new AlibabaOcrSpikeAdapter({
  transport: adapterTransport,
  enabled: true,
  timeoutMs: 30_000,
}).execute({
  toolCallId: "dev-alibaba-ocr-smoke",
  caseId: "dev-desensitized-ocr-smoke",
  studentId: "dev-desensitized-ocr-smoke",
  traceId: "dev-alibaba-ocr-smoke",
  input: {
    inputKind,
    sourceUrl: adapterSourceUrl!,
    pageHints: ["single-page"],
  },
  policyVersion: "ocr-sdk-spike-policy-v1",
});

console.log(
  JSON.stringify({
    status: result.status,
    ...(result.data === undefined
      ? {}
      : {
          summary: {
            pageCount: result.data.pages.length,
            itemCount: result.data.items.length,
            confidence: result.confidence,
          },
        }),
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
