import { describe, expect, it } from "vitest";

import { demoCase } from "./index.ts";

describe("synthetic demo case", () => {
  it("is safe to ship as an explicitly synthetic project-original fixture", () => {
    expect(demoCase.provenance).toEqual({
      synthetic: true,
      original: true,
      curriculumMapping: "unverified",
      containsStudentData: false,
      license: "project-original",
    });
  });

  it("contains the minimum evidence needed for a falsifiable diagnosis", () => {
    expect(demoCase.competingHypotheses.length).toBeGreaterThanOrEqual(2);
    expect(demoCase.probes.length).toBeGreaterThanOrEqual(2);
    expect(demoCase.retests.d1.prompt).not.toBe(
      demoCase.sourceEvidence.prompt,
    );
    expect(demoCase.retests.d7.prompt).not.toBe(
      demoCase.sourceEvidence.prompt,
    );
  });

  it("declares the low-confidence, replan, and transfer branches", () => {
    expect(demoCase.expectedBranches).toEqual({
      lowConfidenceRecognition: "awaiting_confirmation",
      failedDelayedRetest: "replan_required",
      successfulD7Transfer: "report_ready",
    });
  });
});

