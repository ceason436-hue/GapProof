import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SyntheticQuickCheck } from "./synthetic-quick-check";

vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", { href, ...props }, children) }));

describe("SyntheticQuickCheck", () => {
  it("discloses the synthetic and stateless boundary before questions load", () => {
    const html = renderToStaticMarkup(createElement(SyntheticQuickCheck));
    expect(html).toContain("合成 Demo · 非真实个性化诊断");
    expect(html).toContain("不写学习记录");
    expect(html).toContain("不生成报告");
    expect(html).toContain("正在从真实 API 读取合成题目");
  });
});
