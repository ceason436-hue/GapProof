import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import type { TodayOverview } from "@gapproof/contracts";
import type { Database } from "./client.ts";
import {
  cases,
  learningEvidenceEvents,
  tasks,
} from "./schema.ts";

type TodayOverviewDatabase = Pick<Database, "select">;

type TodayOverviewInput = {
  readonly studentId: string;
  readonly timeZone: string;
  readonly now: Date;
};

function localDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map(({ type, value }) => [type, value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function localDateWindow(now: Date, timeZone: string): string[] {
  const today = localDate(now, timeZone);
  const cursor = new Date(`${today}T12:00:00.000Z`);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(cursor);
    date.setUTCDate(cursor.getUTCDate() - (6 - index));
    return date.toISOString().slice(0, 10);
  });
}

function progressKind(
  eventType: typeof learningEvidenceEvents.$inferSelect.eventType,
  payload: Record<string, unknown>,
): TodayOverview["recentProgress"][number]["kind"] | null {
  switch (eventType) {
    case "recognition_confirmed":
      return "recognition_confirmed";
    case "probe_evaluated":
      return "diagnosis_checked";
    case "intervention_completed":
    case "mistake_review_completed":
      return "practice_completed";
    case "plan_replanned":
      return "plan_adjusted";
    case "retest_evaluated":
      if (payload.kind !== "d1" || typeof payload.passed !== "boolean") {
        return null;
      }
      return payload.passed ? "d1_passed" : "d1_needs_followup";
    default:
      return null;
  }
}

function toNextCheck(
  row:
    | {
        readonly id: string;
        readonly taskType: "guided_intervention" | "d1_retest" | "d7_retest" | "mistake_review";
        readonly title: string;
        readonly scheduledFor: Date;
        readonly dueAt: Date | null;
        readonly estimatedMinutes: number;
      }
    | undefined,
): TodayOverview["nextCheck"] {
  if (
    row === undefined ||
    (row.taskType !== "d1_retest" && row.taskType !== "d7_retest")
  ) {
    return null;
  }
  return {
    taskId: row.id,
    taskType: row.taskType,
    title: row.title,
    scheduledFor: row.scheduledFor.toISOString(),
    dueAt: row.dueAt?.toISOString() ?? null,
    estimatedMinutes: row.estimatedMinutes,
  };
}

export async function findTodayOverview(
  database: TodayOverviewDatabase,
  input: TodayOverviewInput,
): Promise<TodayOverview> {
  const [startedCaseRows, completedTaskRows, pendingConfirmationRows, progressRows, nextCheckRows] =
    await Promise.all([
      database
        .select({ id: cases.id })
        .from(cases)
        .where(
          and(
            eq(cases.studentId, input.studentId),
            isNull(cases.deletedAt),
          ),
        )
        .limit(1),
      database
        .select({ completedAt: tasks.completedAt })
        .from(tasks)
        .where(
          and(
            eq(tasks.studentId, input.studentId),
            eq(tasks.status, "completed"),
            isNotNull(tasks.completedAt),
          ),
        ),
      database
        .select({ id: cases.id })
        .from(cases)
        .where(
          and(
            eq(cases.studentId, input.studentId),
            eq(cases.state, "awaiting_confirmation"),
            isNull(cases.deletedAt),
          ),
        ),
      database
        .select({
          id: learningEvidenceEvents.id,
          caseId: learningEvidenceEvents.caseId,
          eventType: learningEvidenceEvents.eventType,
          payload: learningEvidenceEvents.payload,
          occurredAt: learningEvidenceEvents.occurredAt,
        })
        .from(learningEvidenceEvents)
        .where(
          and(
            eq(learningEvidenceEvents.studentId, input.studentId),
            inArray(learningEvidenceEvents.eventType, [
              "recognition_confirmed",
              "probe_evaluated",
              "intervention_completed",
              "mistake_review_completed",
              "retest_evaluated",
              "plan_replanned",
            ]),
          ),
        )
        .orderBy(desc(learningEvidenceEvents.occurredAt), desc(learningEvidenceEvents.id)),
      database
        .select({
          id: tasks.id,
          taskType: tasks.taskType,
          title: tasks.title,
          scheduledFor: tasks.scheduledFor,
          dueAt: tasks.dueAt,
          estimatedMinutes: tasks.estimatedMinutes,
        })
        .from(tasks)
        .where(
          and(
            eq(tasks.studentId, input.studentId),
            eq(tasks.status, "scheduled"),
            inArray(tasks.taskType, ["d1_retest", "d7_retest"]),
          ),
        )
        .orderBy(asc(tasks.scheduledFor), asc(tasks.createdAt), asc(tasks.id))
        .limit(1),
    ]);

  const dates = localDateWindow(input.now, input.timeZone);
  const completedCounts = new Map(dates.map((date) => [date, 0]));
  for (const row of completedTaskRows) {
    if (row.completedAt === null) continue;
    const date = localDate(row.completedAt, input.timeZone);
    if (completedCounts.has(date)) {
      completedCounts.set(date, (completedCounts.get(date) ?? 0) + 1);
    }
  }

  const recentProgress = progressRows
    .map((row) => {
      const kind = progressKind(row.eventType, row.payload);
      return kind === null
        ? null
        : {
            eventId: row.id,
            caseId: row.caseId,
            kind,
            occurredAt: row.occurredAt.toISOString(),
          };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .slice(0, 2);

  return {
    hasStartedJourney: startedCaseRows.length > 0,
    activityDays: dates.map((date) => ({
      localDate: date,
      completedTaskCount: completedCounts.get(date) ?? 0,
    })),
    weeklyGoal: null,
    pendingConfirmationCount: pendingConfirmationRows.length,
    recentProgress,
    nextCheck: toNextCheck(nextCheckRows[0]),
  };
}
