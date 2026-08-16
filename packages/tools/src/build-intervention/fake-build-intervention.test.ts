import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  BuildInterventionResultSchema,
  type BuildInterventionInput,
  type ToolRequest,
} from "@gapproof/contracts";

import { FakeBuildInterventionAdapter } from "./fake-build-intervention.ts";

const request: ToolRequest<BuildInterventionInput> = {
  toolCallId: "build-intervention-1",
  caseId: "case-synthetic-1",
  studentId: "student-synthetic-1",
  traceId: "trace-1",
  input: {
    contentSource: "synthetic_fixture",
    probeEvaluationEventId: "event-probe-evaluated-1",
    selectedHypothesisId: "hyp-participle-form-gap",
    probePassed: false,
  },
  policyVersion: "demo-intervention-policy-v1",
};

describe("FakeBuildInterventionAdapter", () => {
  it("returns a schema-valid minimal guided task", async () => {
    const result = await new FakeBuildInterventionAdapter().execute(request);

    expect(Value.Check(BuildInterventionResultSchema, result)).toBe(true);
    expect(result.data?.steps).toHaveLength(3);
    expect(result.data?.estimatedMinutes).toBeLessThanOrEqual(10);
    expect(result.evidenceRefs).toContain("event-probe-evaluated-1");
  });

  it("uses a neutral review path when the probe did not confirm a cause", async () => {
    const result = await new FakeBuildInterventionAdapter().execute({
      ...request,
      input: {
        ...request.input,
        selectedHypothesisId: null,
        probePassed: true,
      },
    });

    expect(result.data?.rationale).toContain("尚未确认单一原因");
    expect(result.warnings).toContain("SYNTHETIC_INTERVENTION_FIXTURE");
  });
});
