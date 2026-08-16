import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalDirectorySourceAssetStorage } from "./local-source-asset-storage.ts";

describe("worker local source asset storage", () => {
  it("physically removes the bounded source object and is idempotent", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gapproof-retention-"));
    const input = {
      assetId: "0198c111-1111-7000-8000-000000000021",
      objectKey: "source-assets/tenant/student/asset",
    };
    const file = path.join(root, input.assetId, `${createHash("sha256").update(input.objectKey).digest("hex")}.bin`);
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, Buffer.from("private source bytes"));
      const storage = new LocalDirectorySourceAssetStorage(root);
      expect(await storage.read(input)).toEqual(Buffer.from("private source bytes"));
      await storage.remove(input);
      await storage.remove(input);
      await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects traversal-shaped paths for deletion", async () => {
    const storage = new LocalDirectorySourceAssetStorage("C:\\tmp\\gapproof-retention");
    await expect(storage.remove({ assetId: "../escape", objectKey: "source-assets/../escape" })).rejects.toThrow("Unsafe source asset path");
  });
});
