import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshots = resolve(webRoot, "screenshots");
const nextEnvPath = resolve(webRoot, "next-env.d.ts");
const nextEnvBefore = await readFile(nextEnvPath);
const generatedAgentFiles = [resolve(webRoot, "AGENTS.md"), resolve(webRoot, "CLAUDE.md")];
const agentFileExisted = new Map(await Promise.all(generatedAgentFiles.map(async path => {
  try { await access(path); return [path, true]; } catch { return [path, false]; }
})));
const webPort = process.env.CASE_REVIEW_FIXTURE_WEB_PORT ?? "3104";
const webOrigin = `http://127.0.0.1:${webPort}`;
const fixtureStudentId = "0198c111-1111-7000-8000-000000000001";
const assetId = "0198c111-1111-7000-8000-000000000002";
const caseId = "0198c111-1111-7000-8000-000000000003";
const token = "fixture-review-upload-token-012345678901234567890";
const bytes = Buffer.from("synthetic same-case review bytes\n", "utf8");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const fileName = "fixture-review.png";
const uploadPath = `/api/v1/source-assets/${assetId}/content`;
const preparePath = `/api/v1/source-assets/${assetId}/commands/prepare`;
const inspectionPath = `/api/v1/source-assets/${assetId}`;
const startPath = `/api/v1/source-assets/${assetId}/commands/start-recognition`;
const extractionPath = `/api/v1/cases/${caseId}/extraction`;
const confirmPath = `/api/v1/cases/${caseId}/extraction/confirm`;
const runNextPath = `/api/v1/cases/${caseId}/commands/run-next`;
const hypothesesPath = `/api/v1/cases/${caseId}/hypotheses`;
const attemptPath = `/api/v1/cases/${caseId}/attempts`;
const backendPath = apiPath => apiPath.replace(/^\/api/, "");
const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const initiated = {
  assetId,
  processingStatus: "pending_upload",
  upload: { method: "PUT", path: uploadPath, token, expiresAt: "2026-08-15T04:10:00.000Z", mimeType: "image/png", byteSize: bytes.length },
};
const uploaded = { assetId, processingStatus: "uploaded", mimeType: "image/png", byteSize: bytes.length, sha256 };
const inspection = { assetId, stage: "image_quality_check", processingStatus: "succeeded", mimeType: "image/png", byteSize: bytes.length, quality: { status: "passed", detectedMimeType: "image/png", width: 1200, height: 900, reasons: [], checkerVersion: "image-header-v1" } };
const started = { assetId, caseId, state: "awaiting_evidence", stateVersion: 0, recognitionMode: "synthetic_demo", recognitionSource: "synthetic_fixture", uploadedAssetUsedForRecognition: false, processingStatus: "queued" };
const extraction = { caseId, state: "awaiting_confirmation", stateVersion: 1, recognitionSource: "synthetic_fixture", uploadedAssetUsedForRecognition: false, items: [{ itemId: "item-synthetic-1", prompt: "Choose the sentence that best describes the next step." }] };
const hypotheses = { caseId, stateVersion: 3, candidates: [{ id: "hypothesis-1", title: "顺序线索可能混在一起", explanation: "题目中的时间线索需要按先后顺序整理。", confidence: 0.8, evidenceRefs: ["evidence-1"] }, { id: "hypothesis-2", title: "规则边界需要再确认", explanation: "可以先找出这条规则适用的范围。", confidence: 0.7, evidenceRefs: ["evidence-2"] }], probe: { id: "probe-1", prompt: "哪一种整理方式最能帮助你继续？", choices: [{ id: "choice-a", label: "先按顺序列出已知信息" }, { id: "choice-b", label: "先圈出规则适用范围" }], testedHypothesisIds: ["hypothesis-1", "hypothesis-2"] } };
const attempt = { attemptId: "0198c111-1111-7000-8000-000000000004", caseId, state: "intervention_ready", stateVersion: 4, probeId: "probe-1", selectedChoiceId: "choice-a", passed: false, selectedHypothesisId: null, scoringMethod: "exact_choice_v1" };
const envelope = data => ({ data, requestId: `fixture-review-${scenario}-request`, traceId: `fixture-review-${scenario}-trace` });
const readBody = request => new Promise((resolveBody, rejectBody) => { const chunks = []; request.on("data", chunk => chunks.push(Buffer.from(chunk))); request.on("end", () => resolveBody(Buffer.concat(chunks))); request.on("error", rejectBody); });
const json = (response, status, body) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(body)); };
const error = (response, status, code, retryable = false) => json(response, status, { error: { code, message: `Fixture ${code}.`, retryable }, requestId: `fixture-${scenario}-${code}`, traceId: `fixture-${scenario}-${code}-trace` });

