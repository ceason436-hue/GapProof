import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  FormHypothesesResultSchema,
  type FormHypothesesInput,
  type ToolRequest,
} from "@gapproof/contracts";

import { FakeFormHypothesesAdapter } from "./fake-form-hypotheses.ts";

const request: ToolRequest<FormHypothesesInput> = {
  toolCallId: "tool-call-form-hypotheses-1",
  caseId: "case-synthetic-irregular-participle-v1",
  studentId: "student-synthetic-1",
  traceId: "trace-1",
  input: {
    observedPrompt:
      "Mina has ___ (write) three short notes about saving water this week.",
    observedAnswer: "wrote",
    confirmedEvidenceRefs: ["event-recognition-confirmed-1"],
  },
  policyVersion: "demo-policy-v1",
};

describe("FakeFormHypothesesAdapter", () => {
  it("returns at least two schema-valid competing hypotheses", async () => {
    const result = await new FakeFormHypothesesAdapter().execute(request);

    expect(Value.Check(FormHypothesesResultSchema, result)).toBe(true);
    expect(result.data?.candidates).toHaveLength(2);
    expect(new Set(result.data?.candidates.map(({ id }) => id)).size).toBe(2);
    expect(
      result.data?.candidates.every(({ evidenceRefs }) =>
        evidenceRefs.includes("event-recognition-confirmed-1"),
      ),
    ).toBe(true);
  });

  it("selects a confirmation question that tests both candidates", async () => {
    const result = await new FakeFormHypothesesAdapter().execute(request);
    const candidateIds = result.data?.candidates.map(({ id }) => id) ?? [];

    expect(result.data?.probe.testedHypothesisIds).toEqual(candidateIds);
    expect(
      result.data?.probe.choices.some(
        ({ id }) => id === result.data?.probe.expectedChoiceId,
      ),
    ).toBe(true);
    expect(result.warnings).toContain("SYNTHETIC_DIAGNOSIS_FIXTURE");
  });
});
