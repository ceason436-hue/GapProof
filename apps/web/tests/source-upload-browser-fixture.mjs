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
const webPort = process.env.SOURCE_UPLOAD_FIXTURE_WEB_PORT ?? "3103";
const webOrigin = `http://127.0.0.1:${webPort}`;
const studentId = "0198c111-1111-7000-8000-000000000001";
const assetId = "0198c111-1111-7000-8000-000000000002";
const caseId = "0198c111-1111-7000-8000-000000000003";
const batchId = "0198c111-1111-7000-8000-000000000004";
const pageId = "0198c111-1111-7000-8000-000000000005";
const token = "fixture-upload-token-012345678901234567890123";
const bytes = await readFile(resolve(webRoot, "../../reference/stitch_gapproof_ai/logo.png"));
const sha256 = createHash("sha256").update(bytes).digest("hex");
const fileName = "fixture-wrong-answer.png";
const uploadPath = `/api/v1/source-assets/${assetId}/content`;
const backendUploadPath = `/v1/source-assets/${assetId}/content`;
const preparePath = `/api/v1/source-assets/${assetId}/commands/prepare`;
const backendPreparePath = `/v1/source-assets/${assetId}/commands/prepare`;
const batchPath = "/api/v1/ocr-batches";
const backendBatchPath = "/v1/ocr-batches";
const addPagePath = `/api/v1/ocr-batches/${batchId}/pages/uploads`;
const backendAddPagePath = `/v1/ocr-batches/${batchId}/pages/uploads`;
const startRecognitionPath = `/api/v1/ocr-batches/${batchId}/commands/start-recognition`;
const backendStartRecognitionPath = `/v1/ocr-batches/${batchId}/commands/start-recognition`;
const inspectionPath = `/api/v1/source-assets/${assetId}`;
const backendInspectionPath = `/v1/source-assets/${assetId}`;

const batchView = {
  batchId,
  caseId,
  status: "collecting",
  guardianConfirmed: false,
  version: 0,
  pages: [],
};
const addedPage = {
  page: { pageId, assetId, order: 1, status: "pending_upload", retryable: false, needsReview: false },
  upload: {
    method: "PUT",
    path: uploadPath,
    token,
    expiresAt: "2026-08-15T04:10:00.000Z",
    mimeType: "image/png",
    byteSize: bytes.length,
  },
};
const uploaded = {
  assetId,
  processingStatus: "uploaded",
  mimeType: "image/png",
  byteSize: bytes.length,
  sha256,
};

const quality = {
  status: "needs_confirmation",
  detectedMimeType: "image/png",
  width: 20,
  height: 20,
  reasons: ["low_resolution"],
  checkerVersion: "image-header-v1",
};
const passedQuality = {
  status: "passed",
  detectedMimeType: "image/png",
  width: 1200,
  height: 900,
  reasons: [],
  checkerVersion: "image-header-v1",
};
const startedRecognition = {
  batchId,
  caseId,
  status: "processing",
  processingNoticeAccepted: true,
};
const inspectionView = processingStatus => ({
  assetId,
  stage: "image_quality_check",
  processingStatus,
  mimeType: "image/png",
  byteSize: bytes.length,
  quality: processingStatus === "needs_confirmation" ? quality : processingStatus === "succeeded" ? passedQuality : null,
});
const statusSequences = {
  success: ["queued", "processing", "succeeded"],
  "low-resolution": ["queued", "processing", "needs_confirmation"],
  failed: ["queued", "processing", "failed"],
  retryable: ["queued", "processing", "retryable_error"],
  "get-network-unknown": ["queued", "processing", "succeeded"],
  timeout: ["processing"],
  cancel: ["processing"],
  "prepare-network-unknown": ["queued", "processing", "succeeded"],
  "prepare-processing": ["processing", "succeeded"],
  "prepare-final": ["succeeded"],
  "post-network-unknown": ["queued", "processing", "succeeded"],
  "put-network-unknown": ["queued", "processing", "succeeded"],
};

