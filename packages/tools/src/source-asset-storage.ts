import { createHash, createHmac, randomBytes } from "node:crypto";
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

export interface S3SourceAssetStorageOptions {
  /** Base HTTPS endpoint, without the bucket or object path. */
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  /** AWS uses `s3`; override only when the selected gateway documents another SigV4 scope. */
  readonly serviceName?: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

export interface SourceAssetStorageEnvironment {
  readonly NODE_ENV?: string;
  readonly GAPPROOF_STORAGE_DRIVER?: string;
  readonly GAPPROOF_UPLOAD_DIR?: string;
  readonly GAPPROOF_S3_ENDPOINT?: string;
  readonly GAPPROOF_S3_BUCKET?: string;
  readonly GAPPROOF_S3_REGION?: string;
  readonly GAPPROOF_S3_SERVICE?: string;
  readonly GAPPROOF_S3_ACCESS_KEY_ID?: string;
  readonly GAPPROOF_S3_SECRET_ACCESS_KEY?: string;
  readonly GAPPROOF_S3_SESSION_TOKEN?: string;
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

/**
 * A minimal S3-compatible object storage adapter. It intentionally uses the
 * standard SigV4 REST protocol instead of bringing an SDK into the API bundle;
 * this works with AWS S3 and gateways that explicitly support the same REST contract.
 */
export class S3SourceAssetStorage implements SourceAssetStorage {
  private readonly endpoint: URL;
  private readonly bucket: string;
  private readonly region: string;
  private readonly serviceName: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly sessionToken: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(options: S3SourceAssetStorageOptions) {
    this.endpoint = parseS3Endpoint(options.endpoint);
    this.bucket = parseS3Bucket(options.bucket);
    this.region = parseNonEmptyConfig(options.region, "S3 region");
    this.serviceName = parseServiceName(options.serviceName ?? "s3");
    this.accessKeyId = parseCredential(options.accessKeyId, "S3 access key ID");
    this.secretAccessKey = parseCredential(options.secretAccessKey, "S3 secret access key");
    this.sessionToken = parseOptionalCredential(options.sessionToken, "S3 session token");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
  }

  async put(input: SourceAssetStoragePutInput): Promise<{ readonly created: boolean }> {
    const request = this.signedRequest("PUT", input.assetId, input.objectKey, input.bytes, {
      "content-type": "application/octet-stream",
      "if-none-match": "*",
    });
    const response = await this.execute(request);
    if (response.status >= 200 && response.status < 300) return { created: true };
    if (response.status === 412 || response.status === 409) {
      const existing = await this.read({ assetId: input.assetId, objectKey: input.objectKey });
      if (existing.equals(input.bytes)) return { created: false };
      throw new SourceAssetStorageError(
        "SOURCE_ASSET_CONFLICT",
        "A different source asset already exists at the destination.",
        response.status,
      );
    }
    throw storageResponseError("put", response.status);
  }

  async remove(input: Pick<SourceAssetStoragePutInput, "assetId" | "objectKey">): Promise<void> {
    const response = await this.execute(this.signedRequest("DELETE", input.assetId, input.objectKey));
    if (response.status === 404 || (response.status >= 200 && response.status < 300)) return;
    throw storageResponseError("delete", response.status);
  }

  async read(input: Pick<SourceAssetStoragePutInput, "assetId" | "objectKey">): Promise<Buffer> {
    const response = await this.execute(this.signedRequest("GET", input.assetId, input.objectKey));
    if (response.status === 404) throw sourceAssetNotFoundError();
    if (!response.ok) throw storageResponseError("read", response.status);
    return Buffer.from(await response.arrayBuffer());
  }

  private signedRequest(
    method: "DELETE" | "GET" | "PUT",
    assetId: string,
    objectKey: string,
    body?: Buffer,
    extraHeaders: Readonly<Record<string, string>> = {},
  ): Request {
    assertSafeAssetPath(assetId, objectKey);
    const url = objectUrl(this.endpoint, this.bucket, objectKey);
    const payloadHash = createHash("sha256").update(body ?? Buffer.alloc(0)).digest("hex");
    const timestamp = formatAmzTimestamp(this.now());
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": timestamp,
      ...extraHeaders,
    };
    if (this.sessionToken !== undefined) headers["x-amz-security-token"] = this.sessionToken;

