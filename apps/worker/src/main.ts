import { createDatabase } from "@gapproof/db";
import { createJobQueue } from "@gapproof/jobs";
import { createRealFormHypothesesAdapterFromEnv } from "@gapproof/tools";

import { createRunNextWorker } from "./run-next-worker.ts";
import { createRetestDueWorker } from "./retest-due-worker.ts";
import { createReplanWorker } from "./replan-worker.ts";
import { createSourceAssetQualityWorker } from "./source-asset-quality-worker.ts";
import { createTutorTurnWorker } from "./tutor-turn-worker.ts";
import { createRealOcrBatchWorker } from "./real-ocr-batch-worker.ts";
import { createSourceAssetRetentionWorker } from "./source-asset-retention-worker.ts";
import { LocalDirectorySourceAssetStorage } from "./local-source-asset-storage.ts";
import { requireUploadDirectory } from "./worker-config.ts";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://gapproof:gapproof_local@127.0.0.1:55432/gapproof";

const uploadDirectory = requireUploadDirectory(process.env.GAPPROOF_UPLOAD_DIR);
const database = createDatabase(databaseUrl);
const queue = createJobQueue(databaseUrl);
queue.boss.on("error", (error) => {
  process.stderr.write(`pg-boss Worker error: ${error.message}\n`);
});

await queue.start();
const worker = createRunNextWorker({
  database: database.db,
  queue,
  realFormHypotheses: createRealFormHypothesesAdapterFromEnv(process.env),
});
const retestDueWorker = createRetestDueWorker({
  database: database.db,
  queue,
});
const replanWorker = createReplanWorker({ database: database.db, queue });
const sourceAssetStorage = new LocalDirectorySourceAssetStorage(uploadDirectory);
const qualityWorker = createSourceAssetQualityWorker({
  database: database.db,
  queue,
  storage: sourceAssetStorage,
});
const tutorTurnWorker = createTutorTurnWorker({ database: database.db, queue });
const realOcrWorker = createRealOcrBatchWorker({ database: database.db, queue, storage: sourceAssetStorage });
const retentionWorker = createSourceAssetRetentionWorker({
  database: database.db,
  storage: sourceAssetStorage,
  onError: error => process.stderr.write(`Source asset retention error: ${error instanceof Error ? error.message : "unknown error"}\n`),
});
await worker.start();
await retestDueWorker.start();
await replanWorker.start();
await qualityWorker.start();
await tutorTurnWorker.start();
await realOcrWorker.start();
retentionWorker.start();

async function shutdown() {
  await retentionWorker.stop();
  await tutorTurnWorker.stop();
  await replanWorker.stop();
  await retestDueWorker.stop();
  await worker.stop();
  await qualityWorker.stop();
  await realOcrWorker.stop();
  await queue.stop();
  await database.close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
