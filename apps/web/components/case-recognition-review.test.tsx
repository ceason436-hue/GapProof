import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CaseRecognitionReview, classifyUnknownRecovery, reviewBoundaryCopy, reviewStateMessage, type ReviewState } from "./case-recognition-review";

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => createElement("img", { alt }),
}));

describe("CaseRecognitionReview component", () => {
  it("renders a neutral loading boundary without exposing the route id", () => {
    const caseId = "0198c111-1111-7000-8000-000000000003";
    const html = renderToStaticMarkup(createElement(CaseRecognitionReview, { caseId }));
    expect(html).toContain("识别内容核对");
    expect(html).toContain("正在读取本次材料来源");
    expect(html).not.toContain("识别确认");
    expect(html).not.toContain(caseId);
    expect(html).not.toContain("/materials/demo/review");
    expect(html).not.toContain("answerKey");
    expect(html).not.toMatch(/OCR Provider|Fake OCR|同一 Case|服务端/);
  });

  it("uses distinct factual copy for real and synthetic extraction", () => {
    expect(reviewBoundaryCopy("real_alibaba")).toMatchObject({ title: "学习材料识别", tag: "来自上传图片" });
    expect(reviewBoundaryCopy("synthetic_fixture")).toMatchObject({ title: "体验识别内容", tag: "体验内容" });
    expect(reviewBoundaryCopy("real_alibaba").detail).toContain("你上传的图片");
    expect(reviewBoundaryCopy("synthetic_fixture").detail).toContain("不会保存为正式学习记录");
  });

  it("keeps the image-retention statement scoped to original bytes", () => {
    const source = readFileSync(new URL("./case-recognition-review.tsx", import.meta.url), "utf8");
    expect(source).toContain("原图将在 24 小时后自动删除");
    expect(source).toContain("已确认的文字内容会继续保留");
    expect(source).not.toContain("全部学习记录已删除");
  });

  it("keeps all bounded states neutral and actionable", () => {
    const states: ReviewState[] = ["loading", "not_ready", "empty", "ready", "confirm_conflict", "confirm_unknown", "hypotheses", "probe_conflict", "probe_unknown", "intervention_error", "intervention_unknown", "intervention_accepted"];
    for (const state of states) {
      expect(reviewStateMessage(state)).toBeTruthy();
      expect(reviewStateMessage(state)).not.toMatch(/answer key|答案键|confidence|置信度|report ready/i);
    }
  });

  it("maps unknown writes only from authoritative case states", () => {
    expect(classifyUnknownRecovery("confirm_unknown", "awaiting_confirmation")).toBe("retry_confirm");
    expect(classifyUnknownRecovery("confirm_unknown", "ready_for_diagnosis")).toBe("confirmed");
    expect(classifyUnknownRecovery("run_next_unknown", "probe_required")).toBe("probe_ready");
    expect(classifyUnknownRecovery("probe_unknown", "probe_required")).toBe("retry_probe");
    expect(classifyUnknownRecovery("probe_unknown", "intervention_ready")).toBe("intervention_ready");
    expect(classifyUnknownRecovery("intervention_unknown", "intervention_ready")).toBe("retry_intervention");
    expect(classifyUnknownRecovery("intervention_unknown", "intervention_active")).toBe("return_today");
  });
});
