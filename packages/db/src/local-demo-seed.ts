import type { Database } from "./client.ts";
import { students } from "./schema.ts";

export const LOCAL_DEMO_TENANT_ID = "0198b111-1111-7000-8000-0000000000d1";
export const LOCAL_DEMO_STUDENT_ID = "0198b111-1111-7000-8000-0000000000d2";

export async function seedLocalDemoStudent(database: Database) {
  const [student] = await database
    .insert(students)
    .values({
      id: LOCAL_DEMO_STUDENT_ID,
      tenantId: LOCAL_DEMO_TENANT_ID,
      anonymousKey: "local-synthetic-demo-student-v1",
      timezone: "Asia/Shanghai",
      status: "active",
      deletedAt: null,
    })
    .onConflictDoUpdate({
      target: students.id,
      set: {
        tenantId: LOCAL_DEMO_TENANT_ID,
        anonymousKey: "local-synthetic-demo-student-v1",
        timezone: "Asia/Shanghai",
        status: "active",
        deletedAt: null,
        updatedAt: new Date(),
      },
    })
    .returning({ id: students.id });

  if (student === undefined) {
    throw new Error("LOCAL_DEMO_SEED_FAILED");
  }
  return { tenantId: LOCAL_DEMO_TENANT_ID, studentId: student.id } as const;
}
