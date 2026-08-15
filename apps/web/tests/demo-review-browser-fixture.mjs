import { spawn } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
const webPort = process.env.DEMO_REVIEW_FIXTURE_WEB_PORT ?? "3104";
const webOrigin = `http://127.0.0.1:${webPort}`;
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const webServer = spawn(process.execPath, [nextBin, "dev", "-H", "127.0.0.1", "-p", webPort], {
  cwd: webRoot,
  windowsHide: true,
  env: { ...process.env },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
webServer.stdout.on("data", chunk => { serverOutput += chunk; });
webServer.stderr.on("data", chunk => { serverOutput += chunk; });
const webServerExit = new Promise(resolveExit => webServer.once("exit", resolveExit));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

try {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`${webOrigin}/materials/demo/review`)).ok) break;
    } catch {}
    if (attempt === 39) throw new Error(`Web server did not start.\n${serverOutput}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 500));
  }

  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const apiRequests = [];
    page.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/api/v1/")) apiRequests.push(path);
    });
    await page.goto(`${webOrigin}/materials/demo/review`, { waitUntil: "networkidle" });
    assert(await page.locator('[data-demo-banner="synthetic"]').count() === 1, "Synthetic banner missing.");
    assert(await page.locator('[data-demo-prebuilt="true"]').count() === 1, "Prebuilt-result marker missing.");
    await page.locator("#demo-prompt").fill("Choose the correct past participle: She has ___ her homework.");
    await page.locator("#demo-student-answer").fill("written");
    await page.locator('[data-demo-confirm="true"]').click();
    await page.locator(".demo-review-confirmed").waitFor();
    const bodyText = await page.locator("body").innerText();
    assert(bodyText.includes("由用户确认"), "Local confirmation marker missing.");
    assert(apiRequests.length === 0, `Demo page made API requests: ${apiRequests.join(", ")}`);
    assert(!bodyText.includes("assetId") && !bodyText.includes("objectKey") && !bodyText.includes("token"), "Demo page leaked internal upload facts.");

    await page.goto(`${webOrigin}/materials/demo/review?state=empty`, { waitUntil: "networkidle" });
    assert(await page.locator('[data-review-state="empty"]').count() === 1, "Empty demo state missing.");
    assert(await page.locator('[data-demo-confirm="true"]').count() === 0, "Empty state exposed confirmation action.");
    await page.goto(`${webOrigin}/materials/demo/review?state=error`, { waitUntil: "networkidle" });
    assert(await page.locator('[data-review-state="error"]').count() === 1, "Error demo state missing.");
    assert(await page.locator('[data-review-state="error"] [role="alert"]').count() === 1, "Error state is not announced.");

    await mkdir(screenshots, { recursive: true });
    for (const [width, height] of [[1440, 900], [1366, 768]]) {
      const screenshotPage = await browser.newPage({ viewport: { width, height } });
      await screenshotPage.goto(`${webOrigin}/materials/demo/review`, { waitUntil: "networkidle" });
      await screenshotPage.evaluate(() => {
        const banner = document.createElement("div");
        banner.textContent = "受控 Fixture · 合成页面";
        Object.assign(banner.style, {
          position: "fixed", right: "12px", bottom: "10px", zIndex: "99",
          padding: "6px 10px", borderRadius: "999px", background: "#111318",
          color: "white", font: "12px system-ui",
        });
        document.body.append(banner);
      });
      await screenshotPage.screenshot({ path: resolve(screenshots, `demo-review-${width}x${height}.png`) });
      await screenshotPage.close();
    }
    await page.close();
  } finally {
    await browser.close();
  }
} finally {
  if (webServer.exitCode === null) webServer.kill();
  await webServerExit;
  await writeFile(nextEnvPath, nextEnvBefore);
  await Promise.all(generatedAgentFiles.map(path => agentFileExisted.get(path) ? undefined : rm(path, { force: true })));
}
