import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { Database } from "./client.ts";
import { studentProfileRevisions, students } from "./schema.ts";

export type StudentProfileInput = {
  readonly expectedVersion: number;
  readonly grade: "7" | "8" | "9";
  readonly subject: "english";
  readonly term: "first_term" | "second_term";
  readonly region: "shanghai";
  readonly learningState: "starting" | "catching_up" | "steady";
};

export class StudentProfileVersionConflictError extends Error {
  constructor(readonly studentId: string, readonly expectedVersion: number) {
    super("STUDENT_PROFILE_VERSION_CONFLICT");
  }
}

export class StudentProfileIdempotencyKeyReusedError extends Error {
  constructor() { super("STUDENT_PROFILE_IDEMPOTENCY_KEY_REUSED"); }
}

export async function findStudentProfile(database: Pick<Database, "select">, studentId: string) {
  const [student] = await database.select().from(students).where(eq(students.id, studentId)).limit(1);
  return student;
}

export async function updateStudentProfileIdempotent(
  database: Database,
  input: StudentProfileInput & { readonly studentId: string; readonly idempotencyKey: string; readonly requestHash: string },
) {
  try {
    return await database.transaction(async (transaction) => {
      const [replay] = await transaction
        .select()
        .from(studentProfileRevisions)
        .where(and(eq(studentProfileRevisions.studentId, input.studentId), eq(studentProfileRevisions.idempotencyKey, input.idempotencyKey)))
        .limit(1);
      if (replay !== undefined) {
        if (replay.requestHash !== input.requestHash) throw new StudentProfileIdempotencyKeyReusedError();
        const student = await findStudentProfile(transaction, input.studentId);
        if (student === undefined) return { kind: "missing" as const };
        return { kind: "replayed" as const, student };
      }

      const [locked] = await transaction
        .select()
        .from(students)
        .where(eq(students.id, input.studentId))
        .for("update")
        .limit(1);
      if (locked === undefined) return { kind: "missing" as const };
      if (locked.profileVersion !== input.expectedVersion) {
        throw new StudentProfileVersionConflictError(input.studentId, input.expectedVersion);
      }

      const nextVersion = input.expectedVersion + 1;
      const [student] = await transaction
        .update(students)
        .set({
          grade: input.grade,
          subject: input.subject,
          term: input.term,
          region: input.region,
          learningState: input.learningState,
          profileVersion: nextVersion,
          updatedAt: new Date(),
        })
        .where(and(eq(students.id, input.studentId), eq(students.profileVersion, input.expectedVersion)))
        .returning();
      if (student === undefined) throw new StudentProfileVersionConflictError(input.studentId, input.expectedVersion);

      await transaction.insert(studentProfileRevisions).values({
        id: randomUUID(),
        studentId: input.studentId,
        version: nextVersion,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        grade: input.grade,
        subject: input.subject,
        term: input.term,
        region: input.region,
        learningState: input.learningState,
      });
      return { kind: "updated" as const, student };
    });
  } catch (error) {
    // A simultaneous identical request can lose the unique-key race. Resolve
    // it by reading the persisted revision instead of issuing a second write.
    if (!(error instanceof Error) || !/unique|duplicate/i.test(error.message)) throw error;
    const [replay] = await database.select().from(studentProfileRevisions)
      .where(and(eq(studentProfileRevisions.studentId, input.studentId), eq(studentProfileRevisions.idempotencyKey, input.idempotencyKey))).limit(1);
    if (replay === undefined) throw error;
    if (replay.requestHash !== input.requestHash) throw new StudentProfileIdempotencyKeyReusedError();
    const student = await findStudentProfile(database, input.studentId);
    return student === undefined ? { kind: "missing" as const } : { kind: "replayed" as const, student };
  }
}
