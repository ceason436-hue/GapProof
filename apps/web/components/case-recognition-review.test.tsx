import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CaseRecognitionReview, reviewStateMessage, type ReviewState } from "./case-recognition-review";

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => createElement("img", { alt }),
}));

describe("CaseRecognitionReview component", () => {
  it("renders the persistent synthetic boundary without exposing the route id", () => {
    const caseId = "0198c111-1111-7000-8000-000000000003";
    const html = renderToStaticMarkup(createElement(CaseRecognitionReview, { caseId }));
    expect(html).toContain("合成 OCR 演示");
    expect(html).toContain("上传图片未用于识别");
    expect(html).toContain("非真实学生识别");
    expect(html).not.toContain(caseId);
    expect(html).not.toContain("/materials/demo/review");
    expect(html).not.toContain("answerKey");
  });

  it("keeps all bounded states neutral and actionable", () => {
    const states: ReviewState[] = ["loading", "not_ready", "empty", "ready", "confirm_conflict", "confirm_unknown", "hypotheses", "probe_conflict", "probe_unknown", "intervention_error", "intervention_unknown", "intervention_accepted"];
    for (const state of states) {
      expect(reviewStateMessage(state)).toBeTruthy();
      expect(reviewStateMessage(state)).not.toMatch(/answer key|答案键|confidence|置信度|report ready/i);
    }
  });
});
