import { createHash, createHmac } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import {
  authenticateDeviceSession,
  findCaseById,
  findRecoverableOcrBatchForStudent,
  findRecoverableOcrBatchesForStudent,
  findOcrBatch,
  findSourceAssetById,
  findTaskById,
  issueDeviceSession,
  revokeDeviceSession,
  type Database,
  type RecoverableOcrBatch,
} from "@gapproof/db";

export const DEVICE_SESSION_COOKIE = "gapproof_device";
export const DEFAULT_DEVICE_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export class DeviceSessionAuthError extends Error {
  readonly code = "DEVICE_SESSION_REQUIRED";
  readonly statusCode = 401;
  constructor() { super("A valid device session is required."); }
}

export class DeviceSessionBatchNotFoundError extends Error {
  readonly code = "RESOURCE_NOT_FOUND";
  readonly statusCode = 404;
  constructor() { super("The OCR batch was not found."); }
}

export class DeviceSessionOwnershipError extends Error {
  readonly code = "RESOURCE_NOT_FOUND";
  readonly statusCode = 404;
  constructor() { super("The requested resource was not found."); }
}

export interface DeviceSessionPrincipal {
  readonly sessionId: string;
  readonly studentId: string;
  readonly tenantId: string;
  readonly expiresAt: Date;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookieValue(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1 || part.slice(0, separator).trim() !== DEVICE_SESSION_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
  }
  return undefined;
}

function deterministicToken(secret: string, idempotencyKey: string): string {
  return createHmac("sha256", secret).update(`device-session:${idempotencyKey}`).digest("base64url");
}

function validIdempotencyKey(value: string): boolean {
  return /^[\x21-\x7e]{16,200}$/.test(value);
}

export function serializeDeviceSessionCookie(token: string, expiresAt: Date, secure: boolean, issuedAt = new Date()): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - issuedAt.getTime()) / 1_000));
  return `${DEVICE_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function clearDeviceSessionCookie(secure: boolean): string {
  return `${DEVICE_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function createDeviceSessionService(options: {
  readonly database: Database;
  readonly secret: string;
  readonly secureCookies?: boolean;
  readonly ttlMs?: number;
  readonly now?: () => Date;
}) {
  if (!/^[\x21-\x7e]{32,2048}$/.test(options.secret)) throw new Error("Device session secret must contain at least 32 visible ASCII characters.");
  const secure = options.secureCookies ?? true;
  const ttlMs = options.ttlMs ?? DEFAULT_DEVICE_SESSION_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 60_000 || ttlMs > 365 * 24 * 60 * 60 * 1_000) throw new Error("Device session TTL is invalid.");
  const now = options.now ?? (() => new Date());

  async function optionalPrincipal(cookieHeader: string | undefined): Promise<DeviceSessionPrincipal | undefined> {
    const token = cookieValue(cookieHeader);
    if (token === undefined) return undefined;
    const result = await authenticateDeviceSession(options.database, tokenHash(token), now());
    if (result === undefined) return undefined;
    return { sessionId: result.session.id, studentId: result.student.id, tenantId: result.student.tenantId, expiresAt: result.session.expiresAt };
  }

  async function requirePrincipal(cookieHeader: string | undefined): Promise<DeviceSessionPrincipal> {
    const principal = await optionalPrincipal(cookieHeader);
    if (principal === undefined) throw new DeviceSessionAuthError();
    return principal;
  }

  return {
    secureCookies: secure,
    async issue(input: { cookieHeader: string | undefined; idempotencyKey: string }) {
      const current = await optionalPrincipal(input.cookieHeader);
      if (current !== undefined) return { principal: current, cookie: undefined, replayed: true } as const;
      if (!validIdempotencyKey(input.idempotencyKey)) throw new Error("A bounded Idempotency-Key is required.");
      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + ttlMs);
      const token = deterministicToken(options.secret, input.idempotencyKey);
      const result = await issueDeviceSession(options.database, {
        sessionId: uuidv7(), tenantId: uuidv7(), studentId: uuidv7(), tokenHash: tokenHash(token),
        idempotencyKey: input.idempotencyKey, expiresAt, now: issuedAt,
      });
      const principal = { sessionId: result.session.id, studentId: result.session.studentId, tenantId: result.session.tenantId, expiresAt: result.session.expiresAt };
      return { principal, cookie: serializeDeviceSessionCookie(token, result.session.expiresAt, secure, issuedAt), replayed: result.replayed } as const;
    },
    optionalPrincipal,
    requirePrincipal,
    async revoke(cookieHeader: string | undefined) {
      const principal = await requirePrincipal(cookieHeader);
      await revokeDeviceSession(options.database, principal.sessionId, now());
      return { cookie: clearDeviceSessionCookie(secure) };
    },
    async listRecoverableBatches(cookieHeader: string | undefined): Promise<readonly RecoverableOcrBatch[]> {
      const principal = await requirePrincipal(cookieHeader);
      return findRecoverableOcrBatchesForStudent(options.database, principal.studentId);
    },
    async findRecoverableBatch(cookieHeader: string | undefined, batchId: string): Promise<RecoverableOcrBatch> {
      const principal = await requirePrincipal(cookieHeader);
      const batch = await findRecoverableOcrBatchForStudent(options.database, principal.studentId, batchId);
      if (batch === undefined) throw new DeviceSessionBatchNotFoundError();
      return batch;
    },
  };
}

