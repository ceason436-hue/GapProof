import { Value } from "@sinclair/typebox/value";
import { describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";

import { ParsePaperResultSchema } from "@gapproof/contracts";

import {
  AlibabaEduPaperSdkTransport,
  ALIBABA_OCR_LOW_TEXT_QUALITY_WARNING,
  createAlibabaEduPaperSdkTransportFromEnv,
  isAlibabaOcrTextLowQuality,
  normalizeAlibabaEduPaperResponse,
  type AlibabaEduPaperSdkClient,
} from "./alibaba-ocr-official.ts";
import { AlibabaOcrSpikeAdapter } from "./alibaba-ocr-spike.ts";

const providerData = {
  width: 1200,
  height: 1600,
  content: "Choose the correct form.",
  prism_wordsInfo: [
    {
      word: "Choose the correct form.",
      x: 10,
      y: 20,
      width: 300,
      height: 40,
      prob: 96,
    },
  ],
};

function sdkClient(response: unknown): {
  client: AlibabaEduPaperSdkClient;
  call: ReturnType<typeof vi.fn>;
} {
  const call = vi.fn().mockResolvedValue(response);
  return {
    client: { recognizeEduPaperOcrWithOptions: call },
    call,
  };
}

describe("normalizeAlibabaEduPaperResponse", () => {
  it("normalizes the SDK string payload into ParsePaperOutput", () => {
    expect(normalizeAlibabaEduPaperResponse(JSON.stringify(providerData))).toEqual({
      pages: [{ page: 1, width: 1200, height: 1600 }],
      items: [
        {
          id: "alibaba-page-1",
          prompt: "Choose the correct form.",
          coordinates: { page: 1, x: 0, y: 0, width: 1200, height: 1600 },
          confidence: 0.96,
        },
      ],
      coordinates: [{ page: 1, x: 0, y: 0, width: 1200, height: 1600 }],
      confidence: 0.96,
      warnings: [],
    });
  });

  it("accepts the object shape shown by the official example", () => {
    expect(normalizeAlibabaEduPaperResponse(providerData)?.items).toHaveLength(1);
  });

  it("rejects malformed JSON and invalid page dimensions", () => {
    expect(normalizeAlibabaEduPaperResponse("not-json")).toBeUndefined();
    expect(
      normalizeAlibabaEduPaperResponse({ ...providerData, width: 0 }),
    ).toBeUndefined();
  });

  it("marks deterministic garbled text without treating readable questions as invalid", () => {
    const garbled = "shc ce edt in doing sth dh sthScteedsuces fully 3. 句子还原";
    expect(isAlibabaOcrTextLowQuality(garbled)).toBe(true);
    expect(isAlibabaOcrTextLowQuality("Choose the correct answer. David went deep into the rainforest."))
      .toBe(false);
    expect(isAlibabaOcrTextLowQuality("Tom and Jim had two new books. Which one did Tom choose?"))
      .toBe(false);
    expect(isAlibabaOcrTextLowQuality("下列各式中，正确的是（ ） A. x+2=4"))
      .toBe(false);
    expect(normalizeAlibabaEduPaperResponse({ ...providerData, content: garbled })?.warnings)
      .toEqual([ALIBABA_OCR_LOW_TEXT_QUALITY_WARNING]);
  });
});

describe("AlibabaEduPaperSdkTransport", () => {
  it("calls RecognizeEduPaperOcr with the bounded education defaults", async () => {
    const fake = sdkClient({
      statusCode: 200,
      body: { data: JSON.stringify(providerData) },
    });
    const transport = new AlibabaEduPaperSdkTransport({
      accessKeyId: "fixture-id",
      accessKeySecret: "fixture-secret",
      clientFactory: () => fake.client,
    });

    const response = await transport.execute({
      inputKind: "desensitized",
      sourceUrl: "https://signed.example.invalid/paper?token=fixture",
      pageHints: [],
      timeoutMs: 1_500,
      signal: new AbortController().signal,
    });

    expect(response.status).toBe(200);
    expect(fake.call).toHaveBeenCalledOnce();
    const [request, runtime] = fake.call.mock.calls[0]!;
    expect(request).toMatchObject({
      imageType: "scan",
      subject: "JHighSchool_English",
      outputOricoord: false,
    });
    expect(request.url).toContain("signed.example.invalid");
    expect(runtime).toMatchObject({
      autoretry: false,
      connectTimeout: 1_500,
      readTimeout: 1_500,
    });
  });

  it("sends an authorized local image as body without a URL", async () => {
    const fake = sdkClient({
      statusCode: 200,
      body: { data: JSON.stringify(providerData) },
    });
    const transport = new AlibabaEduPaperSdkTransport({
      accessKeyId: "fixture-id",
      accessKeySecret: "fixture-secret",
      clientFactory: () => fake.client,
    });

    const response = await transport.executeBody({
      body: Readable.from(Buffer.from("fixture-image")),
      timeoutMs: 2_000,
      signal: new AbortController().signal,
    });

    expect(response.status).toBe(200);
    const [request] = fake.call.mock.calls[0]!;
    expect(request.url).toBeUndefined();
    expect(request.body).toBeDefined();
    expect(request).toMatchObject({
      imageType: "scan",
      subject: "JHighSchool_English",
      outputOricoord: false,
    });
  });

  it("feeds normalized output through the existing ToolResult boundary", async () => {
    const fake = sdkClient({
      statusCode: 200,
      body: { data: JSON.stringify(providerData) },
    });
    const transport = new AlibabaEduPaperSdkTransport({
      accessKeyId: "fixture-id",
      accessKeySecret: "fixture-secret",
      clientFactory: () => fake.client,
    });
    const result = await new AlibabaOcrSpikeAdapter({
      transport,
      enabled: true,
    }).execute({
      toolCallId: "tool-call-official-sdk-1",
      caseId: "case-desensitized-sdk-1",
      studentId: "student-desensitized-sdk-1",
      traceId: "trace-desensitized-sdk-1",
      input: {
        inputKind: "desensitized",
        sourceUrl: "https://signed.example.invalid/paper?token=fixture",
        pageHints: [],
      },
      policyVersion: "ocr-sdk-spike-policy-v1",
    });

    expect(result.status).toBe("succeeded");
    expect(Value.Check(ParsePaperResultSchema, result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("token=fixture");
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
  });

  it("maps SDK permission failures without exposing provider details", async () => {
    const fake = sdkClient({
      statusCode: 200,
      body: { code: "noPermission" },
    });
    const transport = new AlibabaEduPaperSdkTransport({
      accessKeyId: "fixture-id",
      accessKeySecret: "fixture-secret",
      clientFactory: () => fake.client,
    });

    await expect(
      transport.execute({
        inputKind: "synthetic",
        sourceUrl: "https://signed.example.invalid/paper",
        pageHints: [],
        timeoutMs: 1_500,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ status: 403, payload: undefined });
  });

  it("fails before client creation when credentials or endpoint are invalid", () => {
    expect(() => createAlibabaEduPaperSdkTransportFromEnv({})).toThrow(
      "access key ID",
    );
    expect(
      () =>
        new AlibabaEduPaperSdkTransport({
          accessKeyId: "fixture-id",
          accessKeySecret: "fixture-secret",
          endpoint: "https://ocr-api.cn-hangzhou.aliyuncs.com/path",
        }),
    ).toThrow("bare HTTPS hostname");
  });

});
