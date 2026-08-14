import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  ParsePaperResultSchema,
  type ToolRequest,
  type ParsePaperInput,
} from "@gapproof/contracts";

import { FakeParsePaperAdapter } from "./fake-parse-paper.ts";

const request: ToolRequest<ParsePaperInput> = {
  toolCallId: "tool-call-parse-paper-1",
  caseId: "case-synthetic-irregular-participle-v1",
  studentId: "student-synthetic-1",
  traceId: "trace-1",
  input: {
    assetId: "asset-synthetic-paper-1",
    provider: "fake",
    pageHints: ["single-page", "typed-answer"],
  },
  policyVersion: "demo-policy-v1",
};

describe("FakeParsePaperAdapter", () => {
  it.each([
    ["success", "succeeded"],
    ["low_confidence", "needs_confirmation"],
    ["timeout", "retryable_error"],
    ["permission_denied", "failed"],
  ] as const)("returns a schema-valid %s fixture", async (mode, status) => {
    const adapter = new FakeParsePaperAdapter(mode);
    const result = await adapter.execute(request);

    expect(result.status).toBe(status);
    expect(Value.Check(ParsePaperResultSchema, result)).toBe(true);
    expect(result.evidenceRefs).toEqual([]);
    expect(result.citations).toEqual([]);
    expect(result.toolVersion).toBe("fake-parse-paper-v1");
  });

  it("marks the uncertain token for explicit confirmation", async () => {
    const result = await new FakeParsePaperAdapter("low_confidence").execute(
      request,
    );

    expect(result.data?.items[0]).toMatchObject({
      studentAnswer: "wrote",
      confidence: 0.61,
    });
    expect(result.warnings).toContain("LOW_CONFIDENCE_REGION:wrote");
  });

  it("describes timeout retryability without exposing a provider response", async () => {
    const result = await new FakeParsePaperAdapter("timeout").execute(request);

    expect(result.error).toEqual({
      code: "PROVIDER_TIMEOUT",
      message: "The synthetic OCR provider timed out.",
      retryable: true,
      providerCode: "FAKE_TIMEOUT",
    });
    expect(result.data).toBeUndefined();
  });

  it("fails closed when provider permission is denied", async () => {
    const result = await new FakeParsePaperAdapter(
      "permission_denied",
    ).execute(request);

    expect(result.error).toMatchObject({
      code: "FORBIDDEN",
      retryable: false,
    });
    expect(result.data).toBeUndefined();
  });
});