    const signedHeaderNames = Object.keys(headers).map((name) => name.toLowerCase()).sort();
    const canonicalHeaders = signedHeaderNames
      .map((name) => `${name}:${normalizeHeaderValue(headers[name] ?? "")}\n`)
      .join("");
    const signedHeaders = signedHeaderNames.join(";");
    const canonicalRequest = [
      method,
      url.pathname,
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const date = timestamp.slice(0, 8);
    const scope = `${date}/${this.region}/${this.serviceName}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      timestamp,
      scope,
      createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${this.secretAccessKey}`, date), this.region), this.serviceName),
      "aws4_request",
    );
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${hmac(signingKey, stringToSign, "hex")}`;

    return new Request(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
    });
  }

  private async execute(request: Request): Promise<Response> {
    try {
      return await this.fetchImpl(request);
    } catch (error) {
      throw new SourceAssetStorageError(
        "SOURCE_ASSET_STORAGE_NETWORK",
        "Object storage request failed.",
        undefined,
        { cause: error },
      );
    }
  }
}

export class SourceAssetStorageError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "SourceAssetStorageError";
  }
}

/**
 * Selects the storage implementation without ever silently using local disk
 * in production. A local directory remains available for development fixtures.
 */
export function createSourceAssetStorageFromEnvironment(
  environment: SourceAssetStorageEnvironment = process.env,
): SourceAssetStorage | undefined {
  const nodeEnv = environment.NODE_ENV?.trim().toLowerCase() ?? "";
  const configuredDriver = environment.GAPPROOF_STORAGE_DRIVER?.trim().toLowerCase();
  const driver = configuredDriver ?? (nodeEnv === "production" ? "s3" : "local");

  if (driver === "local") {
    if (nodeEnv === "production") {
      throw new Error("Production source asset storage must use the S3-compatible driver.");
    }
    const root = environment.GAPPROOF_UPLOAD_DIR?.trim();
    return root === undefined || root.length === 0 ? undefined : new LocalDirectorySourceAssetStorage(root);
  }
  if (driver !== "s3") throw new Error("GAPPROOF_STORAGE_DRIVER must be local or s3.");

  return new S3SourceAssetStorage({
    endpoint: requiredEnvironment(environment.GAPPROOF_S3_ENDPOINT, "GAPPROOF_S3_ENDPOINT"),
    bucket: requiredEnvironment(environment.GAPPROOF_S3_BUCKET, "GAPPROOF_S3_BUCKET"),
    region: requiredEnvironment(environment.GAPPROOF_S3_REGION, "GAPPROOF_S3_REGION"),
    ...(environment.GAPPROOF_S3_SERVICE === undefined
      ? {}
      : { serviceName: environment.GAPPROOF_S3_SERVICE }),
    accessKeyId: requiredEnvironment(environment.GAPPROOF_S3_ACCESS_KEY_ID, "GAPPROOF_S3_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnvironment(
      environment.GAPPROOF_S3_SECRET_ACCESS_KEY,
      "GAPPROOF_S3_SECRET_ACCESS_KEY",
    ),
    ...(environment.GAPPROOF_S3_SESSION_TOKEN === undefined
      ? {}
      : { sessionToken: environment.GAPPROOF_S3_SESSION_TOKEN }),
  });
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

function parseS3Endpoint(value: string): URL {
  const trimmed = value.trim();
  let endpoint: URL;
  try {
    endpoint = new URL(trimmed);
  } catch {
    throw new Error("S3 endpoint must be a valid HTTPS URL.");
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username.length > 0 ||
    endpoint.password.length > 0 ||
    endpoint.search.length > 0 ||
    endpoint.hash.length > 0 ||
    endpoint.hostname.length === 0
  ) {
    throw new Error("S3 endpoint must be an HTTPS URL without credentials or query parameters.");
  }
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, "");
  return endpoint;
}

function parseS3Bucket(value: string): string {
  const bucket = value.trim();
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes("..")) {
    throw new Error("S3 bucket name is invalid.");
  }
  return bucket;
}

function parseNonEmptyConfig(value: string, label: string): string {
  const parsed = value.trim();
  if (parsed.length === 0 || /[\u0000-\u001f\u007f]/.test(parsed)) throw new Error(`${label} is invalid.`);
  return parsed;
}

function parseCredential(value: string, label: string): string {
  const parsed = parseNonEmptyConfig(value, label);
  if (/\s/.test(parsed)) throw new Error(`${label} is invalid.`);
  return parsed;
}

function parseServiceName(value: string): string {
  const serviceName = parseNonEmptyConfig(value, "S3 service name");
  if (!/^[a-z0-9-]{1,32}$/.test(serviceName)) throw new Error("S3 service name is invalid.");
  return serviceName;
}

function parseOptionalCredential(value: string | undefined, label: string): string | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  return parseCredential(value, label);
}

function requiredEnvironment(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) throw new Error(`${name} must be configured.`);
  return value;
}

function objectUrl(endpoint: URL, bucket: string, objectKey: string): URL {
  const pathPrefix = endpoint.pathname.replace(/\/+$/, "");
  const encodedKey = objectKey
    .split("/")
    .map((part) => encodeRfc3986(part))
    .join("/");
  const url = new URL(endpoint.toString());
  url.pathname = `${pathPrefix}/${encodeRfc3986(bucket)}/${encodedKey}`;
  return url;
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function formatAmzTimestamp(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error("S3 signing clock is invalid.");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function normalizeHeaderValue(value: string): string {
  return value.trim().replace(/[\t ]+/g, " ");
}

function hmac(key: string | Buffer, value: string): Buffer;
function hmac(key: string | Buffer, value: string, encoding: "hex"): string;
function hmac(key: string | Buffer, value: string, encoding?: "hex"): Buffer | string {
  const digest = createHmac("sha256", key).update(value).digest();
  return encoding === "hex" ? digest.toString("hex") : digest;
}

function storageResponseError(operation: string, status: number): SourceAssetStorageError {
  return new SourceAssetStorageError(
    "SOURCE_ASSET_STORAGE_HTTP",
    `Object storage ${operation} request failed.`,
    status,
  );
}

function sourceAssetNotFoundError(): SourceAssetStorageError {
  return new SourceAssetStorageError("ENOENT", "Source asset object was not found.", 404);
}
