import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase } from "./client.ts";
import { attachOcrBatchPage, createRealOcrBatch, findOcrBatch, removeOcrBatchPage, replaceOcrBatchPage } from "./ocr-batch-repository.ts";
import { apiIdempotencyRecords, cases, ocrBatchPages, ocrBatches, sourceAssets, students } from "./schema.ts";

const url = process.env.TEST_DATABASE_URL;
const withDatabase = url === undefined ? describe.skip : describe;
const ids = { tenant: "0198d111-1111-7000-8000-000000000001", student: "0198d111-1111-7000-8000-000000000002", batch: "0198d111-1111-7000-8000-000000000003", case: "0198d111-1111-7000-8000-000000000004" };

withDatabase("real OCR batch repository", () => {
  const database = createDatabase(url ?? "");
  beforeAll(async () => {
    await database.db.delete(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.idempotencyKey, "real-ocr-batch-test"));
    await database.db.delete(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.idempotencyKey, "ocr-page-first"));
    await database.db.delete(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.idempotencyKey, "ocr-page-second"));
    await database.db.delete(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.idempotencyKey, "ocr-page-remove"));
    await database.db.delete(ocrBatchPages).where(eq(ocrBatchPages.batchId, ids.batch));
    await database.db.delete(ocrBatches).where(eq(ocrBatches.id, ids.batch));
    await database.db.delete(sourceAssets).where(eq(sourceAssets.studentId, ids.student));
    await database.db.delete(cases).where(eq(cases.id, ids.case));
    await database.db.delete(students).where(eq(students.id, ids.student));
    await database.db.insert(students).values({ id: ids.student, tenantId: ids.tenant, anonymousKey: "real-ocr-batch-test", grade: "8", region: "Shanghai", curriculumVersion: "unverified" });
  });
  afterAll(async () => {
    await database.db.delete(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.resourceId, ids.batch));
    await database.db.delete(ocrBatchPages).where(eq(ocrBatchPages.batchId, ids.batch));
    await database.db.delete(ocrBatches).where(eq(ocrBatches.id, ids.batch));
    await database.db.delete(sourceAssets).where(eq(sourceAssets.studentId, ids.student));
    await database.db.delete(cases).where(eq(cases.id, ids.case));
    await database.db.delete(students).where(eq(students.id, ids.student));
    await database.close();
  });
  it("replays a create request to the same real Case instead of creating a second Case", async () => {
    const first = await createRealOcrBatch(database.db, { idempotencyKey: "real-ocr-batch-test", batchId: ids.batch, caseId: ids.case, studentId: ids.student });
    const replay = await createRealOcrBatch(database.db, { idempotencyKey: "real-ocr-batch-test", batchId: "0198d111-1111-7000-8000-000000000005", caseId: "0198d111-1111-7000-8000-000000000006", studentId: ids.student });
    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({ replayed: true, batch: { id: ids.batch, caseId: ids.case, status: "collecting" } });
  });
  it("removes only the relation, compacts order, and replaces in place", async () => {
    const makeAsset = async (id: string, objectKey: string) => (await database.db.insert(sourceAssets).values({ id, tenantId: ids.tenant, studentId: ids.student, caseId: ids.case, objectKey, sha256: "a".repeat(64), mimeType: "image/png", byteSize: 100, assetType: "student_upload" }).returning())[0]!;
    const firstAsset = await makeAsset("0198d111-1111-7000-8000-000000000010", "ocr-test/first");
    const secondAsset = await makeAsset("0198d111-1111-7000-8000-000000000011", "ocr-test/second");
    const replacementAsset = await makeAsset("0198d111-1111-7000-8000-000000000012", "ocr-test/replacement");
    const first = await attachOcrBatchPage(database.db, { batchId: ids.batch, pageId: "0198d111-1111-7000-8000-000000000020", asset: firstAsset, idempotencyKey: "ocr-page-first" });
    const second = await attachOcrBatchPage(database.db, { batchId: ids.batch, pageId: "0198d111-1111-7000-8000-000000000021", asset: secondAsset, idempotencyKey: "ocr-page-second" });
    const removed = await removeOcrBatchPage(database.db, { batchId: ids.batch, pageId: first.page.id, idempotencyKey: "ocr-page-remove" });
    const replayedRemoval = await removeOcrBatchPage(database.db, { batchId: ids.batch, pageId: first.page.id, idempotencyKey: "ocr-page-remove" });
    expect(removed.replayed).toBe(false);
    expect(replayedRemoval.replayed).toBe(true);
    let batch = await findOcrBatch(database.db, ids.batch);
    expect(batch?.pages).toHaveLength(1);
    expect(batch?.pages[0]?.page).toMatchObject({ id: second.page.id, pageOrder: 1 });
    expect((await database.db.select().from(sourceAssets).where(eq(sourceAssets.id, firstAsset.id))).length).toBe(1);
    const replacement = await replaceOcrBatchPage(database.db, { batchId: ids.batch, pageId: second.page.id, asset: replacementAsset });
    expect(replacement).toMatchObject({ id: second.page.id, pageOrder: 1, assetId: replacementAsset.id });
  });
});
