import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.ts";

export function createDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 5 });
  const db = drizzle(client, { schema });

  return {
    client,
    db,
    async close() {
      await client.end();
    },
  };
}

export type Database = ReturnType<typeof createDatabase>["db"];

