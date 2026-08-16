import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./app-shell";

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn(() => "/student/today") }));

vi.mock("next/navigation", () => ({ usePathname }));
vi.mock("next/image", () => ({ default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => createElement("img", props) }));

describe("AppShell", () => {
  beforeEach(() => usePathname.mockReturnValue("/student/today"));

  it("exposes every student destination and a working settings entry", () => {
    const html = renderToStaticMarkup(createElement(AppShell, null, createElement("p", null, "content")));

    for (const href of ["/student/today", "/diagnose", "/student/mistakes", "/student/plan", "/student/progress", "/student/report", "/setup"]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toContain("错题本");
    expect(html).toContain("学习设置");
    expect(html).not.toMatch(/当前案例|切换学生|学生学习空间|API|Case|Mock|synthetic|provider|token/);
  });

  it("marks the mistakes section as the current destination", () => {
    usePathname.mockReturnValue("/student/mistakes/redo");
    const html = renderToStaticMarkup(createElement(AppShell, null, createElement("p", null, "content")));

    expect(html).toMatch(/<a class="nav-item active" aria-current="page" href="\/student\/mistakes">/);
  });
});
