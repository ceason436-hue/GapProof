import type {
  LearningRecordSource,
  ProgressStage,
  ProgressTimelineKind,
  StudentFactReportsView,
  StudentProgressView,
} from "@gapproof/contracts";
import { and, asc, desc, eq, isNull } from "drizzle-orm";

import type { Database } from "./client.ts";
import { cases, learningEvidenceEvents, tasks } from "./schema.ts";

type ProgressDatabase = Pick<Database, "select">;
type CaseProjectionRow = Pick<typeof cases.$inferSelect, "id" | "title" | "state" | "synthetic" | "simulation" | "createdAt" | "updatedAt">;
type TaskProjectionRow = Pick<typeof tasks.$inferSelect, "caseId" | "taskType" | "status" | "title" | "scheduledFor" | "completedAt">;
type EvidenceProjectionRow = Pick<typeof learningEvidenceEvents.$inferSelect, "id" | "caseId" | "eventType" | "payload" | "occurredAt">;

function recordSource(row: CaseProjectionRow): LearningRecordSource {
  return row.synthetic || row.simulation ? "synthetic_experience" : "real_material";
}

export function progressStage(state: typeof cases.$inferSelect.state): ProgressStage {
  switch (state) {
    case "awaiting_evidence":
    case "awaiting_confirmation": return "collecting";
    case "ready_for_diagnosis":
    case "probe_required": return "checking";
    case "intervention_ready":
    case "intervention_active": return "practicing";
    case "d1_scheduled":
    case "d7_scheduled": return "retesting";
    case "repair_verified": return "repair_verified";
    case "support_required": return "support_required";
    case "replan_required":
    case "report_ready": return "needs_follow_up";
  }
}

function timelineKind(row: EvidenceProjectionRow): ProgressTimelineKind | null {
  switch (row.eventType) {
    case "recognition_confirmed": return "material_confirmed";
    case "probe_evaluated": return "diagnosis_checked";
    case "intervention_completed": return "practice_completed";
    case "plan_replanned": return "plan_adjusted";
    case "retest_evaluated": {
      const kind = row.payload.kind;
      const passed = row.payload.passed;
      if ((kind !== "d1" && kind !== "d7") || typeof passed !== "boolean") return null;
      return `${kind}_${passed ? "passed" : "needs_follow_up"}`;
    }
    default: return null;
  }
}

type ContentEvidence = { contentSource: "confirmed_real_material" | "synthetic_fixture"; knowledgeTarget: string; contentBasisEventId: string };

function contentEvidence(row: EvidenceProjectionRow): ContentEvidence | undefined {
  const value = row.payload.privateEvidence;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const evidence = value as Record<string, unknown>;
  const contentSource = evidence.contentSource ?? evidence.itemSource;
  return (contentSource === "confirmed_real_material" || contentSource === "synthetic_fixture") &&
    typeof evidence.knowledgeTarget === "string" && evidence.knowledgeTarget.trim().length > 0 &&
    typeof evidence.contentBasisEventId === "string"
    ? { contentSource, knowledgeTarget: evidence.knowledgeTarget, contentBasisEventId: evidence.contentBasisEventId }
    : undefined;
}

function realRetestProof(events: readonly EvidenceProjectionRow[]) {
  const retests = events.flatMap(row => {
    const evidence = contentEvidence(row);
    return row.eventType === "retest_evaluated" && (row.payload.kind === "d1" || row.payload.kind === "d7") &&
      typeof row.payload.passed === "boolean" && evidence?.contentSource === "confirmed_real_material"
      ? [{ row, evidence, kind: row.payload.kind }]
      : [];
  });
  for (const d7 of retests.filter(item => item.kind === "d7")) {
    const d1 = retests.find(item => item.kind === "d1" &&
      item.evidence.knowledgeTarget === d7.evidence.knowledgeTarget &&
      item.evidence.contentBasisEventId === d7.evidence.contentBasisEventId);
    if (d1 !== undefined) return { d1: d1.row, d7: d7.row, ...d7.evidence };
  }
  return undefined;
}

function retestResult(events: readonly EvidenceProjectionRow[], kind: "d1" | "d7", proof?: ReturnType<typeof realRetestProof>) {
  const event = proof === undefined
    ? events.find((row) => row.eventType === "retest_evaluated" && row.payload.kind === kind && typeof row.payload.passed === "boolean")
    : proof[kind];
  if (event === undefined) return "not_recorded" as const;
  return event.payload.passed === true ? "passed" as const : "needs_follow_up" as const;
}

