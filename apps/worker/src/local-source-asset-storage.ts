import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

export class LocalDirectorySourceAssetStorage {
  constructor(private readonly rootDirectory: string) {}

  async read(input: { readonly assetId: string; readonly objectKey: string }): Promise<Buffer> {
    return readFile(this.pathFor(input));
  }

  async remove(input: { readonly assetId: string; readonly objectKey: string }): Promise<void> {
    await rm(this.pathFor(input), { force: true });
  }

  private pathFor(input: { readonly assetId: string; readonly objectKey: string }): string {
    if (
      !/^[0-9a-f-]{36}$/.test(input.assetId) ||
      input.objectKey.includes("..") ||
      input.objectKey.includes("\\") ||
      input.objectKey.split("/").some((part) => part.length === 0)
    ) throw new Error("Unsafe source asset path.");
    const root = path.resolve(this.rootDirectory);
    const digest = createHash("sha256").update(input.objectKey).digest("hex");
    const file = path.resolve(root, input.assetId, `${digest}.bin`);
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error("Unsafe source asset path.");
    return file;
  }
}
