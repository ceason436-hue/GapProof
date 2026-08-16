import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase } from "./client.ts";
import {
  findActiveCaseSourceAssets,
  findDueSourceAssets,
  markSourceAssetDeleted,
  scheduleCaseSourceAssetRetention,
} from "./source-asset-repository.ts";
import { cases, sourceAssets, students } from "./schema.ts";

const url = process.env.TEST_DATABASE_URL;
const withDatabase = url === undefined ? describe.skip : describe;
const ids = {
  tenant: "0198e111-1111-7000-8000-000000000001",
  student: "0198e111-1111-7000-8000-000000000002",
  case: "0198e111-1111-7000-8000-000000000003",
  asset: "0198e111-1111-7000-8000-000000000004",
};

withDatabase("source asset retention repository", () => {
  const database = createDatabase(url ?? "");
  beforeAll(async () => {
    await database.db.delete(sourceAssets).where(eq(sourceAssets.id, ids.asset));
    await database.db.delete(cases).where(eq(cases.id, ids.case));
    await database.db.delete(students).where(eq(students.id, ids.student));
    await database.db.insert(students).values({ id: ids.student, tenantId: ids.tenant, anonymousKey: "source-retention-integration" });
    await database.db.insert(cases).values({ id: ids.case, tenantId: ids.tenant, studentId: ids.student, state: "awaiting_confirmation" });
    await database.db.insert(sourceAssets).values({
      id: ids.asset,
      tenantId: ids.tenant,
      studentId: ids.student,
      caseId: ids.case,
      objectKey: `source-assets/${ids.tenant}/${ids.student}/${ids.asset}`,
      sha256: "a".repeat(64),
      mimeType: "image/png",
      byteSize: 100,
      assetType: "student_upload",
      retentionUntil: new Date("2026-08-23T00:00:00Z"),
    });
  });
  afterAll(async () => {
    await database.db.delete(sourceAssets).where(eq(sourceAssets.id, ids.asset));
    await database.db.delete(cases).where(eq(cases.id, ids.case));
    await database.db.delete(students).where(eq(students.id, ids.student));
    await database.close();
  });

  it("moves confirmed originals to a 24-hour deadline and excludes tombstones", async () => {
    const confirmedAt = new Date("2026-08-16T03:00:00Z");
    const scheduled = await scheduleCaseSourceAssetRetention(database.db, ids.case, confirmedAt);
    expect(scheduled[0]?.retentionUntil?.toISOString()).toBe("2026-08-17T03:00:00.000Z");
    expect(await findDueSourceAssets(database.db, new Date("2026-08-17T02:59:59Z"))).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: ids.asset })]));
    expect(await findDueSourceAssets(database.db, new Date("2026-08-17T03:00:00Z"))).toEqual(expect.arrayContaining([expect.objectContaining({ id: ids.asset })]));

    const tombstone = await markSourceAssetDeleted(database.db, ids.asset, new Date("2026-08-17T03:00:01Z"));
    expect(tombstone).toMatchObject({
      objectKey: `deleted-source-assets/${ids.asset}`,
      sha256: "0".repeat(64),
      mimeType: "application/octet-stream",
      byteSize: 1,
      quality: null,
    });
    expect(await findActiveCaseSourceAssets(database.db, ids.case)).toEqual([]);
    expect(await findDueSourceAssets(database.db, new Date("2026-08-18T00:00:00Z"))).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: ids.asset })]));
  });
});
