import { createDatabase } from "../packages/db/src/client.ts";
import { LOCAL_DEMO_STUDENT_ID, seedLocalDemoStudent } from "../packages/db/src/local-demo-seed.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for the local Demo seed.");

const database = createDatabase(databaseUrl);
try {
  const seeded = await seedLocalDemoStudent(database.db);
  if (seeded.studentId !== LOCAL_DEMO_STUDENT_ID) throw new Error("LOCAL_DEMO_SEED_ID_MISMATCH");
  process.stdout.write(`Local synthetic Demo student ready: ${seeded.studentId}\n`);
} finally {
  await database.close();
}
