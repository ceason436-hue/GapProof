import { createDatabase } from "./client.ts";
import { runMigrations } from "./run-migrations.ts";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://gapproof:gapproof_local@127.0.0.1:55432/gapproof";

const database = createDatabase(databaseUrl);

try {
  await runMigrations(database.db);
} finally {
  await database.close();
}
