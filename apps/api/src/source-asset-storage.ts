import { createHash, randomBytes } from "node:crypto";
import { link, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_SOURCE_ASSET_BYTES = 10_485_760;

export interface SourceAssetStoragePutInput {
  readonly assetId: string;
  readonly objectKey: string;
  readonly bytes: Buffer;
}

export interface SourceAssetStorage {
  put(input: SourceAssetStoragePutInput): Promise<{ readonly created: boolean }>;
  remove(input: Pick<SourceAssetStoragePutInput, "assetId" | "objectKey">): Promise<void>;
  read(input: Pick<SourceAssetStoragePutInput, "assetId" | "objectKey">): Promise<Buffer>;
}

function assertSafeAssetPath(assetId: string, objectKey: string): void {
  if (
    !/^[0-9a-f-]{36}$/.test(assetId) ||
    objectKey.includes("..") ||
    objectKey.includes("\\") ||
    objectKey.split("/").some((part) => part.length === 0)
  ) {
    throw new Error("Unsafe source asset path.");
  }
}

export class LocalDirectorySourceAssetStorage implements SourceAssetStorage {
  constructor(readonly rootDirectory: string) {}

  pathFor(assetId: string, objectKey: string): string {
    assertSafeAssetPath(assetId, objectKey);
    const objectKeyDigest = createHash("sha256").update(objectKey).digest("hex");
    const root = path.resolve(this.rootDirectory);
    const destination = path.resolve(root, assetId, `${objectKeyDigest}.bin`);
    if (destination !== root && !destination.startsWith(`${root}${path.sep}`)) {
      throw new Error("Unsafe source asset path.");
    }
    return destination;
  }

  async put(input: SourceAssetStoragePutInput): Promise<{ readonly created: boolean }> {
    const destination = this.pathFor(input.assetId, input.objectKey);
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomBytes(12).toString("hex")}.tmp`;
    try {
      await writeFile(temporary, input.bytes, { flag: "wx" });
      try {
        await link(temporary, destination);
        return { created: true };
      } catch (error) {
        if (!isFileExistsError(error)) {
          throw error;
        }
        const existing = await readFile(destination);
        if (!existing.equals(input.bytes)) {
          throw new Error("A different source asset already exists at the destination.");
        }
        return { created: false };
      }
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async remove(input: Pick<SourceAssetStoragePutInput, "assetId" | "objectKey">): Promise<void> {
    await rm(this.pathFor(input.assetId, input.objectKey), { force: true });
  }

  async read(input: Pick<SourceAssetStoragePutInput, "assetId" | "objectKey">): Promise<Buffer> {
    return readFile(this.pathFor(input.assetId, input.objectKey));
  }

  async exists(input: Pick<SourceAssetStoragePutInput, "assetId" | "objectKey">): Promise<boolean> {
    try {
      const handle = await open(this.pathFor(input.assetId, input.objectKey), "r");
      await handle.close();
      return true;
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }
}

function isFileExistsError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
