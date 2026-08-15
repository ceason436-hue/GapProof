import { describe, expect, it } from "vitest";

import {
  assertSyntheticDemoParse,
  SyntheticDemoParseGuardError,
} from "./run-next-guard.ts";

describe("legacy fake parse-paper guard", () => {
  it("allows only the fully synthetic simulation fixture", () => {
    expect(() => assertSyntheticDemoParse(
      { simulation: true, synthetic: true },
      "asset-synthetic-paper-1",
    )).not.toThrow();
  });

  it.each([
    [{ simulation: true, synthetic: false }, "asset-synthetic-paper-1"],
    [{ simulation: false, synthetic: true }, "asset-synthetic-paper-1"],
    [{ simulation: false, synthetic: false }, "asset-synthetic-paper-1"],
    [{ simulation: true, synthetic: true }, "student-upload-asset"],
  ] as const)("fails closed for %j / %s", (caseRow, assetId) => {
    expect(() => assertSyntheticDemoParse(caseRow, assetId)).toThrow(
      SyntheticDemoParseGuardError,
    );
  });
});
