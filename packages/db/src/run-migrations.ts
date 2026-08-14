import { migrate } from "drizzle-orm/postgres-js/migrator";

import type { Database } from "./client.ts";

export async function runMigrations(database: Database): Promise<void> {
  await migrate(database, { migrationsFolder: "packages/db/drizzle" });
}

