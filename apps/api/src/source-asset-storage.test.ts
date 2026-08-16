import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  LocalDirectorySourceAssetStorage,
  S3SourceAssetStorage,
  createSourceAssetStorageFromEnvironment,
} from "./source-asset-storage.ts";

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
      expect(await storage.read(asset)).toEqual(bytes);
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

  it("does not turn a missing object into a successful read", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gapproof-upload-"));
    try {
      const storage = new LocalDirectorySourceAssetStorage(root);
      await expect(storage.read(asset)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("S3SourceAssetStorage", () => {
  const options = {
    endpoint: "https://storage.example.test",
    bucket: "gapproof-assets",
    region: "cn-hangzhou",
    accessKeyId: "fixture-access-key",
    secretAccessKey: "fixture-secret-key",
    now: () => new Date("2026-08-16T08:09:10.000Z"),
  } as const;

  it("uses conditional SigV4 PUT and preserves idempotency without overwriting", async () => {
    const objects = new Map<string, Buffer>();
    const requests: Request[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      const key = request.url;
      if (request.method === "PUT") {
        if (objects.has(key)) return new Response(null, { status: 412 });
        objects.set(key, Buffer.from(await request.arrayBuffer()));
        return new Response(null, { status: 200 });
      }
      if (request.method === "GET") {
        const bytes = objects.get(key);
        return bytes === undefined ? new Response(null, { status: 404 }) : new Response(bytes, { status: 200 });
      }
      if (request.method === "DELETE") {
        objects.delete(key);
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 405 });
    };
    const storage = new S3SourceAssetStorage({ ...options, fetchImpl });
    const bytes = Buffer.from("fixture source asset");

    expect(await storage.put({ ...asset, bytes })).toEqual({ created: true });
    expect(await storage.put({ ...asset, bytes })).toEqual({ created: false });
    await expect(storage.put({ ...asset, bytes: Buffer.from("different") })).rejects.toMatchObject({
      code: "SOURCE_ASSET_CONFLICT",
    });
    expect(await storage.read(asset)).toEqual(bytes);
    await storage.remove(asset);
    await expect(storage.read(asset)).rejects.toMatchObject({ code: "ENOENT", status: 404 });

    const put = requests.find((request) => request.method === "PUT");
    expect(put?.url).toBe(
      "https://storage.example.test/gapproof-assets/source-assets/0198a111-1111-7000-8000-000000000001/0198a111-1111-7000-8000-000000000002",
    );
    expect(put?.headers.get("if-none-match")).toBe("*");
    expect(put?.headers.get("x-amz-content-sha256")).toBeTruthy();
    expect(put?.headers.get("x-amz-date")).toBe("20260816T080910Z");
    expect(put?.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=fixture-access-key\//);
  });

  it("fails closed for unsafe endpoints, keys, and missing production configuration", async () => {
    expect(
      () => new S3SourceAssetStorage({ ...options, endpoint: "http://storage.example.test" }),
    ).toThrow("HTTPS");
    const storage = new S3SourceAssetStorage(options);
    await expect(storage.put({ ...asset, assetId: "../escape", bytes: Buffer.from("x") })).rejects.toThrow();
    expect(() => createSourceAssetStorageFromEnvironment({ NODE_ENV: "production" })).toThrow(
      "GAPPROOF_S3_ENDPOINT",
    );
    expect(() =>
      createSourceAssetStorageFromEnvironment({ NODE_ENV: "production", GAPPROOF_STORAGE_DRIVER: "local" }),
    ).toThrow("S3-compatible driver");
  });

  it("keeps local storage as an explicit development-only option", () => {
    expect(
      createSourceAssetStorageFromEnvironment({
        NODE_ENV: "development",
        GAPPROOF_STORAGE_DRIVER: "local",
        GAPPROOF_UPLOAD_DIR: "C:\\tmp\\gapproof",
      }),
    ).toBeInstanceOf(LocalDirectorySourceAssetStorage);
    expect(createSourceAssetStorageFromEnvironment({ NODE_ENV: "development" })).toBeUndefined();
  });

  it("supports a provider-documented custom SigV4 service scope", async () => {
    let request: Request | undefined;
    const storage = new S3SourceAssetStorage({
      ...options,
      serviceName: "oss",
      fetchImpl: async (input) => {
        request = input instanceof Request ? input : new Request(input);
        return new Response(null, { status: 200 });
      },
    });
    await storage.put({ ...asset, bytes: Buffer.from("oss fixture") });
    expect(request?.headers.get("authorization")).toContain("/cn-hangzhou/oss/aws4_request");
  });
});
