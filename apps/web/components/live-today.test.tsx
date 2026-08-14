import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RetestCard } from "./live-today";

vi.mock("server-only", () => ({}));

describe("D+1 read-only card", () => {
  it.each(["scheduled", "ready", "completed"] as const)(
    "has no submission entry for %s",
    status => {
      const html = renderToStaticMarkup(createElement(RetestCard, {
        retest: {
          id: "55555555-5555-4555-8555-555555555555",
          title: "D+1 检查",
          status,
          scheduledFor: "2026-08-16T01:00:00.000Z",
          dueAt: "2026-08-16T01:00:00.000Z",
          estimatedMinutes: 5,
          submitAvailable: false,
        },
      }));
      expect(html).toContain("disabled");
      expect(html).not.toContain("<form");
      expect(html).not.toContain("/attempts");
      expect(html).not.toContain("href=");
    },
  );
});
