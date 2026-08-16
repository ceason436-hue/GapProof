import { randomBytes } from "node:crypto";

import {
  cases,
  createDatabase,
  deviceSessions,
  eq,
  learningEvidenceEvents,
  students,
  tasks,
  tutorSessions,
  tutorTurns,
} from "../packages/db/src/index.ts";

function uuidv7(now = Date.now()): string {
  const bytes = randomBytes(16);
  let timestamp = BigInt(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fail(reason: string): never {
  console.error(JSON.stringify({ status: "not_executed", reason }));
  process.exit(1);
}

if (!process.argv.includes("--execute")) fail("EXPLICIT_EXECUTE_FLAG_REQUIRED");
if (process.env.GAPPROOF_DEEPSEEK_ENABLED !== "true" || !process.env.DEEPSEEK_API_KEY?.trim()) {
  fail("DEEPSEEK_PROVIDER_NOT_CONFIGURED");
}

const apiOrigin = process.env.GAPPROOF_API_ORIGIN?.trim() || "http://127.0.0.1:4000";
const databaseUrl = process.env.DATABASE_URL?.trim() || "postgres://gapproof:gapproof_local@127.0.0.1:55432/gapproof";
const database = createDatabase(databaseUrl);
const caseId = uuidv7();
const eventId = uuidv7();
const taskId = uuidv7();
let studentId: string | undefined;

try {
  const sessionResponse = await fetch(`${apiOrigin}/v1/device-session`, {
    method: "POST",
    headers: { "Idempotency-Key": `tutor-smoke-session-${uuidv7()}` },
  });
  if (!sessionResponse.ok) fail("DEVICE_SESSION_CREATION_FAILED");
  const cookie = sessionResponse.headers.get("set-cookie")?.split(";", 1)[0];
  const sessionBody = await sessionResponse.json() as { data?: { studentId?: string } };
  studentId = sessionBody.data?.studentId;
  if (!cookie || !studentId) fail("DEVICE_SESSION_RESPONSE_INVALID");
  const activeStudentId = studentId;
  const [student] = await database.db.select().from(students).where(eq(students.id, activeStudentId)).limit(1);
  if (!student) fail("DEVICE_STUDENT_NOT_FOUND");

  const now = new Date();
  await database.db.transaction(async (transaction) => {
    await transaction.insert(cases).values({
      id: caseId,
      tenantId: student.tenantId,
      studentId: activeStudentId,
      state: "intervention_active",
      stateVersion: 1,
      simulation: true,
      synthetic: true,
    });
    await transaction.insert(learningEvidenceEvents).values({
      id: eventId,
      tenantId: student.tenantId,
      studentId: activeStudentId,
      caseId,
      eventType: "intervention_generated",
      sourceType: "synthetic_tutor_smoke",
      sourceRef: caseId,
      payload: { inputKind: "synthetic" },
      occurredAt: now,
      idempotencyKey: `tutor-smoke-event:${eventId}`,
    });
    await transaction.insert(tasks).values({
      id: taskId,
      tenantId: student.tenantId,
      studentId: activeStudentId,
      caseId,
      taskType: "guided_intervention",
      status: "ready",
      title: "合成导师链路检查",
      estimatedMinutes: 3,
      scheduledFor: now,
      payload: {
        rationale: "仅用于开发态真实模型链路检查。",
        steps: [{ id: "step-synthetic", kind: "guided_practice", title: "寻找句子线索", content: "观察 did not 后面的动词形式。" }],
      },
      sourceEventId: eventId,
    });
  });

  const turnResponse = await fetch(`${apiOrigin}/v1/tasks/${taskId}/tutor-turns`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json", "Idempotency-Key": uuidv7() },
    body: JSON.stringify({ expectedVersion: 1, stepId: "step-synthetic", learnerText: "我觉得 did not 后面可能要看动词形式。" }),
  });
  if (turnResponse.status !== 202 && turnResponse.status !== 200) fail("TUTOR_TURN_QUEUE_FAILED");

  const deadline = Date.now() + 45_000;
  let view: { status?: string; response?: { question?: string; hint?: string | null } | null } | undefined;
  while (Date.now() < deadline) {
    const response = await fetch(`${apiOrigin}/v1/tasks/${taskId}/tutor-session`, { headers: { Cookie: cookie } });
    if (response.ok) {
      const body = await response.json() as { data?: typeof view };
      view = body.data;
      if (view?.status === "succeeded" || view?.status === "fallback" || view?.status === "failed") break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const [turn] = await database.db.select().from(tutorTurns).where(eq(tutorTurns.taskId, taskId)).limit(1);
  const [caseAfter] = await database.db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  const [taskAfter] = await database.db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (view?.status !== "succeeded" || turn?.provider !== "deepseek" || typeof view.response?.question !== "string") {
    throw new Error(`TUTOR_PROVIDER_RESULT_${String(view?.status ?? "TIMEOUT")}`);
  }
  if (caseAfter?.stateVersion !== 1 || caseAfter.state !== "intervention_active" || taskAfter?.status !== "ready") {
    throw new Error("TUTOR_MUTATED_LEARNING_STATE");
  }
  console.log(JSON.stringify({
    status: view.status,
    provider: turn.provider,
    model: turn.model,
    questionGuarded: view.response.question.endsWith("？") || view.response.question.endsWith("?"),
    hintPresent: typeof view.response.hint === "string",
    caseUnchanged: true,
    taskUnchanged: true,
  }));
} finally {
  await database.db.delete(tutorTurns).where(eq(tutorTurns.taskId, taskId));
  await database.db.delete(tutorSessions).where(eq(tutorSessions.taskId, taskId));
  await database.db.delete(tasks).where(eq(tasks.id, taskId));
  await database.db.delete(learningEvidenceEvents).where(eq(learningEvidenceEvents.id, eventId));
  await database.db.delete(cases).where(eq(cases.id, caseId));
  if (studentId) {
    await database.db.delete(deviceSessions).where(eq(deviceSessions.studentId, studentId));
    await database.db.delete(students).where(eq(students.id, studentId));
  }
  await database.close();
}
