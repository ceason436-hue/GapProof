import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SyntheticQuickCheck } from "./synthetic-quick-check";

vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", { href, ...props }, children) }));

describe("SyntheticQuickCheck", () => {
  it("discloses the synthetic and stateless boundary before questions load", () => {
    const html = renderToStaticMarkup(createElement(SyntheticQuickCheck));
    expect(html).toContain("快速体验");
    expect(html).toContain("不会保存为正式学习记录");
    expect(html).toContain("不用于评价真实学习效果");
    expect(html).toContain("预计约 3 分钟");
    expect(html).not.toContain('class="eyebrow"');
    expect(html).toContain("正在准备题目");
    expect(html).not.toMatch(/合成 Demo|真实 API|服务端|Case/);
  });
});
