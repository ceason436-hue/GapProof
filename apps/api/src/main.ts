import { createDatabase } from "@gapproof/db";
import { createJobQueue } from "@gapproof/jobs";

import { buildApi } from "./app.ts";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://gapproof:gapproof_local@localhost:55432/gapproof";
const port = Number(process.env.API_PORT ?? "4000");

const database = createDatabase(databaseUrl);
const queue = createJobQueue(databaseUrl);
queue.boss.on("error", (error) => {
  process.stderr.write(`pg-boss API producer error: ${error.message}\n`);
});

await queue.start();
const api = await buildApi({ database: database.db, queue });

async function shutdown() {
  await api.close();
  await queue.stop();
  await database.close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await api.listen({ host: "0.0.0.0", port });

