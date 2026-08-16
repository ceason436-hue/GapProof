import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RecoverableOcrBatchView } from "@gapproof/contracts";
import { OcrBatchRecovery } from "./ocr-batch-recovery";

const base: RecoverableOcrBatchView = {
  batchId: "0198c111-1111-7000-8000-000000000001",
  caseId: "0198c111-1111-7000-8000-000000000002",
  status: "processing",
  pageCount: 3,
  resumeKind: "wait",
  updatedAt: "2026-08-16T08:00:00.000Z",
};

describe("OcrBatchRecovery", () => {
  it("routes each server-owned recovery state to its truthful next step", () => {
    const batches: RecoverableOcrBatchView[] = [
      { ...base, status: "collecting", resumeKind: "continue_upload" },
      base,
      { ...base, batchId: "0198c111-1111-7000-8000-000000000003", status: "needs_confirmation", resumeKind: "review" },
      { ...base, batchId: "0198c111-1111-7000-8000-000000000004", status: "retryable_error", resumeKind: "retry" },
      { ...base, batchId: "0198c111-1111-7000-8000-000000000005", status: "failed", resumeKind: "retry" },
    ];
    const html = renderToStaticMarkup(createElement(OcrBatchRecovery, { batches }));

    expect(html).toContain("继续上次的检查");
    expect(html).toContain("3 张图片");
    expect(html).toContain(`/materials/new?batch=${base.batchId}`);
    expect(html).toContain(`/materials/${base.caseId}/review`);
    expect(html).toContain('data-resume-kind="review"');
    expect(html).toContain('data-resume-kind="retry"');
    expect(html).toContain("识别内容等你核对");
    expect(html).toContain("这份材料没有识别完成");
    expect(html).toContain("原批次无法继续处理，请重新上传图片");
    expect(html).toContain('href="/materials/new"');
    expect(html).toContain("重新上传图片");
    expect(html).not.toMatch(/已经诊断|学习效果|识别正确/);
  });

  it("renders nothing when no recoverable batch exists", () => {
    expect(renderToStaticMarkup(createElement(OcrBatchRecovery, { batches: [] }))).toBe("");
  });
});
