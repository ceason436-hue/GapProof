import { createDatabase } from "@gapproof/db";
import { createJobQueue } from "@gapproof/jobs";

import { createRunNextWorker } from "./run-next-worker.ts";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://gapproof:gapproof_local@localhost:55432/gapproof";

const database = createDatabase(databaseUrl);
const queue = createJobQueue(databaseUrl);
queue.boss.on("error", (error) => {
  process.stderr.write(`pg-boss Worker error: ${error.message}\n`);
});

await queue.start();
const worker = createRunNextWorker({ database: database.db, queue });
await worker.start();

async function shutdown() {
  await worker.stop();
  await queue.stop();
  await database.close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

