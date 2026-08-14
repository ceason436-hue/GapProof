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

let scenario = "success";
const posts = [];
const puts = [];
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
const visitAndUpload = async (page, expectedPosts = 1, expectedPuts = 1) => {
  await page.goto(`${webOrigin}/materials/new`, { waitUntil: "networkidle" });
  assert(await page.getByRole("heading", { name: "上传一张错题或作业图片" }).count() === 1, "Default materials page did not render the upload UI.");
  assert(await page.getByText("真实上传会在后续阶段接入", { exact: false }).count() === 0, "Upload route still renders the F0 placeholder.");
  await choose(page);
  await page.getByRole("button", { name: "开始上传" }).click();
  try {
    await page.locator("[data-upload-success]").waitFor();
  } catch (error) {
    const statusText = await page.locator("[data-upload-status]").textContent().catch(() => null);
    throw new Error(`Upload UI did not reach success. scenario=${scenario}; status=${statusText}; posts=${posts.length}; puts=${puts.length}; server=${serverOutput}`, { cause: error });
  }
  assert(posts.length === expectedPosts, `Expected ${expectedPosts} POST requests, observed ${posts.length}.`);
  assert(puts.length === expectedPuts, `Expected ${expectedPuts} PUT requests, observed ${puts.length}.`);
  assert(uuidV7Pattern.test(posts[0].idempotencyKey ?? ""), "Upload intent did not use UUIDv7.");
  assert(JSON.stringify(posts[0].body) === JSON.stringify({
    studentId,
    caseId: null,
    fileName,
    mimeType: "image/png",
    byteSize: bytes.length,
    sha256,
  }), "POST body did not match the shared upload contract.");
  assert(posts.every(post => post.idempotencyKey === posts[0].idempotencyKey), "POST retry changed the idempotency key.");
  assert(browserPaths.every(path => path === "/api/v1/source-assets/uploads" || path === `/api/v1/source-assets/${assetId}/content`), "Browser did not use same-origin API paths.");
  assert(puts.every(put => put.uploadToken === token), "PUT did not use the short-lived upload token.");
  assert(puts.every(put => put.contentType === "image/png"), "PUT changed the original Content-Type.");
  assert(puts.every(put => Buffer.compare(put.body, bytes) === 0), "PUT changed the original bytes.");
  const visibleText = await page.locator("body").innerText();
  assert(visibleText.includes("上传完成，识别尚未开始"), "Success UI did not show the neutral upload result.");
  assert(!visibleText.includes(token) && !visibleText.includes(assetId) && !visibleText.includes(fileName) && !visibleText.includes("objectKey"), "Success UI leaked upload internals or server filename.");
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
    for (const currentScenario of ["success", "post-network-unknown", "put-network-unknown"]) {
      scenario = currentScenario;
      posts.length = 0;
      puts.length = 0;
      browserPaths = [];
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      page.on("request", request => {
        if (request.method() === "POST" || request.method() === "PUT") browserPaths.push(new URL(request.url()).pathname);
      });
      await visitAndUpload(page, currentScenario === "post-network-unknown" ? 2 : 1, currentScenario === "put-network-unknown" ? 2 : 1);
      if (currentScenario === "success") {
        await mkdir(screenshots, { recursive: true });
        for (const [width, height] of [[1440, 900], [1366, 768]]) {
          const screenshotPage = await browser.newPage({ viewport: { width, height } });
          await screenshotPage.goto(`${webOrigin}/materials/new`, { waitUntil: "networkidle" });
          await choose(screenshotPage);
          await screenshotPage.getByRole("button", { name: "开始上传" }).click();
          await screenshotPage.locator("[data-upload-success]").waitFor();
          await screenshotPage.evaluate(() => {
            const banner = document.createElement("div");
            banner.textContent = "受控上传 Fixture · 合成 bytes";
            Object.assign(banner.style, {
              position: "fixed", right: "12px", bottom: "10px", zIndex: "99",
              padding: "6px 10px", borderRadius: "999px", background: "#111318",
              color: "white", font: "12px system-ui",
            });
            document.body.append(banner);
          });
          await screenshotPage.screenshot({ path: resolve(screenshots, `source-upload-success-${width}x${height}.png`) });
          await screenshotPage.close();
        }
      }
      await page.close();
    }

    for (const invalid of [
      { name: "document.pdf", mimeType: "application/pdf", buffer: Buffer.from("not an accepted image") },
      { name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) },
    ]) {
      scenario = "invalid";
      posts.length = 0;
      puts.length = 0;
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      await page.goto(`${webOrigin}/materials/new`, { waitUntil: "networkidle" });
      const chooserPromise = page.waitForEvent("filechooser");
      await page.locator('label[for="source-upload-input"]').click();
      const chooser = await chooserPromise;
      await chooser.setFiles(invalid);
      await page.locator('[data-upload-status="error"]').waitFor();
      assert(posts.length === 0 && puts.length === 0, "Invalid MIME/size sent a network request.");
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
