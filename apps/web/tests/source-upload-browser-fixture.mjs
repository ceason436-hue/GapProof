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
const token = "fixture-upload-token-012345678901234567890123";
const bytes = Buffer.from("synthetic browser upload bytes\n", "utf8");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const fileName = "fixture-wrong-answer.png";
const uploadPath = `/api/v1/source-assets/${assetId}/content`;
const backendUploadPath = `/v1/source-assets/${assetId}/content`;
const preparePath = `/api/v1/source-assets/${assetId}/commands/prepare`;
const backendPreparePath = `/v1/source-assets/${assetId}/commands/prepare`;
const inspectionPath = `/api/v1/source-assets/${assetId}`;
const backendInspectionPath = `/v1/source-assets/${assetId}`;

const initiated = {
  assetId,
  processingStatus: "pending_upload",
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
const preparePosts = [];
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
  if (request.method === "POST" && request.url === "/v1/source-assets/uploads") {
    const body = await readBody(request);
    posts.push({ body: JSON.parse(body.toString("utf8")), idempotencyKey: request.headers["idempotency-key"] });
    if (scenario === "post-network-unknown" && posts.length === 1) {
      request.socket.destroy();
      return;
    }
    json(response, 200, envelope(initiated));
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
  posts.length = 0;
  preparePosts.length = 0;
  puts.length = 0;
  gets.length = 0;
};
const visitAndInspect = async (page, expectedStatus, expectedPreparePosts = 1, expectedGets = 1) => {
  await page.goto(`${webOrigin}/materials/new`, { waitUntil: "networkidle" });
  assert(await page.getByRole("heading", { name: "上传一张错题或作业图片" }).count() === 1, "Default materials page did not render the upload UI.");
  assert(await page.getByText("真实上传会在后续阶段接入", { exact: false }).count() === 0, "Upload route still renders the F0 placeholder.");
  await choose(page);
  await page.getByRole("button", { name: "开始上传" }).click();
  try {
    await page.locator(`[data-upload-status="${expectedStatus}"]`).waitFor({ timeout: 40_000 });
  } catch (error) {
    const statusText = await page.locator("[data-upload-status]").textContent().catch(() => null);
    throw new Error(`Inspection UI did not reach ${expectedStatus}. scenario=${scenario}; status=${statusText}; posts=${posts.length}; prepare=${preparePosts.length}; puts=${puts.length}; gets=${gets.length}; server=${serverOutput}`, { cause: error });
  }
  assert(posts.length === 1, `Expected one upload POST, observed ${posts.length}.`);
  assert(preparePosts.length === expectedPreparePosts, `Expected ${expectedPreparePosts} prepare POST requests, observed ${preparePosts.length}.`);
  assert(puts.length === 1, `Expected one PUT request, observed ${puts.length}.`);
  assert(gets.length >= expectedGets, `Expected at least ${expectedGets} inspection GET requests, observed ${gets.length}.`);
  if (expectedGets === 0) assert(gets.length === 0, "Terminal prepare response triggered an unnecessary GET.");
  assert(uuidV7Pattern.test(posts[0].idempotencyKey ?? ""), "Upload intent did not use UUIDv7.");
  assert(preparePosts.every(post => post.idempotencyKey === posts[0].idempotencyKey), "Prepare changed the upload intent idempotency key.");
  assert(preparePosts.every(post => JSON.stringify(post.body) === "{}"), "Prepare body was not the exact empty shared DTO.");
  assert(browserPaths.every(path => path === "/api/v1/source-assets/uploads" || path === uploadPath || path === preparePath || path === inspectionPath), "Browser did not use same-origin API paths.");
  assert(puts.every(put => put.uploadToken === token), "PUT did not use the short-lived upload token.");
  assert(puts.every(put => put.contentType === "image/png"), "PUT changed the original Content-Type.");
  assert(puts.every(put => Buffer.compare(put.body, bytes) === 0), "PUT changed the original bytes.");
  const visibleText = await page.locator("body").innerText();
  assert(!visibleText.includes(token) && !visibleText.includes(assetId) && !visibleText.includes(fileName) && !visibleText.includes(sha256) && !visibleText.includes("objectKey"), "Inspection UI leaked upload internals or server facts.");
  assert(!visibleText.includes("OCR") && !visibleText.includes("置信度"), "Inspection UI exposed unimplemented OCR details.");
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
    for (const [currentScenario, expectedStatus, expectedPreparePosts, expectedGets] of [
      ["success", "succeeded", 1],
      ["low-resolution", "needs_confirmation", 1],
      ["failed", "failed", 1],
      ["retryable", "retryable_error", 1],
      ["prepare-network-unknown", "succeeded", 2],
      ["prepare-processing", "succeeded", 1, 1],
      ["prepare-final", "succeeded", 1, 0],
      ["get-network-unknown", "succeeded", 1],
      ["post-network-unknown", "succeeded", 1],
      ["put-network-unknown", "succeeded", 1],
    ]) {
      resetFixtureState(currentScenario);
      browserPaths = [];
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      page.on("request", request => {
        const path = new URL(request.url()).pathname;
        if (path.startsWith("/api/v1/")) browserPaths.push(path);
      });
      const visibleText = await visitAndInspect(page, expectedStatus, expectedPreparePosts, expectedGets ?? 1);
      if (currentScenario === "success") {
        assert(visibleText.includes("图片基础检查通过，识别尚未开始"), "Success UI did not show the neutral inspection result.");
        await mkdir(screenshots, { recursive: true });
        for (const [width, height] of [[1440, 900], [1366, 768]]) {
          const screenshotPage = await browser.newPage({ viewport: { width, height } });
          resetFixtureState("success");
          await screenshotPage.goto(`${webOrigin}/materials/new`, { waitUntil: "networkidle" });
          await choose(screenshotPage);
          await screenshotPage.getByRole("button", { name: "开始上传" }).click();
          await screenshotPage.locator('[data-upload-status="succeeded"]').waitFor({ timeout: 40_000 });
          await screenshotPage.evaluate(() => {
            const banner = document.createElement("div");
            banner.textContent = "受控 Fixture · 合成 bytes";
            Object.assign(banner.style, {
              position: "fixed", right: "12px", bottom: "10px", zIndex: "99",
              padding: "6px 10px", borderRadius: "999px", background: "#111318",
              color: "white", font: "12px system-ui",
            });
            document.body.append(banner);
          });
          await screenshotPage.screenshot({ path: resolve(screenshots, `source-inspection-succeeded-${width}x${height}.png`) });
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
    await visitAndInspect(timeoutPage, "timeout", 1);
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
    await cancelPage.getByRole("button", { name: "开始上传" }).click();
    await cancelPage.locator('[data-upload-status="queued"]').waitFor({ timeout: 10_000 });
    await cancelPage.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await cancelPage.locator('[data-upload-status="timeout"]').waitFor({ timeout: 5_000 });
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
      await page.locator('[data-upload-status="error"]').waitFor();
      assert(posts.length === 0 && preparePosts.length === 0 && puts.length === 0 && gets.length === 0, "Invalid MIME/size sent a network request.");
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
