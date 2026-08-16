import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SourceUpload } from "./source-upload";

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => createElement("img", { alt }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/materials/new",
}));

describe("SourceUpload component", () => {
  it("renders an accessible multiple-image picker and neutral real-recognition state", () => {
    const html = renderToStaticMarkup(createElement(SourceUpload, {
      studentId: "0198c111-1111-7000-8000-000000000001",
    }));
    expect(html).toContain('id="source-upload-input"');
    expect(html).toContain('multiple=""');
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).toContain("data-upload-picker");
    expect(html).toContain('<button type="button" class="upload-picker"');
    expect(html).not.toContain('role="button"');
    expect(html).toContain("选择一张或多张图片");
    expect(html).toContain("aria-live=\"polite\"");
    expect(html).not.toContain("图片基础检查通过");
    expect(html).not.toContain("objectKey");
    expect(html).not.toContain("Bearer");
    expect(html).not.toContain("开始识别");
    expect(html).not.toContain("合成 OCR 演示");
    expect(html).not.toContain("查看并确认识别内容");
    expect(html).not.toContain("添加学习材料");
    expect(html).not.toContain("更换图片");
    expect(html).not.toContain("继续添加");
  });

  it("resumes a ready server batch without inventing old image previews", () => {
    const html = renderToStaticMarkup(createElement(SourceUpload, {
      studentId: "0198c111-1111-7000-8000-000000000001",
      initialBatch: {
        batchId: "0198c111-1111-7000-8000-000000000002",
        caseId: "0198c111-1111-7000-8000-000000000003",
        status: "ready" as const,
        pageCount: 4,
        resumeKind: "continue_upload" as const,
        updatedAt: "2026-08-16T08:00:00.000Z",
      },
    }));
    expect(html).toContain("这份材料已有 4 张图片");
    expect(html).toContain("确认后开始识别");
    expect(html).toContain("识别结果仍需你核对");
    expect(html).not.toContain("第 1 张学习材料预览");
  });

  it("offers a real retry only for a retryable server batch", () => {
    const html = renderToStaticMarkup(createElement(SourceUpload, {
      studentId: "0198c111-1111-7000-8000-000000000001",
      initialBatch: {
        batchId: "0198c111-1111-7000-8000-000000000002",
        caseId: "0198c111-1111-7000-8000-000000000003",
        status: "retryable_error" as const,
        pageCount: 2,
        resumeKind: "retry" as const,
        updatedAt: "2026-08-16T08:00:00.000Z",
      },
    }));
    expect(html).toContain("确认后重新识别");
    expect(html).toContain(">重新识别</button>");
    expect(html).toContain("上次识别没有完成");
  });
});
