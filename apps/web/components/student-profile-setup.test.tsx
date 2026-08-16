import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StudentProfileSetup } from "./student-profile-setup";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("StudentProfileSetup", () => {
  it("requires an explicit first-time choice for every learning-range fact", () => {
    const html = renderToStaticMarkup(createElement(StudentProfileSetup, { profile: {
      studentId: "0198b111-1111-7000-8000-0000000000d2",
      timeZone: "Asia/Shanghai",
      version: 0,
      completed: false,
      grade: null,
      subject: null,
      term: null,
      region: null,
      learningState: null,
    }, variant: "today" }));

    expect(html.match(/aria-pressed="false"/g)).toHaveLength(10);
    expect(html).toContain("还需选择 5 项");
    expect(html).toContain("0 / 5");
    expect(html).toContain("每一项都由你确认");
    expect(html.match(/data-complete="false"/g)).toHaveLength(5);
    expect(html).toContain("setup-progress-track");
    expect(html).toContain("setup-heading-copy");
    expect(html).toContain("选完全部内容后即可确认");
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('aria-pressed="true"');
  });

  it("shows saved values as selected only when the student revisits settings", () => {
    const html = renderToStaticMarkup(createElement(StudentProfileSetup, { profile: {
      studentId: "0198b111-1111-7000-8000-0000000000d2",
      timeZone: "Asia/Shanghai",
      version: 1,
      completed: true,
      grade: "8",
      subject: "english",
      term: "first_term",
      region: "shanghai",
      learningState: "steady",
    } }));

    expect(html.match(/aria-pressed="true"/g)).toHaveLength(5);
    expect(html).toContain("修改学习范围");
    expect(html).toContain("已完成选择");
    expect(html).toContain("5 / 5");
    expect(html).toContain("可以开始了");
    expect(html.match(/data-complete="true"/g)).toHaveLength(5);
    expect(html).toContain("保存修改");
    expect(html).toContain("取消并返回今日");
    expect(html).not.toContain('disabled=""');
  });
});
