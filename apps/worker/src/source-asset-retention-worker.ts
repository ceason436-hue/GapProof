import {
  findDueSourceAssets,
  markSourceAssetDeleted,
  type Database,
  type SourceAssetRow,
} from "@gapproof/db";

type RetentionStorage = {
  remove(input: { readonly assetId: string; readonly objectKey: string }): Promise<void>;
};

type RetentionRepository = {
  findDue(database: Pick<Database, "select">, now: Date, limit: number): Promise<SourceAssetRow[]>;
  markDeleted(database: Database, assetId: string, deletedAt: Date): Promise<SourceAssetRow | undefined>;
};

export interface SourceAssetRetentionWorkerOptions {
  readonly database: Database;
  readonly storage: RetentionStorage;
  readonly intervalMs?: number;
  readonly batchSize?: number;
  readonly now?: () => Date;
  readonly repository?: RetentionRepository;
  readonly onError?: (error: unknown) => void;
}

const defaultRepository: RetentionRepository = {
  findDue: findDueSourceAssets,
  markDeleted: markSourceAssetDeleted,
};

export async function runSourceAssetRetentionSweep(options: SourceAssetRetentionWorkerOptions) {
  const now = (options.now ?? (() => new Date()))();
  const repository = options.repository ?? defaultRepository;
  const assets = await repository.findDue(options.database, now, options.batchSize ?? 100);
  let deletedCount = 0;
  for (const asset of assets) {
    try {
      await options.storage.remove({ assetId: asset.id, objectKey: asset.objectKey });
      await repository.markDeleted(options.database, asset.id, now);
      deletedCount += 1;
    } catch (error) {
      options.onError?.(error);
    }
  }
  return { scannedCount: assets.length, deletedCount } as const;
}

export function createSourceAssetRetentionWorker(options: SourceAssetRetentionWorkerOptions) {
  const intervalMs = options.intervalMs ?? 60_000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) throw new Error("Source asset retention interval is invalid.");
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<unknown> | undefined;
  const sweep = () => {
    if (running !== undefined) return running;
    running = runSourceAssetRetentionSweep(options)
      .catch(error => options.onError?.(error))
      .finally(() => { running = undefined; });
    return running;
  };
  return {
    start() {
      if (timer !== undefined) return;
      void sweep();
      timer = setInterval(() => void sweep(), intervalMs);
      timer.unref?.();
    },
    async stop() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      await running;
    },
    sweep,
  };
}
