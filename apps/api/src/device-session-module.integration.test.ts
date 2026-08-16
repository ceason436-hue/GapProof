import { afterAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import Fastify from "fastify";
import { createDatabase, cases, DeviceSessionIdempotencyError, deviceSessions, eq, ocrBatches, students } from "@gapproof/db";
import {
  createDeviceSessionService,
  DeviceSessionAuthError,
  DeviceSessionBatchNotFoundError,
  registerDeviceSessionRoutes,
  serializeDeviceSessionCookie,
} from "./device-session-module.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const withDatabase = databaseUrl === undefined ? describe.skip : describe;

withDatabase("device-bound student session", () => {
  const database = createDatabase(databaseUrl ?? "");
  const studentIds: string[] = [];
  const caseIds: string[] = [];
  const batchIds: string[] = [];
  let nowMs = Date.parse("2026-08-16T08:00:00.000Z");
  const service = createDeviceSessionService({
    database: database.db,
    secret: "integration-device-session-secret-32-bytes-minimum",
    secureCookies: false,
    ttlMs: 60_000,
    now: () => new Date(nowMs),
  });

  afterAll(async () => {
    for (const id of batchIds) await database.db.delete(ocrBatches).where(eq(ocrBatches.id, id));
    for (const id of caseIds) await database.db.delete(cases).where(eq(cases.id, id));
    for (const id of studentIds) {
      await database.db.delete(deviceSessions).where(eq(deviceSessions.studentId, id));
      await database.db.delete(students).where(eq(students.id, id));
    }
    await database.close();
  });

  it("concurrently replays one issuance without accepting a client student id", async () => {
    const key = `session-concurrent-${uuidv7()}`;
    const [first, second] = await Promise.all([
      service.issue({ cookieHeader: undefined, idempotencyKey: key }),
      service.issue({ cookieHeader: undefined, idempotencyKey: key }),
    ]);
    studentIds.push(first.principal.studentId);
    expect(second.principal).toEqual(first.principal);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    expect(first.cookie).toMatch(/HttpOnly; SameSite=Lax/);
    expect(first.cookie).not.toMatch(/student|tenant|Secure/);
    const cookieHeader = first.cookie!.split(";", 1)[0]!;
    expect((await service.requirePrincipal(cookieHeader)).studentId).toBe(first.principal.studentId);
    const otherSecretService = createDeviceSessionService({ database: database.db, secret: "different-integration-session-secret-32-bytes", secureCookies: false, ttlMs: 60_000, now: () => new Date(nowMs) });
    await expect(otherSecretService.issue({ cookieHeader: undefined, idempotencyKey: key })).rejects.toBeInstanceOf(DeviceSessionIdempotencyError);
  });

  it("HTTP routes reject unauthenticated recovery and ignore a supplied studentId", async () => {
    const api = Fastify();
    await registerDeviceSessionRoutes(api, service);
    const unauthorized = await api.inject({ method: "GET", url: "/v1/device-session/ocr-batches" });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json()).toMatchObject({ requestId: expect.any(String), traceId: expect.any(String) });
    const response = await api.inject({
      method: "POST", url: "/v1/device-session", headers: { "idempotency-key": `session-http-${uuidv7()}` },
      payload: { studentId: "0198ffff-ffff-7000-8000-000000000001" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.body).toMatch(/"studentId":"[0-9a-f-]{36}"/);
    expect(response.body).not.toMatch(/tenantId|0198ffff/);
    expect(response.json()).toMatchObject({ requestId: expect.any(String), traceId: expect.any(String) });
    const setCookie = response.headers["set-cookie"];
    expect(typeof setCookie).toBe("string");
    const principal = await service.requirePrincipal((setCookie as string).split(";", 1)[0]);
    studentIds.push(principal.studentId);
    expect(principal.studentId).not.toBe("0198ffff-ffff-7000-8000-000000000001");
    await api.close();
  });

  it("rejects missing and expired sessions", async () => {
    await expect(service.requirePrincipal(undefined)).rejects.toBeInstanceOf(DeviceSessionAuthError);
    const issued = await service.issue({ cookieHeader: undefined, idempotencyKey: `session-expiry-${uuidv7()}` });
    studentIds.push(issued.principal.studentId);
    const cookieHeader = issued.cookie!.split(";", 1)[0]!;
    nowMs += 60_001;
    await expect(service.requirePrincipal(cookieHeader)).rejects.toBeInstanceOf(DeviceSessionAuthError);
    nowMs -= 60_001;
  });

  it("lists only the session student's recoverable batches and hides foreign ids", async () => {
    const owner = await service.issue({ cookieHeader: undefined, idempotencyKey: `session-owner-${uuidv7()}` });
    const foreign = await service.issue({ cookieHeader: undefined, idempotencyKey: `session-foreign-${uuidv7()}` });
    studentIds.push(owner.principal.studentId, foreign.principal.studentId);
    const ownerCaseId = uuidv7(); const foreignCaseId = uuidv7();
    const ownerBatchId = uuidv7(); const foreignBatchId = uuidv7();
    caseIds.push(ownerCaseId, foreignCaseId); batchIds.push(ownerBatchId, foreignBatchId);
    await database.db.insert(cases).values([
      { id: ownerCaseId, tenantId: owner.principal.tenantId, studentId: owner.principal.studentId, synthetic: false, simulation: false },
      { id: foreignCaseId, tenantId: foreign.principal.tenantId, studentId: foreign.principal.studentId, synthetic: false, simulation: false },
    ]);
    await database.db.insert(ocrBatches).values([
      { id: ownerBatchId, tenantId: owner.principal.tenantId, studentId: owner.principal.studentId, caseId: ownerCaseId, status: "collecting" },
      { id: foreignBatchId, tenantId: foreign.principal.tenantId, studentId: foreign.principal.studentId, caseId: foreignCaseId, status: "needs_confirmation" },
    ]);
    const ownerCookie = owner.cookie!.split(";", 1)[0]!;
    expect(await service.listRecoverableBatches(ownerCookie)).toEqual([
      expect.objectContaining({ batchId: ownerBatchId, caseId: ownerCaseId, resumeKind: "continue_upload", pageCount: 0 }),
    ]);
    await expect(service.findRecoverableBatch(ownerCookie, foreignBatchId)).rejects.toBeInstanceOf(DeviceSessionBatchNotFoundError);
  });

  it("revokes the active device token", async () => {
    const issued = await service.issue({ cookieHeader: undefined, idempotencyKey: `session-revoke-${uuidv7()}` });
    studentIds.push(issued.principal.studentId);
    const cookieHeader = issued.cookie!.split(";", 1)[0]!;
    const result = await service.revoke(cookieHeader);
    expect(result.cookie).toMatch(/Max-Age=0;?$/);
    await expect(service.requirePrincipal(cookieHeader)).rejects.toBeInstanceOf(DeviceSessionAuthError);
  });
});

describe("device session cookie", () => {
  it("is HttpOnly, same-site, secure in production, and contains no identity", () => {
    const cookie = serializeDeviceSessionCookie("a".repeat(43), new Date(Date.now() + 60_000), true);
    expect(cookie).toMatch(/^gapproof_device=[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
    expect(cookie).not.toMatch(/student|tenant/);
  });
});