let scenario = "success";
let extractionReads = 0;
let hypothesesReads = 0;
const apiPaths = [];
const uploadPosts = [];
const puts = [];
const preparePosts = [];
const startPosts = [];
const confirmPosts = [];
const runNextPosts = [];
const attemptPosts = [];

const fixtureServer = createServer(async (request, response) => {
  const url = request.url ?? "";
  if (url.startsWith("/v1/")) apiPaths.push(url);
  if (request.method === "POST" && url === "/v1/source-assets/uploads") {
    const body = await readBody(request); uploadPosts.push({ body: JSON.parse(body.toString("utf8")), key: request.headers["idempotency-key"] }); json(response, 200, envelope(initiated)); return;
  }
  if (request.method === "PUT" && url === backendPath(uploadPath)) {
    const body = await readBody(request); puts.push({ body, token: request.headers["x-gapproof-upload-token"], contentType: request.headers["content-type"] }); json(response, 200, envelope(uploaded)); return;
  }
  if (request.method === "POST" && url === backendPath(preparePath)) {
    const body = await readBody(request); preparePosts.push({ body: JSON.parse(body.toString("utf8")), key: request.headers["idempotency-key"] }); json(response, 200, envelope({ assetId, stage: "image_quality_check", processingStatus: "queued" })); return;
  }
  if (request.method === "GET" && url === backendPath(inspectionPath)) { json(response, 200, envelope(inspection)); return; }
  if (request.method === "POST" && url === backendPath(startPath)) {
    const body = await readBody(request); startPosts.push({ body: JSON.parse(body.toString("utf8")), key: request.headers["idempotency-key"] }); json(response, 200, envelope(started)); return;
  }
  if (request.method === "GET" && url === backendPath(extractionPath)) {
    extractionReads += 1;
    if (extractionReads === 1) { error(response, 409, "EXTRACTION_NOT_READY"); return; }
    json(response, 200, envelope(extraction)); return;
  }
  if (request.method === "POST" && url === backendPath(confirmPath)) {
    const body = await readBody(request); const entry = { body: JSON.parse(body.toString("utf8")), key: request.headers["idempotency-key"] }; confirmPosts.push(entry);
    if (scenario === "confirm-network-unknown") { request.socket.destroy(); return; }
    if (scenario === "confirm-conflict" && confirmPosts.length === 1) { error(response, 409, "VERSION_CONFLICT"); return; }
    json(response, 200, envelope({ id: caseId, studentId: fixtureStudentId, state: "ready_for_diagnosis", stateVersion: 2, title: null, simulation: true, synthetic: true, updatedAt: "2026-08-15T00:00:00.000Z" })); return;
  }
  if (request.method === "POST" && url === backendPath(runNextPath)) {
    const body = await readBody(request); runNextPosts.push({ body: JSON.parse(body.toString("utf8")), key: request.headers["idempotency-key"] }); json(response, 202, envelope({ caseId, expectedVersion: JSON.parse(body.toString("utf8")).expectedVersion, status: "queued" })); return;
  }
  if (request.method === "GET" && url === backendPath(hypothesesPath)) {
    hypothesesReads += 1;
    if (hypothesesReads === 1) { error(response, 404, "RESOURCE_NOT_FOUND"); return; }
    json(response, 200, envelope(hypotheses)); return;
  }
  if (request.method === "POST" && url === backendPath(attemptPath)) {
    const body = await readBody(request); attemptPosts.push({ body: JSON.parse(body.toString("utf8")), key: request.headers["idempotency-key"] }); json(response, 200, envelope(attempt)); return;
  }
  if (request.method === "GET" && url === `/v1/cases/${caseId}`) { json(response, 200, envelope({ id: caseId, studentId: fixtureStudentId, state: "ready_for_diagnosis", stateVersion: 2, title: null, simulation: true, synthetic: true, updatedAt: "2026-08-15T00:00:00.000Z" })); return; }
  json(response, 404, { error: { code: "RESOURCE_NOT_FOUND", message: "Fixture route not found.", retryable: false }, requestId: "fixture-route-not-found", traceId: "fixture-route-not-found-trace" });
});
await new Promise((resolveListen, rejectListen) => { fixtureServer.once("error", rejectListen); fixtureServer.listen(0, "127.0.0.1", resolveListen); });
const fixtureAddress = fixtureServer.address();
if (!fixtureAddress || typeof fixtureAddress === "string") throw new Error("Review fixture server did not expose a port.");
const fixtureOrigin = `http://127.0.0.1:${fixtureAddress.port}`;
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const webServer = spawn(process.execPath, [nextBin, "dev", "-H", "127.0.0.1", "-p", webPort], { cwd: webRoot, windowsHide: true, env: { ...process.env, GAPPROOF_API_ORIGIN: fixtureOrigin, GAPPROOF_DEMO_STUDENT_ID: fixtureStudentId }, stdio: ["ignore", "pipe", "pipe"] });
let serverOutput = "";
webServer.stdout.on("data", chunk => { serverOutput += chunk; }); webServer.stderr.on("data", chunk => { serverOutput += chunk; });
const webServerExit = new Promise(resolveExit => webServer.once("exit", resolveExit));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const reset = currentScenario => { scenario = currentScenario; extractionReads = 0; hypothesesReads = 0; apiPaths.length = 0; uploadPosts.length = 0; puts.length = 0; preparePosts.length = 0; startPosts.length = 0; confirmPosts.length = 0; runNextPosts.length = 0; attemptPosts.length = 0; };
const choose = async page => { const chooserPromise = page.waitForEvent("filechooser"); await page.locator('label[for="source-upload-input"]').click(); const chooser = await chooserPromise; await chooser.setFiles({ name: fileName, mimeType: "image/png", buffer: bytes }); };

