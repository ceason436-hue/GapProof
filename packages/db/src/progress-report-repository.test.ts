import { describe, expect, it } from "vitest";

import { projectStudentProgress } from "./progress-report-repository.ts";

const studentId = "0198b111-1111-7000-8000-000000000002";
const baseCase = { id: "0198b111-1111-7000-8000-000000000003", title: "现在完成时", state: "repair_verified" as const, synthetic: true, simulation: true, createdAt: new Date("2026-08-10T00:00:00Z"), updatedAt: new Date("2026-08-16T00:00:00Z") };

describe("student progress and fact report projection", () => {
  it("labels synthetic provenance and derives reports only from terminal authority", () => {
    const evidence = [
      { id: "0198b111-1111-7000-8000-000000000010", caseId: baseCase.id, eventType: "retest_evaluated" as const, payload: { kind: "d7", passed: true }, occurredAt: new Date("2026-08-16T00:00:00Z") },
      { id: "0198b111-1111-7000-8000-000000000011", caseId: baseCase.id, eventType: "retest_evaluated" as const, payload: { kind: "d1", passed: true }, occurredAt: new Date("2026-08-11T00:00:00Z") },
    ];
    const result = projectStudentProgress({ studentId, timeZone: "Asia/Shanghai", cases: [baseCase, { ...baseCase, id: "0198b111-1111-7000-8000-000000000004", state: "d7_scheduled", synthetic: false, simulation: false }], tasks: [], evidence });
    expect(result.progress.goals[0]).toMatchObject({ source: "synthetic_experience", stage: "repair_verified" });
    expect(result.reports.reports).toEqual([expect.objectContaining({ caseId: baseCase.id, source: "synthetic_experience", conclusion: "repair_verified", d1Result: "passed", d7Result: "passed" })]);
  });

  it("does not infer a report from task completion or malformed retest evidence", () => {
    const result = projectStudentProgress({ studentId, timeZone: "Asia/Shanghai", cases: [{ ...baseCase, state: "d7_scheduled", synthetic: false, simulation: false }], tasks: [{ caseId: baseCase.id, taskType: "d7_retest", status: "completed", title: "新题检查", scheduledFor: new Date(), completedAt: new Date() }], evidence: [{ id: "0198b111-1111-7000-8000-000000000012", caseId: baseCase.id, eventType: "retest_evaluated", payload: { kind: "d7" }, occurredAt: new Date() }] });
    expect(result.reports.reports).toEqual([]);
    expect(result.progress.timeline).toEqual([]);
  });

  it("does not present legacy synthetic retests as real-material learning evidence", () => {
    const realCase = { ...baseCase, synthetic: false, simulation: false };
    const evidence = [
      { id: "0198b111-1111-7000-8000-000000000020", caseId: realCase.id, eventType: "retest_evaluated" as const, payload: { kind: "d1", passed: true, privateEvidence: { itemSource: "synthetic_fixture" } }, occurredAt: new Date("2026-08-11T00:00:00Z") },
      { id: "0198b111-1111-7000-8000-000000000021", caseId: realCase.id, eventType: "retest_evaluated" as const, payload: { kind: "d7", passed: true, privateEvidence: { itemSource: "synthetic_fixture" } }, occurredAt: new Date("2026-08-16T00:00:00Z") },
    ];
    const result = projectStudentProgress({ studentId, timeZone: "Asia/Shanghai", cases: [realCase], tasks: [], evidence });
    expect(result.progress.goals[0]?.stage).toBe("needs_follow_up");
    expect(result.progress.timeline).toEqual([]);
    expect(result.reports.reports).toEqual([]);
  });

  it("accepts a real report only when D1 and D7 share verified content provenance", () => {
    const realCase = { ...baseCase, synthetic: false, simulation: false };
    const privateEvidence = { itemSource: "confirmed_real_material", knowledgeTarget: "present-perfect-participle", contentBasisEventId: "event-intervention-1" };
    const evidence = [
      { id: "0198b111-1111-7000-8000-000000000030", caseId: realCase.id, eventType: "retest_evaluated" as const, payload: { kind: "d1", passed: true, privateEvidence }, occurredAt: new Date("2026-08-11T00:00:00Z") },
      { id: "0198b111-1111-7000-8000-000000000031", caseId: realCase.id, eventType: "retest_evaluated" as const, payload: { kind: "d7", passed: true, privateEvidence }, occurredAt: new Date("2026-08-16T00:00:00Z") },
    ];
    const result = projectStudentProgress({ studentId, timeZone: "Asia/Shanghai", cases: [realCase], tasks: [], evidence });
    expect(result.progress.goals[0]?.stage).toBe("repair_verified");
    expect(result.reports.reports).toEqual([expect.objectContaining({ source: "real_material", d1Result: "passed", d7Result: "passed" })]);

    const mismatched = projectStudentProgress({
      studentId,
      timeZone: "Asia/Shanghai",
      cases: [realCase],
      tasks: [],
      evidence: [evidence[0]!, { ...evidence[1]!, payload: { ...evidence[1]!.payload, privateEvidence: { ...privateEvidence, knowledgeTarget: "different-target" } } }],
    });
    expect(mismatched.reports.reports).toEqual([]);

    const mismatchedBasis = projectStudentProgress({
      studentId,
      timeZone: "Asia/Shanghai",
      cases: [realCase],
      tasks: [],
      evidence: [evidence[0]!, { ...evidence[1]!, payload: { ...evidence[1]!.payload, privateEvidence: { ...privateEvidence, contentBasisEventId: "different-basis-event" } } }],
    });
    expect(mismatchedBasis.reports.reports).toEqual([]);
  });
});
