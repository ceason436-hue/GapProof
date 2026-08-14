import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { LocalDirectorySourceAssetStorage } from "./source-asset-storage.ts";

const asset = {
  assetId: "0198a111-1111-7000-8000-000000000002",
  objectKey: "source-assets/0198a111-1111-7000-8000-000000000001/0198a111-1111-7000-8000-000000000002",
};

describe("LocalDirectorySourceAssetStorage", () => {
  it("derives a safe path and atomically persists bytes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gapproof-upload-"));
    try {
      const storage = new LocalDirectorySourceAssetStorage(root);
      const bytes = Buffer.from("synthetic upload bytes");
      const first = await storage.put({ ...asset, bytes });
      const second = await storage.put({ ...asset, bytes });

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(await readFile(storage.pathFor(asset.assetId, asset.objectKey))).toEqual(bytes);
      expect(storage.pathFor(asset.assetId, asset.objectKey)).toContain(asset.assetId);
      expect(await readdir(path.join(root, asset.assetId))).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects traversal-shaped identifiers", async () => {
    const storage = new LocalDirectorySourceAssetStorage("C:\\tmp\\gapproof");
    expect(() => storage.pathFor("../escape", "source-assets/../escape")).toThrow();
  });
});
