import { createDatabase } from "@gapproof/db";
import { createJobQueue } from "@gapproof/jobs";

import { createRunNextWorker } from "./run-next-worker.ts";
import { createRetestDueWorker } from "./retest-due-worker.ts";
import { createReplanWorker } from "./replan-worker.ts";
import { createSourceAssetQualityWorker } from "./source-asset-quality-worker.ts";
import { LocalDirectorySourceAssetStorage } from "./local-source-asset-storage.ts";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://gapproof:gapproof_local@localhost:55432/gapproof";

const database = createDatabase(databaseUrl);
const queue = createJobQueue(databaseUrl);
const uploadDirectory = process.env.GAPPROOF_UPLOAD_DIR;
queue.boss.on("error", (error) => {
  process.stderr.write(`pg-boss Worker error: ${error.message}\n`);
});

await queue.start();
const worker = createRunNextWorker({ database: database.db, queue });
const retestDueWorker = createRetestDueWorker({
  database: database.db,
  queue,
});
const replanWorker = createReplanWorker({ database: database.db, queue });
const qualityWorker = uploadDirectory === undefined
  ? undefined
  : createSourceAssetQualityWorker({
      database: database.db,
      queue,
      storage: new LocalDirectorySourceAssetStorage(uploadDirectory),
    });
await worker.start();
await retestDueWorker.start();
await replanWorker.start();
await qualityWorker?.start();

async function shutdown() {
  await replanWorker.stop();
  await retestDueWorker.stop();
  await worker.stop();
  await qualityWorker?.stop();
  await queue.stop();
  await database.close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