let scenario = "success";
let inspectionReads = 0;
const posts = [];
const batchPosts = [];
const preparePosts = [];
const startPosts = [];
const puts = [];
const gets = [];
const readBody = request => new Promise((resolveBody, rejectBody) => {
  const chunks = [];
  request.on("data", chunk => chunks.push(Buffer.from(chunk)));
  request.on("end", () => resolveBody(Buffer.concat(chunks)));
  request.on("error", rejectBody);
});
const envelope = data => ({ data, requestId: `fixture-${scenario}-request`, traceId: `fixture-${scenario}-trace` });
const json = (response, status, body) => {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
};

const fixtureServer = createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/v1/device-session") {
    response.setHeader("Set-Cookie", "gapproof_device=fixture-device-session; Path=/; HttpOnly; SameSite=Lax");
    json(response, 200, envelope({ authenticated: true, studentId, expiresAt: "2026-08-17T12:00:00.000Z" }));
    return;
  }
  if (request.method === "GET" && request.url === "/v1/device-session") {
    json(response, 200, envelope({ authenticated: true, studentId, expiresAt: "2026-08-17T12:00:00.000Z" }));
    return;
  }
  if (request.method === "GET" && request.url === "/v1/device-session/ocr-batches") {
    json(response, 200, envelope({ batches: [] }));
    return;
  }
  if (request.method === "POST" && request.url === backendBatchPath) {
    const body = await readBody(request);
    batchPosts.push({ body: JSON.parse(body.toString("utf8")), idempotencyKey: request.headers["idempotency-key"] });
    json(response, 200, envelope(batchView));
    return;
  }
  if (request.method === "POST" && request.url === backendAddPagePath) {
    const body = await readBody(request);
    posts.push({ body: JSON.parse(body.toString("utf8")), idempotencyKey: request.headers["idempotency-key"] });
    if (scenario === "post-network-unknown" && posts.length === 1) {
      request.socket.destroy();
      return;
    }
    json(response, 200, envelope(addedPage));
    return;
  }
  if (request.method === "PUT" && request.url === backendUploadPath) {
    const body = await readBody(request);
    puts.push({
      body,
      uploadToken: request.headers["x-gapproof-upload-token"],
      contentType: request.headers["content-type"],
    });
    if (scenario === "put-network-unknown" && puts.length === 1) {
      request.socket.destroy();
      return;
    }
    json(response, 200, envelope(uploaded));
    return;
  }
  if (request.method === "POST" && request.url === backendPreparePath) {
    const body = await readBody(request);
    preparePosts.push({ body: JSON.parse(body.toString("utf8")), idempotencyKey: request.headers["idempotency-key"] });
    if (scenario === "prepare-network-unknown" && preparePosts.length === 1) {
      request.socket.destroy();
      return;
    }
    const prepareResponse = scenario === "prepare-processing"
      ? inspectionView("processing")
      : scenario === "prepare-final"
        ? inspectionView("succeeded")
        : { assetId, stage: "image_quality_check", processingStatus: "queued" };
    json(response, 200, envelope(prepareResponse));
    return;
  }
  if (request.method === "POST" && request.url === backendStartRecognitionPath) {
    const body = await readBody(request);
    startPosts.push({ body: JSON.parse(body.toString("utf8")), idempotencyKey: request.headers["idempotency-key"] });
    if (scenario === "start-network-unknown") {
      request.socket.destroy();
      return;
    }
    if (scenario === "already-bound") {
      json(response, 409, {
        error: { code: "SOURCE_ASSET_ALREADY_BOUND", message: "Fixture asset is already bound.", retryable: false },
        requestId: `fixture-${scenario}-error`,
        traceId: `fixture-${scenario}-error-trace`,
      });
      return;
    }
    json(response, 200, envelope(startedRecognition));
    return;
  }
  if (request.method === "GET" && request.url === backendInspectionPath) {
    inspectionReads += 1;
    gets.push(request.url);
    if (scenario === "get-network-unknown" && inspectionReads === 1) {
      request.socket.destroy();
      return;
    }
    const sequence = statusSequences[scenario] ?? statusSequences.success;
    const status = sequence[Math.min(inspectionReads - 1, sequence.length - 1)];
    json(response, 200, envelope(inspectionView(status)));
    return;
  }
  json(response, 404, {
    error: { code: "RESOURCE_NOT_FOUND", message: "Fixture route not found.", retryable: false },
    requestId: "fixture-not-found-request",
    traceId: "fixture-not-found-trace",
  });
});
await new Promise((resolveListen, rejectListen) => {
  fixtureServer.once("error", rejectListen);
  fixtureServer.listen(0, "127.0.0.1", resolveListen);
});
const fixtureAddress = fixtureServer.address();
if (!fixtureAddress || typeof fixtureAddress === "string") throw new Error("Fixture server did not expose a port.");
const fixtureOrigin = `http://127.0.0.1:${fixtureAddress.port}`;

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const webServer = spawn(process.execPath, [nextBin, "dev", "-H", "127.0.0.1", "-p", webPort], {
  cwd: webRoot,
  windowsHide: true,
  env: {
    ...process.env,
    GAPPROOF_API_ORIGIN: fixtureOrigin,
    GAPPROOF_DEMO_STUDENT_ID: studentId,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const webServerExit = new Promise(resolveExit => webServer.once("exit", resolveExit));
let serverOutput = "";
webServer.stdout.on("data", chunk => { serverOutput += chunk; });
webServer.stderr.on("data", chunk => { serverOutput += chunk; });

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const choose = async page => {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator('label[for="source-upload-input"]').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: fileName, mimeType: "image/png", buffer: bytes });
};
const resetFixtureState = currentScenario => {
  scenario = currentScenario;
  inspectionReads = 0;
  batchPosts.length = 0;
  posts.length = 0;
  preparePosts.length = 0;
  startPosts.length = 0;
  puts.length = 0;
  gets.length = 0;
};
const visitAndInspect = async (page, expectedStatus, {
  expectedUploadPosts = 1,
  expectedUploadPuts = 1,
  expectedPreparePosts = 1,
  expectedGets = 1,
} = {}) => {
  await page.goto(`${webOrigin}/materials/new`, { waitUntil: "networkidle" });
  assert(await page.getByRole("heading", { name: "上传错题、作业或试卷" }).count() === 1, `Default materials page did not render the upload UI. body=${await page.locator("body").innerText()}`);
  assert(await page.getByText("真实上传会在后续阶段接入", { exact: false }).count() === 0, "Upload route still renders the F0 placeholder.");
  assert(await page.locator("[data-upload-picker]").count() === 1, "Upload picker was missing before a file was selected.");
  await choose(page);
  await page.locator('[data-page-status="waiting"]').waitFor({ timeout: 5_000 });
  assert(await page.locator('[data-page-status="waiting"]').count() === 1, "Selected image state was not visible before upload.");
  assert(await page.locator("[data-upload-picker]").count() === 0, "Large upload picker remained visible after selection.");
  assert(await page.getByText("已添加 1 张图片", { exact: true }).count() === 1, "Selected image count was not shown.");
  assert(await page.getByRole("button", { name: "继续添加", exact: true }).isEnabled(), "Continue-upload action was not available after selection.");
  assert(await page.getByText("替换", { exact: true }).count() === 1 && await page.getByRole("button", { name: "移除", exact: true }).count() === 1, "Replace/remove actions were not available after selection.");
  assert(!(await page.locator("body").innerText()).includes(fileName), "Local filename leaked into the rendered page.");
  await page.getByRole("button", { name: "上传并检查图片" }).click();
  try {
    await page.locator(`[data-page-status="${expectedStatus}"]`).waitFor({ timeout: 40_000 });
  } catch (error) {
    const statusText = await page.locator("[data-page-status]").getAttribute("data-page-status").catch(() => null);
    throw new Error(`Inspection UI did not reach ${expectedStatus}. scenario=${scenario}; status=${statusText}; batches=${batchPosts.length}; posts=${posts.length}; prepare=${preparePosts.length}; puts=${puts.length}; gets=${gets.length}; server=${serverOutput}`, { cause: error });
  }
  assert(batchPosts.length === 1, `${scenario}: expected one batch POST request, observed ${batchPosts.length}.`);
  assert(JSON.stringify(batchPosts[0].body) === JSON.stringify({ studentId }), `${scenario}: batch POST did not preserve the bound student.`);
  assert(uuidV7Pattern.test(batchPosts[0].idempotencyKey ?? ""), `${scenario}: batch intent did not use UUIDv7.`);
  assert(posts.length === expectedUploadPosts, `${scenario}: expected ${expectedUploadPosts} upload POST requests, observed ${posts.length}.`);
  assert(preparePosts.length === expectedPreparePosts, `${scenario}: expected ${expectedPreparePosts} prepare POST requests, observed ${preparePosts.length}.`);
  assert(puts.length === expectedUploadPuts, `${scenario}: expected ${expectedUploadPuts} PUT requests, observed ${puts.length}.`);
  assert(gets.length >= expectedGets, `${scenario}: expected at least ${expectedGets} inspection GET requests, observed ${gets.length}.`);
  if (expectedGets === 0) assert(gets.length === 0, `${scenario}: terminal prepare response triggered an unnecessary GET.`);
  assert(uuidV7Pattern.test(posts[0].idempotencyKey ?? ""), `${scenario}: upload intent did not use UUIDv7.`);
  assert(posts.every(post => post.idempotencyKey === posts[0].idempotencyKey), `${scenario}: upload POST retry changed the idempotency key.`);
  assert(posts.every(post => JSON.stringify(post.body) === JSON.stringify(posts[0].body)), `${scenario}: upload POST retry changed the JSON body.`);
  assert(preparePosts.every(post => uuidV7Pattern.test(post.idempotencyKey ?? "")), `${scenario}: prepare intent did not use UUIDv7.`);
  assert(preparePosts.every(post => post.idempotencyKey === preparePosts[0].idempotencyKey), `${scenario}: prepare retry changed the idempotency key.`);
  assert(preparePosts[0]?.idempotencyKey !== posts[0]?.idempotencyKey, `${scenario}: prepare reused the page-add intent key.`);
  assert(preparePosts.every(post => JSON.stringify(post.body) === "{}"), `${scenario}: prepare body was not the exact empty shared DTO.`);
  assert(browserPaths.every(path => path === "/api/v1/device-session" || path === "/api/v1/device-session/ocr-batches" || path === batchPath || path === addPagePath || path === uploadPath || path === preparePath || path === inspectionPath || path === startRecognitionPath), `${scenario}: browser did not use same-origin API paths: ${browserPaths.join(", ")}`);
  assert(puts.every(put => put.uploadToken === token), `${scenario}: PUT retry changed the short-lived upload token.`);
  assert(puts.every(put => put.contentType === puts[0].contentType && put.contentType === "image/png"), `${scenario}: PUT retry changed the original Content-Type.`);
  assert(puts.every(put => Buffer.compare(put.body, puts[0].body) === 0 && Buffer.compare(put.body, bytes) === 0), `${scenario}: PUT retry changed the original bytes.`);
  const visibleText = await page.locator("body").innerText();
  if (expectedStatus !== "passed") {
    assert(await page.getByRole("button", { name: "开始识别", exact: true }).count() === 0, `${scenario}: start recognition action appeared before a passed inspection.`);
  }
  assert(!visibleText.includes(token) && !visibleText.includes(assetId) && !visibleText.includes(fileName) && !visibleText.includes(sha256) && !visibleText.includes("objectKey"), "Inspection UI leaked upload internals or server facts.");
  assert(!visibleText.includes("置信度") && !visibleText.includes("provider") && !visibleText.includes("答案键"), "Inspection UI exposed unimplemented recognition details.");
  return visibleText;
};

let browserPaths = [];
try {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`${webOrigin}/materials/new`)).ok) break;
    } catch {}
    if (attempt === 39) throw new Error(`Web server did not start.\n${serverOutput}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 500));
  }

  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const [currentScenario, expectedStatus, expectedPreparePosts, expectedGets, expectedUploadPosts, expectedUploadPuts] of [
      ["success", "passed", 1, 1, 1, 1],
      ["low-resolution", "needs_confirmation", 1, 1, 1, 1],
      ["failed", "failed", 1, 1, 1, 1],
      ["retryable", "retryable_error", 1, 1, 1, 1],
      ["prepare-network-unknown", "passed", 2, 1, 1, 1],
      ["prepare-processing", "passed", 1, 1, 1, 1],
      ["prepare-final", "passed", 1, 0, 1, 1],
      ["get-network-unknown", "passed", 1, 1, 1, 1],
      ["post-network-unknown", "passed", 1, 1, 2, 1],
      ["put-network-unknown", "passed", 1, 1, 1, 2],
      ["start-network-unknown", "passed", 1, 1, 1, 1],
      ["already-bound", "passed", 1, 1, 1, 1],
    ]) {
      resetFixtureState(currentScenario);
      browserPaths = [];
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      page.on("request", request => {
        const path = new URL(request.url()).pathname;
        if (path.startsWith("/api/v1/")) browserPaths.push(path);
      });
      const visibleText = await visitAndInspect(page, expectedStatus, {
        expectedUploadPosts,
        expectedUploadPuts,
        expectedPreparePosts,
        expectedGets,
      });
      if (currentScenario === "success" || currentScenario === "start-network-unknown" || currentScenario === "already-bound") {
        const startButton = page.getByRole("button", { name: "开始识别", exact: true });
        const processingNotice = page.getByRole("checkbox", { name: /图片处理说明/ });
        const guardian = page.getByRole("checkbox", { name: /监护人确认/ });
        assert(await startButton.count() === 1 && await processingNotice.count() === 1 && await guardian.count() === 1, `${currentScenario}: passed inspection did not expose the guarded start action.`);
        assert(await startButton.isDisabled(), `${currentScenario}: start action was enabled before the required confirmations.`);
        await processingNotice.check();
        assert(await startButton.isDisabled(), `${currentScenario}: start action was enabled before guardian confirmation.`);
        await guardian.check();
        assert(await startButton.isEnabled(), `${currentScenario}: guardian confirmation did not enable start action.`);
        await startButton.click();
        await page.locator('[data-recognition-start-status="success"], [data-recognition-start-status="error"], [data-recognition-start-status="network_unknown"]').waitFor({ timeout: 10_000 });
        assert(startPosts.length >= 1, `${currentScenario}: no start-recognition POST was observed.`);
        assert(uuidV7Pattern.test(startPosts[0].idempotencyKey ?? ""), `${currentScenario}: start intent did not use UUIDv7.`);
        assert(startPosts[0].idempotencyKey !== posts[0].idempotencyKey, `${currentScenario}: start intent reused the upload intent key.`);
        assert(JSON.stringify(startPosts[0].body) === JSON.stringify({ guardianConfirmed: true, processingNoticeAccepted: true }), `${currentScenario}: start body was not the exact shared DTO.`);
        assert(browserPaths.includes(startRecognitionPath), `${currentScenario}: start-recognition request was not same-origin.`);
        const startText = await page.locator("body").innerText();
        assert(!startText.includes(assetId) && !startText.includes(startedRecognition.caseId) && !startText.includes(token) && !startText.includes(fileName) && !startText.includes(sha256) && !startText.includes("objectKey") && !startText.includes("jobId"), `${currentScenario}: start UI leaked internal or upload facts.`);
        if (currentScenario === "start-network-unknown") {
          assert(startText.includes("识别状态需要确认") && startText.includes("先读取最新状态"), `${currentScenario}: recovery boundary is missing.`);
        } else if (currentScenario === "success") {
          assert(startText.includes("识别正在处理") && startText.includes("识别完成后请先确认题目内容"), `${currentScenario}: persistent recognition boundary is missing.`);
        }
        assert(!startText.includes("不会读取你上传图片中的文字") && !startText.includes("synthetic"), `${currentScenario}: real OCR flow was mislabeled as synthetic.`);
        if (currentScenario === "success") {
          assert(startPosts.length === 1, "success: expected one start-recognition POST.");
          assert(startText.includes("识别正在处理") && startText.includes("查看识别进度"), "success: start success UI did not expose the truthful continuation action.");
        } else if (currentScenario === "start-network-unknown") {
          assert(startPosts.length === 2, "start-network-unknown: expected exactly one retry after the unknown result.");
          assert(startPosts.every(post => post.idempotencyKey === startPosts[0].idempotencyKey), "start-network-unknown: retry changed the start idempotency key.");
          assert(startPosts.every(post => JSON.stringify(post.body) === JSON.stringify(startPosts[0].body)), "start-network-unknown: retry changed the start JSON body.");
          assert(await page.locator("[data-recognition-unknown]").count() === 1, "start-network-unknown: recovery guidance was not shown.");
          await new Promise(resolveWait => setTimeout(resolveWait, 1_000));
          assert(startPosts.length === 2, "start-network-unknown: a third start POST was sent after the unknown result.");
        } else {
          assert(startPosts.length === 1, "already-bound: non-retryable failure unexpectedly retried.");
          assert(await guardian.isEnabled() && await startButton.isEnabled(), "already-bound: explicit retry controls were not preserved.");
          await startButton.click();
          await page.locator('[data-recognition-start-status="error"]').waitFor({ timeout: 10_000 });
          assert(startPosts.length === 2 && startPosts[1].idempotencyKey !== startPosts[0].idempotencyKey, "already-bound: explicit retry did not create a fresh start intent.");
        }
      }
      if (currentScenario === "success") {
        assert(visibleText.includes("所有图片均已通过基础检查"), "Success UI did not show the neutral inspection result.");
        await mkdir(screenshots, { recursive: true });
        for (const [width, height] of [[1440, 900], [1366, 768]]) {
          const screenshotPage = await browser.newPage({ viewport: { width, height } });
          resetFixtureState("success");
          await screenshotPage.goto(`${webOrigin}/materials/new`, { waitUntil: "networkidle" });
          await choose(screenshotPage);
          await screenshotPage.getByRole("button", { name: "上传并检查图片" }).click();
          await screenshotPage.locator('[data-page-status="passed"]').waitFor({ timeout: 40_000 });
          await screenshotPage.screenshot({ path: resolve(screenshots, `source-inspection-succeeded-${width}x${height}.png`) });
          await screenshotPage.getByRole("checkbox", { name: /图片处理说明/ }).check();
          await screenshotPage.getByRole("checkbox", { name: /监护人确认/ }).check();
          await screenshotPage.getByRole("button", { name: "开始识别", exact: true }).click();
          await screenshotPage.getByText("识别正在处理", { exact: true }).waitFor({ timeout: 10_000 });
          const viewportOverflow = await screenshotPage.evaluate(() => ({
            horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            marker: document.body.innerText.includes("识别完成后请先确认题目内容"),
          }));
          assert(!viewportOverflow.horizontal && viewportOverflow.marker, `success screenshot ${width}x${height}: overflow or real-recognition boundary missing.`);
          await screenshotPage.screenshot({ path: resolve(screenshots, `source-recognition-start-success-${width}x${height}.png`) });
          await screenshotPage.close();
        }
      }
      await page.close();
    }

    resetFixtureState("timeout");
    browserPaths = [];
    const timeoutPage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    timeoutPage.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/api/v1/")) browserPaths.push(path);
    });
    await visitAndInspect(timeoutPage, "retryable_error");
    await timeoutPage.close();

    resetFixtureState("cancel");
    browserPaths = [];
    const cancelPage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    cancelPage.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/api/v1/")) browserPaths.push(path);
    });
    await cancelPage.goto(`${webOrigin}/materials/new`, { waitUntil: "networkidle" });
    await choose(cancelPage);
    await cancelPage.getByRole("button", { name: "上传并检查图片" }).click();
    await cancelPage.locator('[data-page-status="checking"]').first().waitFor({ timeout: 10_000 });
    const getsBeforeHidden = gets.length;
    await cancelPage.goto("about:blank");
    await new Promise(resolveWait => setTimeout(resolveWait, 3_500));
    assert(gets.length === getsBeforeHidden, `cancel: page exit allowed another inspection GET (${getsBeforeHidden} before, ${gets.length} after).`);
    await cancelPage.close();

    for (const invalid of [
      { name: "document.pdf", mimeType: "application/pdf", buffer: Buffer.from("not an accepted image") },
      { name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) },
    ]) {
      resetFixtureState("success");
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      await page.goto(`${webOrigin}/materials/new`, { waitUntil: "networkidle" });
      const chooserPromise = page.waitForEvent("filechooser");
      await page.locator('label[for="source-upload-input"]').click();
      const chooser = await chooserPromise;
      await chooser.setFiles(invalid);
      await page.locator('[data-page-status="failed"]').waitFor();
      assert(batchPosts.length === 0 && posts.length === 0 && preparePosts.length === 0 && puts.length === 0 && gets.length === 0, "Invalid MIME/size sent a network request.");
      await page.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  if (webServer.exitCode === null) webServer.kill();
  await webServerExit;
  await new Promise(resolveClose => fixtureServer.close(resolveClose));
  await writeFile(nextEnvPath, nextEnvBefore);
  await Promise.all(generatedAgentFiles.map(path => agentFileExisted.get(path) ? undefined : rm(path, { force: true })));
}