export type DeviceSessionService = ReturnType<typeof createDeviceSessionService>;

function publicSession(principal: DeviceSessionPrincipal) {
  return { authenticated: true as const, studentId: principal.studentId, expiresAt: principal.expiresAt.toISOString() };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function responseEnvelope(request: FastifyRequest, data: unknown) {
  return { data, requestId: request.id, traceId: uuidv7() };
}

function errorEnvelope(request: FastifyRequest, code: string, message: string) {
  return {
    error: { code, message, retryable: false },
    requestId: request.id,
    traceId: uuidv7(),
  };
}

export function registerDeviceOwnershipHook(api: FastifyInstance, service: DeviceSessionService, database: Database) {
  api.addHook("preHandler", async (request) => {
    const route = request.routeOptions.url ?? "";
    if (route.startsWith("/v1/device-session") || route.startsWith("/v1/quick-checks/synthetic") || route.startsWith("/v1/demo/")) return;
    const principal = await service.requirePrincipal(request.headers.cookie);
    const params = record(request.params);
    const body = record(request.body);
    const suppliedStudentId = typeof params.studentId === "string" ? params.studentId : typeof body.studentId === "string" ? body.studentId : undefined;
    if (suppliedStudentId !== undefined && suppliedStudentId !== principal.studentId) throw new DeviceSessionOwnershipError();

    const caseId = typeof params.caseId === "string" ? params.caseId : undefined;
    if (caseId !== undefined) {
      const resource = await findCaseById(database, caseId);
      if (resource === undefined || resource.studentId !== principal.studentId || resource.tenantId !== principal.tenantId) throw new DeviceSessionOwnershipError();
    }
    const taskId = typeof params.taskId === "string" ? params.taskId : undefined;
    if (taskId !== undefined) {
      const resource = await findTaskById(database, taskId);
      if (resource === undefined || resource.studentId !== principal.studentId || resource.tenantId !== principal.tenantId) throw new DeviceSessionOwnershipError();
    }
    const assetId = typeof params.assetId === "string" ? params.assetId : undefined;
    if (assetId !== undefined) {
      const resource = await findSourceAssetById(database, assetId);
      if (resource === undefined || resource.studentId !== principal.studentId || resource.tenantId !== principal.tenantId) throw new DeviceSessionOwnershipError();
    }
    const batchId = typeof params.batchId === "string" ? params.batchId : undefined;
    if (batchId !== undefined) {
      const resource = await findOcrBatch(database, batchId);
      if (resource === undefined || resource.batch.studentId !== principal.studentId || resource.batch.tenantId !== principal.tenantId) throw new DeviceSessionOwnershipError();
    }
  });
}

export async function registerDeviceSessionRoutes(api: FastifyInstance, service: DeviceSessionService) {
  api.post("/v1/device-session", async (request: FastifyRequest, reply: FastifyReply) => {
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string") return reply.status(400).send(errorEnvelope(request, "INVALID_INPUT", "Idempotency-Key is required."));
    const result = await service.issue({ cookieHeader: request.headers.cookie, idempotencyKey: key });
    if (result.cookie !== undefined) reply.header("set-cookie", result.cookie);
    return reply.status(result.replayed ? 200 : 201).send(responseEnvelope(request, publicSession(result.principal)));
  });
  api.get("/v1/device-session", async (request, reply) => {
    try { return responseEnvelope(request, publicSession(await service.requirePrincipal(request.headers.cookie))); }
    catch (error) { if (error instanceof DeviceSessionAuthError) return reply.status(401).send(errorEnvelope(request, error.code, error.message)); throw error; }
  });
  api.delete("/v1/device-session", async (request, reply) => {
    try { const result = await service.revoke(request.headers.cookie); reply.header("set-cookie", result.cookie); return responseEnvelope(request, { authenticated: false }); }
    catch (error) { if (error instanceof DeviceSessionAuthError) return reply.status(401).send(errorEnvelope(request, error.code, error.message)); throw error; }
  });
  api.get("/v1/device-session/ocr-batches", async (request, reply) => {
    try { return responseEnvelope(request, { batches: await service.listRecoverableBatches(request.headers.cookie) }); }
    catch (error) { if (error instanceof DeviceSessionAuthError) return reply.status(401).send(errorEnvelope(request, error.code, error.message)); throw error; }
  });
  api.get<{ Params: { batchId: string } }>("/v1/device-session/ocr-batches/:batchId", async (request, reply) => {
    try { return responseEnvelope(request, await service.findRecoverableBatch(request.headers.cookie, request.params.batchId)); }
    catch (error) {
      if (error instanceof DeviceSessionAuthError || error instanceof DeviceSessionBatchNotFoundError) return reply.status(error.statusCode).send(errorEnvelope(request, error.code, error.message));
      throw error;
    }
  });
}
