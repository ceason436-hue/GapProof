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
    expect(html).toContain("体验识别内容");
    expect(html).toContain("不会读取上传图片中的文字");
    expect(html).toContain("不会保存为正式学习记录");
    expect(html).not.toContain("识别确认");
    expect(html).not.toContain(caseId);
    expect(html).not.toContain("/materials/demo/review");
    expect(html).not.toContain("answerKey");
    expect(html).not.toMatch(/OCR Provider|Fake OCR|同一 Case|服务端/);
  });

  it("keeps all bounded states neutral and actionable", () => {
    const states: ReviewState[] = ["loading", "not_ready", "empty", "ready", "confirm_conflict", "confirm_unknown", "hypotheses", "probe_conflict", "probe_unknown", "intervention_error", "intervention_unknown", "intervention_accepted"];
    for (const state of states) {
      expect(reviewStateMessage(state)).toBeTruthy();
      expect(reviewStateMessage(state)).not.toMatch(/answer key|答案键|confidence|置信度|report ready/i);
    }
  });
});
