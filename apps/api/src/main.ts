import { createDatabase } from "@gapproof/db";
import { createJobQueue } from "@gapproof/jobs";
import path from "node:path";

import { buildApi } from "./app.ts";
import { createDeviceSessionService } from "./device-session-module.ts";
import { createSourceAssetStorageFromEnvironment } from "./source-asset-storage.ts";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://gapproof:gapproof_local@127.0.0.1:55432/gapproof";
const port = Number(process.env.API_PORT ?? "4000");
const production = process.env.NODE_ENV === "production";
const uploadSigningSecret = process.env.GAPPROOF_UPLOAD_SIGNING_SECRET ?? (production ? undefined : "local-dev-upload-signing-secret-32-bytes");
const deviceSessionSecret = process.env.GAPPROOF_DEVICE_SESSION_SECRET ?? (production ? undefined : "local-dev-device-session-secret-32-bytes");
if (deviceSessionSecret === undefined || deviceSessionSecret.length < 32) {
  throw new Error("GAPPROOF_DEVICE_SESSION_SECRET must contain at least 32 characters.");
}
if (production && (uploadSigningSecret === undefined || uploadSigningSecret.length < 32)) {
  throw new Error("GAPPROOF_UPLOAD_SIGNING_SECRET must contain at least 32 characters in production.");
}
const uploadStorage = createSourceAssetStorageFromEnvironment({
  ...process.env,
  ...(production || process.env.GAPPROOF_UPLOAD_DIR !== undefined
    ? {}
    : { GAPPROOF_UPLOAD_DIR: path.resolve(".local", "gapproof", "uploads") }),
});

const database = createDatabase(databaseUrl);
const queue = createJobQueue(databaseUrl);
queue.boss.on("error", (error) => {
  process.stderr.write(`pg-boss API producer error: ${error.message}\n`);
});

await queue.start();
const api = await buildApi({
  database: database.db,
  queue,
  demoClockEnabled: process.env.GAPPROOF_DEMO_CLOCK_ENABLED === "true",
  deviceSession: createDeviceSessionService({
    database: database.db,
    secret: deviceSessionSecret,
    secureCookies: process.env.NODE_ENV === "production",
  }),
  ...(uploadStorage !== undefined && uploadSigningSecret !== undefined && uploadSigningSecret.length > 0
    ? {
        uploadStorage,
        uploadSigningSecret,
      }
    : {}),
});

async function shutdown() {
  await api.close();
  await queue.stop();
  await database.close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await api.listen({ host: "0.0.0.0", port });