export function projectStudentProgress(input: {
  studentId: string;
  timeZone: string;
  cases: readonly CaseProjectionRow[];
  tasks: readonly TaskProjectionRow[];
  evidence: readonly EvidenceProjectionRow[];
}): { progress: StudentProgressView; reports: StudentFactReportsView } {
  const tasksByCase = new Map<string, TaskProjectionRow[]>();
  for (const task of input.tasks) tasksByCase.set(task.caseId, [...(tasksByCase.get(task.caseId) ?? []), task]);
  const evidenceByCase = new Map<string, EvidenceProjectionRow[]>();
  for (const event of input.evidence) evidenceByCase.set(event.caseId, [...(evidenceByCase.get(event.caseId) ?? []), event]);
  const casesById = new Map(input.cases.map((row) => [row.id, row]));

  const goals = input.cases.map((row) => {
    const caseTasks = tasksByCase.get(row.id) ?? [];
    const caseEvidence = evidenceByCase.get(row.id) ?? [];
    const realProof = recordSource(row) === "real_material" ? realRetestProof(caseEvidence) : undefined;
    const next = caseTasks.find((task) => task.status === "ready") ?? caseTasks.find((task) => task.status === "scheduled");
    return {
      caseId: row.id,
      title: row.title?.trim() || "一项学习目标",
      source: recordSource(row),
      stage: recordSource(row) === "real_material" && (row.state === "repair_verified" || row.state === "support_required") && realProof === undefined
        ? "needs_follow_up"
        : progressStage(row.state),
      updatedAt: row.updatedAt.toISOString(),
      completedTaskCount: caseTasks.filter((task) => task.status === "completed").length,
      nextTask: next === undefined ? null : {
        taskType: next.taskType,
        status: next.status as "ready" | "scheduled",
        title: next.title,
        scheduledFor: next.scheduledFor.toISOString(),
      },
    };
  });

  const timeline = input.evidence.flatMap((row) => {
    const kind = timelineKind(row);
    const caseRow = casesById.get(row.caseId);
    const realLearningFactRequiresBoundContent = kind !== null && (kind === "practice_completed" || kind.startsWith("d1_") || kind.startsWith("d7_"));
    if (
      kind === null || caseRow === undefined ||
      (recordSource(caseRow) === "real_material" && realLearningFactRequiresBoundContent && contentEvidence(row)?.contentSource !== "confirmed_real_material")
    ) return [];
    return [{
      eventId: row.id,
      caseId: row.caseId,
      source: recordSource(caseRow),
      kind,
      occurredAt: row.occurredAt.toISOString(),
    }];
  });

  const reports = input.cases.flatMap((row) => {
    if (row.state !== "repair_verified" && row.state !== "support_required") return [];
    const caseTasks = tasksByCase.get(row.id) ?? [];
    const caseEvidence = evidenceByCase.get(row.id) ?? [];
    const realProof = recordSource(row) === "real_material" ? realRetestProof(caseEvidence) : undefined;
    if (recordSource(row) === "real_material" && realProof === undefined) return [];
    const evidenceThrough = caseEvidence[0]?.occurredAt ?? row.updatedAt;
    return [{
      caseId: row.id,
      title: row.title?.trim() || "一项学习目标",
      source: recordSource(row),
      conclusion: row.state,
      d1Result: retestResult(caseEvidence, "d1", realProof),
      d7Result: retestResult(caseEvidence, "d7", realProof),
      completedTaskCount: caseTasks.filter((task) => task.status === "completed").length,
      evidenceThrough: evidenceThrough.toISOString(),
    }];
  });
  return {
    progress: { studentId: input.studentId, timeZone: input.timeZone, goals, timeline },
    reports: { studentId: input.studentId, timeZone: input.timeZone, reports },
  };
}

export async function findStudentProgressAndReports(database: ProgressDatabase, input: { studentId: string; tenantId: string; timeZone: string }) {
  const [caseRows, taskRows, evidenceRows] = await Promise.all([
    database.select({ id: cases.id, title: cases.title, state: cases.state, synthetic: cases.synthetic, simulation: cases.simulation, createdAt: cases.createdAt, updatedAt: cases.updatedAt })
      .from(cases).where(and(eq(cases.studentId, input.studentId), eq(cases.tenantId, input.tenantId), isNull(cases.deletedAt))).orderBy(desc(cases.updatedAt), desc(cases.id)),
    database.select({ caseId: tasks.caseId, taskType: tasks.taskType, status: tasks.status, title: tasks.title, scheduledFor: tasks.scheduledFor, completedAt: tasks.completedAt })
      .from(tasks).where(and(eq(tasks.studentId, input.studentId), eq(tasks.tenantId, input.tenantId))).orderBy(asc(tasks.scheduledFor), asc(tasks.id)),
    database.select({ id: learningEvidenceEvents.id, caseId: learningEvidenceEvents.caseId, eventType: learningEvidenceEvents.eventType, payload: learningEvidenceEvents.payload, occurredAt: learningEvidenceEvents.occurredAt })
      .from(learningEvidenceEvents).where(and(eq(learningEvidenceEvents.studentId, input.studentId), eq(learningEvidenceEvents.tenantId, input.tenantId))).orderBy(desc(learningEvidenceEvents.occurredAt), desc(learningEvidenceEvents.id)),
  ]);
  return projectStudentProgress({ studentId: input.studentId, timeZone: input.timeZone, cases: caseRows, tasks: taskRows, evidence: evidenceRows });
}
