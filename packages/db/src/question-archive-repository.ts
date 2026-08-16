import type { QuestionArchiveItem, QuestionArchiveTaskFact } from "@gapproof/contracts";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "./client.ts";
import { cases, learningEvidenceEvents, tasks } from "./schema.ts";

type ArchiveDatabase = Pick<Database, "select">;

type ConfirmedMaterialItem = { readonly prompt: string; readonly studentAnswer: string | null };

export function reconstructConfirmedMaterialItems(
  extractionPayload: Record<string, unknown>,
  confirmationPayload: Record<string, unknown>,
): readonly ConfirmedMaterialItem[] | undefined {
  const extraction = typeof extractionPayload.extraction === "object" && extractionPayload.extraction !== null
    ? extractionPayload.extraction as Record<string, unknown>
    : undefined;
  if (!Array.isArray(extraction?.items) || !Array.isArray(confirmationPayload.confirmedItemIds) || !Array.isArray(confirmationPayload.corrections)) return undefined;

  const confirmedIds = new Set<string>();
  for (const value of confirmationPayload.confirmedItemIds) {
    if (typeof value !== "string" || value.length === 0 || confirmedIds.has(value)) return undefined;
    confirmedIds.add(value);
  }
  if (confirmedIds.size === 0) return undefined;

  const corrections = new Map<string, { prompt?: string; studentAnswer?: string }>();
  for (const raw of confirmationPayload.corrections) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
    const correction = raw as Record<string, unknown>;
    if (typeof correction.itemId !== "string" || !confirmedIds.has(correction.itemId) || typeof correction.value !== "string" || correction.value.trim().length === 0) return undefined;
    if (correction.field !== "prompt" && correction.field !== "student_answer") return undefined;
    const current = corrections.get(correction.itemId) ?? {};
    if (correction.field === "prompt") current.prompt = correction.value.trim();
    else current.studentAnswer = correction.value.trim();
    corrections.set(correction.itemId, current);
  }

  const result: ConfirmedMaterialItem[] = [];
  const found = new Set<string>();
  for (const raw of extraction.items) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
    const item = raw as Record<string, unknown>;
    if (typeof item.itemId !== "string" || typeof item.prompt !== "string") return undefined;
    if (!confirmedIds.has(item.itemId)) continue;
    if (found.has(item.itemId)) return undefined;
    found.add(item.itemId);
    const correction = corrections.get(item.itemId);
    const prompt = (correction?.prompt ?? item.prompt).trim();
    if (prompt.length === 0) return undefined;
    result.push({ prompt, studentAnswer: correction?.studentAnswer ?? null });
  }
  return found.size === confirmedIds.size ? result : undefined;
}

const taskPriority: Record<QuestionArchiveTaskFact["status"], number> = { ready: 0, scheduled: 1, completed: 2 };

export async function findStudentQuestionArchive(
  database: ArchiveDatabase,
  input: { readonly studentId: string; readonly tenantId: string },
): Promise<readonly QuestionArchiveItem[]> {
  const caseRows = await database.select({
    id: cases.id,
    title: cases.title,
    updatedAt: cases.updatedAt,
  }).from(cases).where(and(
    eq(cases.studentId, input.studentId),
    eq(cases.tenantId, input.tenantId),
    eq(cases.synthetic, false),
    eq(cases.simulation, false),
    isNull(cases.deletedAt),
  )).orderBy(desc(cases.updatedAt), desc(cases.id));
  if (caseRows.length === 0) return [];

  const caseIds = caseRows.map(row => row.id);
  const [eventRows, taskRows] = await Promise.all([
    database.select({
      id: learningEvidenceEvents.id,
      caseId: learningEvidenceEvents.caseId,
      eventType: learningEvidenceEvents.eventType,
      sourceType: learningEvidenceEvents.sourceType,
      payload: learningEvidenceEvents.payload,
      occurredAt: learningEvidenceEvents.occurredAt,
    }).from(learningEvidenceEvents).where(and(
      eq(learningEvidenceEvents.studentId, input.studentId),
      eq(learningEvidenceEvents.tenantId, input.tenantId),
      inArray(learningEvidenceEvents.caseId, caseIds),
      inArray(learningEvidenceEvents.eventType, ["evidence_ingested", "recognition_confirmed"]),
    )).orderBy(desc(learningEvidenceEvents.occurredAt), desc(learningEvidenceEvents.createdAt), desc(learningEvidenceEvents.id)),
    database.select({
      id: tasks.id,
      caseId: tasks.caseId,
      taskType: tasks.taskType,
      status: tasks.status,
      title: tasks.title,
      scheduledFor: tasks.scheduledFor,
      dueAt: tasks.dueAt,
      completedAt: tasks.completedAt,
    }).from(tasks).where(and(
      eq(tasks.studentId, input.studentId),
      eq(tasks.tenantId, input.tenantId),
      inArray(tasks.caseId, caseIds),
    )),
  ]);

  const eventsByCase = new Map<string, typeof eventRows>();
  for (const event of eventRows) eventsByCase.set(event.caseId, [...(eventsByCase.get(event.caseId) ?? []), event]);
  const tasksByCase = new Map<string, QuestionArchiveTaskFact[]>();
  for (const task of taskRows) {
    const facts = tasksByCase.get(task.caseId) ?? [];
    facts.push({
      taskId: task.id,
      taskType: task.taskType,
      status: task.status,
      title: task.title,
      scheduledFor: task.scheduledFor.toISOString(),
      dueAt: task.dueAt?.toISOString() ?? null,
      completedAt: task.completedAt?.toISOString() ?? null,
    });
    tasksByCase.set(task.caseId, facts);
  }
  for (const facts of tasksByCase.values()) facts.sort((a, b) => taskPriority[a.status] - taskPriority[b.status] || Date.parse(b.scheduledFor) - Date.parse(a.scheduledFor));

  const archive: QuestionArchiveItem[] = [];
  for (const caseRow of caseRows) {
    const events = eventsByCase.get(caseRow.id) ?? [];
    const extraction = events.find(event => event.eventType === "evidence_ingested" && event.sourceType === "real_alibaba_ocr");
    const confirmation = events.find(event => event.eventType === "recognition_confirmed" && event.sourceType === "student_confirmation");
    if (extraction === undefined || confirmation === undefined) continue;
    const items = reconstructConfirmedMaterialItems(extraction.payload, confirmation.payload);
    if (items === undefined) continue;
    items.forEach((item, index) => archive.push({
      entryRef: `${caseRow.id}:${index}`,
      source: "real_uploaded_material",
      sourceTitle: caseRow.title?.trim() || "上传的学习材料",
      confirmedAt: confirmation.occurredAt.toISOString(),
      prompt: item.prompt,
      studentAnswer: item.studentAnswer,
      tasks: tasksByCase.get(caseRow.id) ?? [],
    }));
  }
  return archive.sort((a, b) => Date.parse(b.confirmedAt) - Date.parse(a.confirmedAt));
}