const visitReview = async page => {
  await page.goto(`${webOrigin}/materials/new`, { waitUntil: "networkidle" });
  await choose(page);
  await page.getByRole("button", { name: "开始上传" }).click();
  await page.locator('[data-upload-status="succeeded"]').waitFor({ timeout: 40_000 });
  await page.getByRole("checkbox", { name: /监护人确认/ }).check();
  await page.getByRole("button", { name: "开始识别并继续", exact: true }).click();
  await page.locator('[data-recognition-start-status="success"]').waitFor({ timeout: 10_000 });
  assert(new URL(page.url()).pathname === "/materials/new", "Synthetic start success auto-navigated instead of waiting for the explicit CTA.");
  await page.getByRole("button", { name: "查看并确认识别内容", exact: true }).click();
  await page.waitForURL(`**/materials/${caseId}/review`, { timeout: 10_000 });
  assert(new URL(page.url()).pathname === `/materials/${caseId}/review`, "Explicit CTA did not enter the same-Case review route.");
  assert(!page.url().includes("/materials/demo/review"), "Review flow fell back to the legacy demo review route.");
  await page.locator('[data-review-state="ready"]').waitFor({ timeout: 40_000 });
};

try {
  for (let attemptCount = 0; attemptCount < 40; attemptCount += 1) {
    try { if ((await fetch(`${webOrigin}/materials/new`)).ok) break; } catch {}
    if (attemptCount === 39) throw new Error(`Web server did not start.\n${serverOutput}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 500));
  }
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const currentScenario of ["success", "confirm-conflict", "confirm-network-unknown"]) {
      reset(currentScenario);
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      await visitReview(page);
      const prompt = page.locator(".case-review-item textarea");
      assert(await prompt.count() === 1 && await page.getByText("题干", { exact: true }).count() === 1, `${currentScenario}: extraction prompt was not accessible.`);
      const extractionText = await page.locator(".case-review-panel").innerText();
      assert(!extractionText.includes("学生答案") && !extractionText.includes("置信度"), `${currentScenario}: student answer or precise confidence leaked.`);
      await page.getByRole("checkbox", { name: "我确认这一项题干" }).check();
      await page.getByRole("button", { name: "确认识别内容", exact: true }).click();
      if (currentScenario === "confirm-conflict") {
        await page.locator('[data-review-state="confirm_conflict"]').waitFor();
        await page.getByRole("checkbox", { name: "我确认这一项题干" }).check();
        await page.getByRole("button", { name: "确认后重新提交", exact: true }).click();
      }
      if (currentScenario === "confirm-network-unknown") {
        await page.locator('[data-review-state="confirm_unknown"]').waitFor();
        assert(confirmPosts.length === 2, "confirm-network-unknown: expected exactly one retry.");
        assert(confirmPosts[0].key === confirmPosts[1].key && JSON.stringify(confirmPosts[0].body) === JSON.stringify(confirmPosts[1].body), "confirm-network-unknown: retry changed key/body.");
        assert(await page.getByRole("checkbox", { name: "我确认这一项题干" }).isDisabled(), "confirm-network-unknown: confirmation remained editable.");
        await new Promise(resolveWait => setTimeout(resolveWait, 1_000));
        assert(confirmPosts.length === 2, "confirm-network-unknown: a third POST was sent.");
        await page.close();
        continue;
      }
      await page.locator('[data-review-state="confirmed"]').waitFor();
      await page.getByRole("button", { name: "开始找原因", exact: true }).click();
      await page.locator('[data-review-state="hypotheses"]').waitFor({ timeout: 40_000 });
      assert(await page.getByText("顺序线索可能混在一起", { exact: true }).count() === 1, `${currentScenario}: hypothesis title missing.`);
      await page.getByRole("radio", { name: "先按顺序列出已知信息" }).check();
      await page.getByRole("button", { name: "提交确认小题", exact: true }).click();
      await page.locator('[data-review-state="probe_success"]').waitFor();
      await page.getByRole("button", { name: "开始准备引导任务", exact: true }).click();
      await page.locator('[data-review-state="intervention_accepted"]').waitFor();
      const visibleText = await page.locator("body").innerText();
      assert(!visibleText.includes(assetId) && !visibleText.includes(caseId) && !visibleText.includes(token) && !visibleText.includes(fileName) && !visibleText.includes(sha256) && !visibleText.includes("objectKey") && !visibleText.includes("jobId"), `${currentScenario}: sensitive internal fact leaked.`);
      assert(!visibleText.includes("/materials/demo/review") && !visibleText.includes("真实 OCR") && !visibleText.includes("报告已生成") && !visibleText.includes("学习效果"), `${currentScenario}: fallback or unsupported claim appeared.`);
      assert(apiPaths.every(path => ["/v1/source-assets/uploads", backendPath(uploadPath), backendPath(preparePath), backendPath(inspectionPath), backendPath(startPath), backendPath(extractionPath), backendPath(confirmPath), backendPath(runNextPath), backendPath(hypothesesPath), backendPath(attemptPath)].includes(path)), `${currentScenario}: unexpected API path.`);
      assert(uploadPosts.length === 1 && startPosts.length === 1 && confirmPosts.length === (currentScenario === "confirm-conflict" ? 2 : 1) && runNextPosts.length === 2 && attemptPosts.length === 1, `${currentScenario}: unexpected write counts.`);
      assert(uuidV7Pattern.test(uploadPosts[0].key) && uuidV7Pattern.test(startPosts[0].key) && uuidV7Pattern.test(confirmPosts[0].key) && uuidV7Pattern.test(runNextPosts[0].key) && uuidV7Pattern.test(attemptPosts[0].key), `${currentScenario}: a write intent was not UUIDv7.`);
      assert(new Set([uploadPosts[0].key, startPosts[0].key, confirmPosts[0].key, runNextPosts[0].key, attemptPosts[0].key]).size === 5, `${currentScenario}: independent write intents were reused.`);
      if (currentScenario === "confirm-conflict") assert(confirmPosts[0].key !== confirmPosts[1].key, "confirm-conflict: explicit re-confirm did not create a new intent.");
      if (currentScenario === "success") {
        assert(JSON.stringify(confirmPosts[0].body) === JSON.stringify({ expectedVersion: 1, confirmedItemIds: ["item-synthetic-1"], corrections: [] }), "success: confirm body was not exact.");
        assert(JSON.stringify(runNextPosts[0].body) === JSON.stringify({ expectedVersion: 2 }) && JSON.stringify(runNextPosts[1].body) === JSON.stringify({ expectedVersion: 4 }), "success: run-next versions were not authoritative.");
        assert(JSON.stringify(attemptPosts[0].body) === JSON.stringify({ expectedVersion: 3, probeId: "probe-1", selectedChoiceId: "choice-a" }), "success: probe body was not exact.");
      }
      await page.close();
    }
    reset("success");
    await mkdir(screenshots, { recursive: true });
    for (const [width, height] of [[1440, 900], [1366, 768]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await visitReview(page);
      await page.getByRole("checkbox", { name: "我确认这一项题干" }).check();
      await page.getByRole("button", { name: "确认识别内容", exact: true }).click();
      await page.locator('[data-review-state="confirmed"]').waitFor();
      await page.getByRole("button", { name: "开始找原因", exact: true }).click();
      await page.locator('[data-review-state="hypotheses"]').waitFor({ timeout: 40_000 });
      const overflow = await page.evaluate(() => ({ horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth, marker: document.body.innerText.includes("不会保存为正式学习记录") }));
      assert(!overflow.horizontal && overflow.marker, `screenshot ${width}x${height}: overflow or boundary marker missing.`);
      await page.screenshot({ path: resolve(screenshots, `same-case-review-hypotheses-${width}x${height}.png`) });
      await page.close();
    }
  } finally { await browser.close(); }
} finally {
  if (webServer.exitCode === null) webServer.kill();
  await webServerExit;
  await new Promise(resolveClose => fixtureServer.close(resolveClose));
  await writeFile(nextEnvPath, nextEnvBefore);
  await Promise.all(generatedAgentFiles.map(path => agentFileExisted.get(path) ? undefined : rm(path, { force: true })));
}
