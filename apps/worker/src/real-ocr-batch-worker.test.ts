import { describe, expect, it } from "vitest";
import { normalizedExtraction, OCR_MANUAL_ENTRY_PROMPT, providerOutcome } from "./real-ocr-batch-worker.ts";

describe("real OCR batch worker outcomes", () => {
  it("preserves a retryable path for timeout and rate limit, and stops forbidden access", () => {
    expect(providerOutcome(403)).toEqual({ status: "failed", code: "PERMISSION_DENIED" });
    expect(providerOutcome(429)).toEqual({ status: "retryable_error", code: "RATE_LIMITED" });
    expect(providerOutcome(408)).toEqual({ status: "retryable_error", code: "PROVIDER_TIMEOUT" });
  });

  it("does not retain provider payload details or exact confidence in the normalized extraction", () => {
    const result = normalizedExtraction({ items: [{ id: "provider-internal", prompt: "  题目文本  ", confidence: 0.92, raw: "secret" }], rawPayload: "secret" }, 2);
    expect(result).toEqual({ extraction: { page: 2, items: [{ id: "item-1", prompt: "题目文本" }], reviewRequired: false }, needsReview: false });
    expect(normalizedExtraction({ items: [] }, 1)).toEqual({
      extraction: { page: 1, items: [{ id: "item-1", prompt: OCR_MANUAL_ENTRY_PROMPT }], reviewRequired: true },
      needsReview: true,
    });
    expect(normalizedExtraction(undefined, 3).extraction).toEqual({
      page: 3, items: [{ id: "item-1", prompt: OCR_MANUAL_ENTRY_PROMPT }], reviewRequired: true,
    });
  });

  it("discards garbled provider text and requires student manual recovery", () => {
    const result = normalizedExtraction({
      items: [{ prompt: "shc ce edt in doing sth dh sthScteedsuces fully", confidence: 0.96 }],
      warnings: ["OCR_LOW_TEXT_QUALITY"],
    }, 1);
    expect(result).toEqual({
      extraction: { page: 1, items: [{ id: "item-1", prompt: OCR_MANUAL_ENTRY_PROMPT }], reviewRequired: true },
      needsReview: true,
    });
    expect(JSON.stringify(result)).not.toContain("sthScteedsuces");
    expect(normalizedExtraction({ items: [], warnings: ["OCR_LOW_TEXT_QUALITY"] }, 2).extraction)
      .toEqual({ page: 2, items: [{ id: "item-1", prompt: OCR_MANUAL_ENTRY_PROMPT }], reviewRequired: true });
  });
});
