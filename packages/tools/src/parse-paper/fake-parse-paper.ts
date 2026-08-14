import type {
  ParsePaperInput,
  ParsePaperOutput,
  ToolRequest,
  ToolResult,
} from "@gapproof/contracts";

export type FakeParsePaperMode =
  | "success"
  | "low_confidence"
  | "timeout"
  | "permission_denied";

export interface ParsePaperAdapter {
  execute(
    request: ToolRequest<ParsePaperInput>,
  ): Promise<ToolResult<ParsePaperOutput>>;
}

const coordinates = {
  page: 1,
  x: 120,
  y: 420,
  width: 900,
  height: 100,
};

function parsedPaper(confidence: number): ParsePaperOutput {
  return {
    pages: [{ page: 1, width: 1200, height: 1600 }],
    items: [
      {
        id: "item-synthetic-irregular-participle-1",
        prompt:
          "Mina has ___ (write) three short notes about saving water this week.",
        studentAnswer: "wrote",
        coordinates,
        confidence,
      },
    ],
    coordinates: [coordinates],
    confidence,
    warnings:
      confidence < 0.8 ? ["LOW_CONFIDENCE_REGION:wrote"] : [],
  };
}

export class FakeParsePaperAdapter implements ParsePaperAdapter {
  constructor(private readonly mode: FakeParsePaperMode = "success") {}

  async execute(
    _request: ToolRequest<ParsePaperInput>,
  ): Promise<ToolResult<ParsePaperOutput>> {
    switch (this.mode) {
      case "success":
        return {
          status: "succeeded",
          data: parsedPaper(0.98),
          confidence: 0.98,
          evidenceRefs: [],
          citations: [],
          warnings: [],
          toolVersion: "fake-parse-paper-v1",
          latencyMs: 12,
        };

      case "low_confidence": {
        const data = parsedPaper(0.61);
        return {
          status: "needs_confirmation",
          data,
          confidence: 0.61,
          evidenceRefs: [],
          citations: [],
          warnings: data.warnings,
          toolVersion: "fake-parse-paper-v1",
          latencyMs: 15,
        };
      }

      case "timeout":
        return {
          status: "retryable_error",
          evidenceRefs: [],
          citations: [],
          warnings: [],
          toolVersion: "fake-parse-paper-v1",
          latencyMs: 3_000,
          error: {
            code: "PROVIDER_TIMEOUT",
            message: "The synthetic OCR provider timed out.",
            retryable: true,
            providerCode: "FAKE_TIMEOUT",
          },
        };

      case "permission_denied":
        return {
          status: "failed",
          evidenceRefs: [],
          citations: [],
          warnings: [],
          toolVersion: "fake-parse-paper-v1",
          latencyMs: 4,
          error: {
            code: "FORBIDDEN",
            message: "The synthetic OCR provider denied access.",
            retryable: false,
            providerCode: "FAKE_PERMISSION_DENIED",
          },
        };
    }
  }
}

