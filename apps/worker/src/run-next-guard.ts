import type { CaseRow } from "@gapproof/db";
import { SYNTHETIC_PARSE_ASSET_ID } from "@gapproof/jobs";

export class SyntheticDemoParseGuardError extends Error {
  readonly code = "DEMO_CASE_REQUIRED";

  constructor() {
    super("The fake parse-paper worker requires a synthetic simulation Case.");
    this.name = "SyntheticDemoParseGuardError";
  }
}

export function assertSyntheticDemoParse(
  caseRow: Pick<CaseRow, "simulation" | "synthetic">,
  assetId: string,
): void {
  if (!caseRow.simulation || !caseRow.synthetic || assetId !== SYNTHETIC_PARSE_ASSET_ID) {
    throw new SyntheticDemoParseGuardError();
  }
}
