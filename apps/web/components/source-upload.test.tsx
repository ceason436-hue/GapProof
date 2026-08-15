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
  it("renders an accessible image picker and neutral initial state", () => {
    const html = renderToStaticMarkup(createElement(SourceUpload, {
      studentId: "0198c111-1111-7000-8000-000000000001",
    }));
    expect(html).toContain('id="source-upload-input"');
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).toContain("请选择一张图片");
    expect(html).toContain("aria-live=\"polite\"");
    expect(html).not.toContain("图片基础检查通过");
    expect(html).not.toContain("OCR");
    expect(html).not.toContain("objectKey");
    expect(html).not.toContain("Bearer");
    expect(html).not.toContain("开始识别并继续");
    expect(html).not.toContain("合成 OCR 演示");
    expect(html).not.toContain("查看并确认识别内容");
  });
});
