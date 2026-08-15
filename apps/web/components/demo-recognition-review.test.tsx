import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DemoRecognitionReview, validateDemoReviewDraft } from "./demo-recognition-review";

describe("DemoRecognitionReview", () => {
  it("renders a clearly synthetic, local-only confirmation view", () => {
    const html = renderToStaticMarkup(createElement(DemoRecognitionReview));
    expect(html).toContain("演示识别 · 合成材料 · 不是真实学生数据");
    expect(html).toContain("预置识别结果 / 演示回退");
    expect(html).toContain('for="demo-prompt"');
    expect(html).toContain('for="demo-student-answer"');
    expect(html).toContain("请确认");
    expect(html).toContain("演示确认内容");
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("/api/v1/");
    expect(html).not.toContain("assetId");
    expect(html).not.toContain("objectKey");
    expect(html).not.toContain("token");
    expect(html).not.toContain("confidence");
    expect(html).not.toContain("answer key");
  });

  it("keeps empty and error states neutral and without a confirmation action", () => {
    const empty = renderToStaticMarkup(createElement(DemoRecognitionReview, { mode: "empty" }));
    const error = renderToStaticMarkup(createElement(DemoRecognitionReview, { mode: "error" }));
    expect(empty).toContain('data-review-state="empty"');
    expect(empty).not.toContain("演示确认内容");
    expect(error).toContain('data-review-state="error"');
    expect(error).toContain('role="alert"');
    expect(error).not.toContain("演示确认内容");
  });
});

describe("validateDemoReviewDraft", () => {
  it("requires both editable fields", () => {
    expect(validateDemoReviewDraft("", "answer")).toContain("补充");
    expect(validateDemoReviewDraft("prompt", " ")).toContain("补充");
    expect(validateDemoReviewDraft("prompt", "answer")).toBeNull();
  });
});
