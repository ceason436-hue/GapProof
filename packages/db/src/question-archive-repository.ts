import { createHash } from "node:crypto";
import type { QuestionArchiveItem, QuestionArchiveTaskFact } from "@gapproof/contracts";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "./client.ts";
import { cases, learningEvidenceEvents, tasks } from "./schema.ts";

type ArchiveDatabase = Pick<Database, "select">;

type ConfirmedMaterialItem = { readonly prompt: string; readonly studentAnswer: string | null };

export interface MistakeReviewSource {
  readonly tenantId: string;
  readonly studentId: string;
  readonly caseId: string;
  readonly confirmationEventId: string;
  readonly entryRef: string;
  readonly prompt: string;
  readonly studentAnswer: string | null;
  readonly knowledgeTarget: string;
  readonly contentBasisEventId: string;
}

/**
 * Resolves the opaque archive reference back to a confirmed real-material
 * question. The reference is deliberately the only student-supplied lookup
 * value; no internal item id is accepted by this command.
 */
export async function findMistakeReviewSource(
  database: ArchiveDatabase,
  input: { readonly studentId: string; readonly tenantId: string; readonly entryRef: string },
): Promise<MistakeReviewSource | undefined> {
  const caseRows = await database.select({
    id: cases.id,
    tenantId: cases.tenantId,
    studentId: cases.studentId,
  }).from(cases).where(and(
    eq(cases.studentId, input.studentId),
    eq(cases.tenantId, input.tenantId),
    eq(cases.synthetic, false),
    eq(cases.simulation, false),
    isNull(cases.deletedAt),
  ));
  if (caseRows.length === 0) return undefined;

  const caseIds = caseRows.map(row => row.id);
  const eventRows = await database.select({
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
  )).orderBy(desc(learningEvidenceEvents.occurredAt), desc(learningEvidenceEvents.createdAt));
  const taskRows = await database.select({
    caseId: tasks.caseId,
    payload: tasks.payload,
    taskType: tasks.taskType,
  }).from(tasks).where(and(
    eq(tasks.studentId, input.studentId),
    eq(tasks.tenantId, input.tenantId),
    inArray(tasks.caseId, caseIds),
  ));
  const eventsByCase = new Map<string, typeof eventRows>();
  for (const event of eventRows) eventsByCase.set(event.caseId, [...(eventsByCase.get(event.caseId) ?? []), event]);
  for (const caseRow of caseRows) {
    const events = eventsByCase.get(caseRow.id) ?? [];
    const extraction = events.find(event => event.eventType === "evidence_ingested" && event.sourceType === "real_alibaba_ocr");
    const confirmation = events.find(event => event.eventType === "recognition_confirmed" && event.sourceType === "student_confirmation");
    if (extraction === undefined || confirmation === undefined) continue;
    const items = reconstructConfirmedMaterialItems(extraction.payload, confirmation.payload);
    if (items === undefined) continue;
    const itemIndex = items.findIndex((_, index) => createHash("sha256").update(`${caseRow.id}:${index}`).digest("base64url").slice(0, 32) === input.entryRef);
    if (itemIndex < 0) continue;
    const contentBinding = taskRows
      .filter(task => task.caseId === caseRow.id && isRecord(task.payload))
      .map(task => contentBindingFromTask({ taskType: task.taskType, payload: task.payload }))
      .find(binding => binding !== undefined);
    if (contentBinding === undefined) return undefined;
    return {
      tenantId: caseRow.tenantId,
      studentId: caseRow.studentId,
      caseId: caseRow.id,
      confirmationEventId: confirmation.id,
      entryRef: input.entryRef,
      prompt: items[itemIndex]!.prompt,
      studentAnswer: items[itemIndex]!.studentAnswer,
      knowledgeTarget: contentBinding.knowledgeTarget,
      contentBasisEventId: contentBinding.contentBasisEventId,
    };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contentBindingFromTask(task: { readonly taskType: string; readonly payload: Record<string, unknown> }) {
  if (
    task.taskType === "mistake_review" ||
    task.payload.contentSource !== "confirmed_real_material" ||
    typeof task.payload.knowledgeTarget !== "string" ||
    task.payload.knowledgeTarget.trim().length === 0
  ) return undefined;
  const contentBasisEventId = task.payload.contentBasisEventId ?? task.payload.sourceEventId;
  return typeof contentBasisEventId === "string"
    ? { knowledgeTarget: task.payload.knowledgeTarget.trim(), contentBasisEventId }
    : undefined;
}

export interface CreateMistakeReviewTaskInput {
  readonly source: MistakeReviewSource;
  readonly taskId: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly createdAt: Date;
}

export async function createMistakeReviewTask(
  database: Database,
  input: CreateMistakeReviewTaskInput,
) {
  return database.transaction(async (transaction) => {
    const [existingEvent] = await transaction.select({ id: learningEvidenceEvents.id, caseId: learningEvidenceEvents.caseId }).from(learningEvidenceEvents).where(eq(learningEvidenceEvents.idempotencyKey, input.idempotencyKey)).limit(1);
    if (existingEvent !== undefined) {
      const [existingTask] = await transaction.select().from(tasks).where(eq(tasks.sourceEventId, existingEvent.id)).limit(1);
      if (existingTask === undefined) throw new Error("The mistake review event has no task.");
      return { created: false as const, task: existingTask };
    }
    const [lockedCase] = await transaction.select({ id: cases.id, tenantId: cases.tenantId, studentId: cases.studentId }).from(cases).where(and(eq(cases.id, input.source.caseId), eq(cases.tenantId, input.source.tenantId), eq(cases.studentId, input.source.studentId), isNull(cases.deletedAt))).for("update").limit(1);
    if (lockedCase === undefined) throw new Error("The confirmed material case is unavailable.");
    const existingRows = await transaction.select().from(tasks).where(and(eq(tasks.caseId, input.source.caseId), eq(tasks.taskType, "mistake_review"), eq(tasks.status, "ready"), sql`${tasks.payload}->>'sourceArchiveEntryRef' = ${input.source.entryRef}`)).limit(1);
    if (existingRows[0] !== undefined) return { created: false as const, task: existingRows[0] };
    const event = {
      id: input.eventId,
      tenantId: input.source.tenantId,
      studentId: input.source.studentId,
      caseId: input.source.caseId,
      eventType: "mistake_review_created" as const,
      sourceType: "student_mistake_review",
      sourceRef: input.source.entryRef,
      payload: {
        request: { entryRef: input.source.entryRef },
        privateEvidence: { contentSource: "confirmed_real_material", knowledgeTarget: input.source.knowledgeTarget, contentBasisEventId: input.source.contentBasisEventId },
        result: { taskId: input.taskId, sourceConfirmationEventId: input.source.confirmationEventId },
      },
      confidence: null,
      occurredAt: input.createdAt,
      idempotencyKey: input.idempotencyKey,
    };
    const task = {
      id: input.taskId,
      tenantId: input.source.tenantId,
      studentId: input.source.studentId,
      caseId: input.source.caseId,
      taskType: "mistake_review" as const,
      status: "ready" as const,
      title: "重新做一道错题",
      estimatedMinutes: 8,
      scheduledFor: input.createdAt,
      dueAt: null,
      payload: {
        rationale: "你主动发起了一次复习。先独立写出思路，再和原来的作答对照；这次记录不会自动说明你已经掌握。",
        prompt: input.source.prompt,
        originalAnswer: input.source.studentAnswer,
        reflectionPrompt: "请写下你现在会怎么判断或解答这道题。",
        submittedResponse: null,
        sourceArchiveEntryRef: input.source.entryRef,
        sourceConfirmationEventId: input.source.confirmationEventId,
        contentSource: "confirmed_real_material",
        knowledgeTarget: input.source.knowledgeTarget,
        contentBasisEventId: input.source.contentBasisEventId,
      },
      sourceEventId: input.eventId,
      createdAt: input.createdAt,
    };
    await transaction.insert(learningEvidenceEvents).values(event);
    const [insertedTask] = await transaction.insert(tasks).values(task).returning();
    if (insertedTask === undefined) throw new Error("The mistake review task was not created.");
    return { created: true as const, task: insertedTask };
  });
}

export interface CompleteMistakeReviewTaskInput {
  readonly taskId: string;
  readonly studentId: string;
  readonly tenantId: string;
  readonly responseText: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly completedAt: Date;
}

export async function completeMistakeReviewTask(
  database: Database,
  input: CompleteMistakeReviewTaskInput,
) {
  return database.transaction(async (transaction) => {
    const [existingEvent] = await transaction.select().from(learningEvidenceEvents).where(eq(learningEvidenceEvents.idempotencyKey, input.idempotencyKey)).limit(1);
    if (existingEvent !== undefined) return { applied: false as const, event: existingEvent };
    const [task] = await transaction.select().from(tasks).where(and(eq(tasks.id, input.taskId), eq(tasks.studentId, input.studentId), eq(tasks.tenantId, input.tenantId))).for("update").limit(1);
    if (task === undefined || task.taskType !== "mistake_review" || task.status !== "ready") throw new Error("The mistake review task is not ready.");
    const event = {
      id: input.eventId,
      tenantId: input.tenantId,
      studentId: input.studentId,
      caseId: task.caseId,
      eventType: "mistake_review_completed" as const,
      sourceType: "student_mistake_review",
      sourceRef: task.id,
      payload: {
        request: { taskId: task.id, responseText: input.responseText },
        privateEvidence: {
          contentSource: task.payload.contentSource,
          knowledgeTarget: task.payload.knowledgeTarget,
          contentBasisEventId: task.payload.contentBasisEventId,
        },
        result: { taskId: task.id, completedAt: input.completedAt.toISOString() },
      },
      confidence: null,
      occurredAt: input.completedAt,
      idempotencyKey: input.idempotencyKey,
    };
    await transaction.insert(learningEvidenceEvents).values(event);
    await transaction.update(tasks).set({ status: "completed", completedAt: input.completedAt, payload: { ...task.payload, submittedResponse: input.responseText } }).where(eq(tasks.id, task.id));
    return { applied: true as const, event };
  });
}

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

  if (confirmationPayload.reviewedQuestions !== undefined) {
    if (!Array.isArray(confirmationPayload.reviewedQuestions) || confirmationPayload.reviewedQuestions.length === 0 || confirmationPayload.reviewedQuestions.length > 50) return undefined;
    const result: ConfirmedMaterialItem[] = [];
    const representedItemIds = new Set<string>();
    for (const raw of confirmationPayload.reviewedQuestions) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
      const question = raw as Record<string, unknown>;
      if (
        typeof question.sourceItemId !== "string" ||
        !confirmedIds.has(question.sourceItemId) ||
        typeof question.prompt !== "string" ||
        question.prompt.trim().length === 0 ||
        question.prompt.length > 4_000 ||
        (question.studentAnswer !== null && (typeof question.studentAnswer !== "string" || question.studentAnswer.trim().length === 0 || question.studentAnswer.length > 2_000))
      ) return undefined;
      result.push({
        prompt: question.prompt.trim(),
        studentAnswer: typeof question.studentAnswer === "string" ? question.studentAnswer.trim() : null,
      });
      representedItemIds.add(question.sourceItemId);
    }
    const extractionIds = new Set<string>();
    for (const raw of extraction.items) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
      const item = raw as Record<string, unknown>;
      if (typeof item.itemId !== "string" || extractionIds.has(item.itemId)) return undefined;
      extractionIds.add(item.itemId);
    }
    return [...confirmedIds].every((itemId) => extractionIds.has(itemId) && representedItemIds.has(itemId)) ? result : undefined;
  }

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
      payload: tasks.payload,
    }).from(tasks).where(and(
      eq(tasks.studentId, input.studentId),
      eq(tasks.tenantId, input.tenantId),
      inArray(tasks.caseId, caseIds),
    )),
  ]);

  const eventsByCase = new Map<string, typeof eventRows>();
  for (const event of eventRows) eventsByCase.set(event.caseId, [...(eventsByCase.get(event.caseId) ?? []), event]);
  const tasksByCase = new Map<string, Array<{ readonly fact: QuestionArchiveTaskFact; readonly entryRef: string | null }>>();
  for (const task of taskRows) {
    const facts = tasksByCase.get(task.caseId) ?? [];
    facts.push({
      fact: {
        taskId: task.id,
        taskType: task.taskType,
        status: task.status,
        title: task.title,
        scheduledFor: task.scheduledFor.toISOString(),
        dueAt: task.dueAt?.toISOString() ?? null,
        completedAt: task.completedAt?.toISOString() ?? null,
      },
      entryRef: task.taskType === "mistake_review" && typeof task.payload.sourceArchiveEntryRef === "string"
        ? task.payload.sourceArchiveEntryRef
        : null,
    });
    tasksByCase.set(task.caseId, facts);
  }
  for (const facts of tasksByCase.values()) facts.sort((a, b) => taskPriority[a.fact.status] - taskPriority[b.fact.status] || Date.parse(b.fact.scheduledFor) - Date.parse(a.fact.scheduledFor));

  const archive: QuestionArchiveItem[] = [];
  for (const caseRow of caseRows) {
    const events = eventsByCase.get(caseRow.id) ?? [];
    const extraction = events.find(event => event.eventType === "evidence_ingested" && event.sourceType === "real_alibaba_ocr");
    const confirmation = events.find(event => event.eventType === "recognition_confirmed" && event.sourceType === "student_confirmation");
    if (extraction === undefined || confirmation === undefined) continue;
    const items = reconstructConfirmedMaterialItems(extraction.payload, confirmation.payload);
    if (items === undefined) continue;
    const caseTaskRows = tasksByCase.get(caseRow.id) ?? [];
    const reviewReady = taskRows.some(task => task.caseId === caseRow.id && contentBindingFromTask(task) !== undefined);
    items.forEach((item, index) => {
      const entryRef = createHash("sha256").update(`${caseRow.id}:${index}`).digest("base64url").slice(0, 32);
      archive.push({
        entryRef,
        source: "real_uploaded_material",
        sourceTitle: caseRow.title?.trim() || "上传的学习材料",
        confirmedAt: confirmation.occurredAt.toISOString(),
        prompt: item.prompt,
        studentAnswer: item.studentAnswer,
        reviewReady,
        tasks: caseTaskRows.filter(task => task.entryRef === null || task.entryRef === entryRef).map(task => task.fact),
      });
    });
  }
  return archive.sort((a, b) => Date.parse(b.confirmedAt) - Date.parse(a.confirmedAt));
}
