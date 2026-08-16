import { spawn } from "node:child_process";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webPort = process.env.PROFILE_SETUP_FIXTURE_WEB_PORT ?? "3115";
const webOrigin = `http://127.0.0.1:${webPort}`;
const fixtureDistDir = ".next-profile-setup-fixture";
const fixtureDistPath = resolve(webRoot, fixtureDistDir);
const studentId = "0198c111-1111-7000-8000-000000000015";
const nextEnvPath = resolve(webRoot, "next-env.d.ts");
const nextEnvBefore = await readFile(nextEnvPath);
const generated = [resolve(webRoot, "AGENTS.md"), resolve(webRoot, "CLAUDE.md")];
const existed = new Map(await Promise.all(generated.map(async path => { try { await access(path); return [path, true]; } catch { return [path, false]; } })));
const envelope = data => ({ data, requestId: "fixture-request", traceId: "fixture-trace" });
const savedProfile = { studentId, grade: "8", subject: "english", term: "first_term", region: "shanghai", learningState: "starting", timeZone: "Asia/Shanghai", version: 1, completed: true };
const emptyProfile = { studentId, grade: null, subject: null, term: null, region: null, learningState: null, timeZone: "Asia/Shanghai", version: 0, completed: false };
let profile = emptyProfile;
const puts = [];
const readJson = request => new Promise((resolveBody, rejectBody) => { const chunks = []; request.on("data", chunk => chunks.push(chunk)); request.on("end", () => resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8")))); request.on("error", rejectBody); });
const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.method === "POST" && request.url === "/v1/device-session") {
    response.setHeader("Set-Cookie", "gapproof_device=profile-setup-fixture; Path=/; HttpOnly; SameSite=Lax");
    response.end(JSON.stringify(envelope({ authenticated: true, studentId, expiresAt: "2026-08-17T12:00:00.000Z" })));
    return;
  }
  if (request.method === "GET" && request.url === "/v1/device-session") {
    response.end(JSON.stringify(envelope({ authenticated: true, studentId, expiresAt: "2026-08-17T12:00:00.000Z" })));
    return;
  }
  if (request.method === "GET" && request.url === "/v1/device-session/ocr-batches") {
    response.end(JSON.stringify(envelope({ batches: [] })));
    return;
  }
  if (request.method === "GET" && request.url === `/v1/students/${studentId}/today`) {
    response.end(JSON.stringify(envelope({
      studentId,
      timeZone: "Asia/Shanghai",
      currentTaskId: null,
      tasks: [],
      profile,
      overview: { hasStartedJourney: false, activityDays: Array.from({ length: 7 }, (_, index) => ({ localDate: `2026-08-${String(10 + index).padStart(2, "0")}`, completedTaskCount: 0 })), weeklyGoal: null, pendingConfirmationCount: 0, recentProgress: [], nextCheck: null },
    })));
    return;
  }
  if (request.method === "GET" && request.url === `/v1/students/${studentId}/profile`) {
    response.end(JSON.stringify(envelope(profile)));
    return;
  }
  if (request.method === "PUT" && request.url === `/v1/students/${studentId}/profile`) {
    puts.push({ body: await readJson(request), key: request.headers["idempotency-key"] });
    profile = savedProfile;
    response.end(JSON.stringify(envelope(profile)));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: { code: "RESOURCE_NOT_FOUND", message: "fixture route", retryable: false }, requestId: "fixture-404", traceId: "fixture-404" }));
});

await new Promise((resolveListen, rejectListen) => { server.once("error", rejectListen); server.listen(0, "127.0.0.1", resolveListen); });
const address = server.address();
if (!address || typeof address === "string") throw new Error("Fixture port missing");
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const web = spawn(process.execPath, [nextBin, "dev", "-H", "127.0.0.1", "-p", webPort], { cwd: webRoot, windowsHide: true, env: { ...process.env, GAPPROOF_API_ORIGIN: `http://127.0.0.1:${address.port}`, GAPPROOF_DEMO_STUDENT_ID: studentId, GAPPROOF_NEXT_DIST_DIR: fixtureDistDir }, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
web.stdout.on("data", chunk => { output += chunk; });
web.stderr.on("data", chunk => { output += chunk; });
const assert = (condition, message) => { if (!condition) throw new Error(message); };

try {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`${webOrigin}/student/today?source=api`)).ok) break; } catch {}
    if (attempt === 39) throw new Error(`Web did not start\n${output}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${webOrigin}/student/today?source=api`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "先确定你的学习范围" }).waitFor();
    assert(await page.locator("[data-profile-setup='today']").count() === 1, "First-time setup was not embedded in Today.");
    assert(await page.locator("html").evaluate(element => element.scrollWidth <= element.clientWidth), "Mobile setup has horizontal overflow.");
    assert(await page.getByText("0 / 5", { exact: true }).count() === 1, "Brand progress did not start at zero.");
    assert(await page.locator(".setup-heading").evaluate(element => getComputedStyle(element).backgroundColor === "rgb(28, 28, 30)"), "Setup did not use the dark Today hero language.");
    assert(await page.locator(".setup-progress-track i").evaluate(element => getComputedStyle(element).backgroundColor === "rgb(181, 248, 0)"), "Setup progress did not use the GapProof lime accent.");
    const confirm = page.getByRole("button", { name: "确认并开始" });
    assert(await confirm.isDisabled(), "Incomplete profile could be submitted.");
    const before = await confirm.boundingBox();
    assert(before && before.y >= 0 && before.y + before.height <= 844, "Confirmation action was not visible in the mobile viewport.");

    for (const choice of ["八年级", "英语", "上学期", "上海", "刚开始学"]) await page.getByRole("button", { name: choice, exact: true }).click();
    assert(await page.getByText("已完成选择", { exact: true }).count() === 1, "Completion state was not shown.");
    assert(await page.getByText("5 / 5", { exact: true }).count() === 1, "Brand progress did not reach five of five.");
    assert(await page.locator('[data-complete="true"]').count() === 5, "Every completed step was not visibly marked.");
    assert(await confirm.isEnabled(), "Complete profile did not enable confirmation.");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const after = await confirm.boundingBox();
    assert(after && after.y >= 0 && after.y + after.height <= 844, "Confirmation action was not kept reachable after scrolling.");
    await confirm.click();
    await page.getByRole("heading", { name: "从一次小检查开始" }).waitFor();

    assert(puts.length === 1, `Expected one profile save, observed ${puts.length}.`);
    assert(JSON.stringify(puts[0]?.body) === JSON.stringify({ expectedVersion: 0, grade: "8", subject: "english", term: "first_term", region: "shanghai", learningState: "starting" }), "Profile save body did not preserve the student's exact choices.");
    assert(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(puts[0]?.key ?? ""), "Profile save did not use a UUIDv7 idempotency key.");

    await page.goto(`${webOrigin}/setup`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "修改学习范围" }).waitFor();
    assert(await page.locator('[aria-pressed="true"]').count() === 5, "Saved choices were not restored on the settings page.");
    assert(await page.getByRole("link", { name: "取消并返回今日" }).count() === 1, "Settings page has no return action.");
  } finally {
    await browser.close();
  }
  console.log("Embedded profile setup browser fixture passed.");
} finally {
  if (web.exitCode === null) {
    web.kill();
    await new Promise(resolveExit => web.once("exit", resolveExit));
  }
  server.close();
  await writeFile(nextEnvPath, nextEnvBefore);
  await Promise.all(generated.map(path => existed.get(path) ? Promise.resolve() : rm(path, { force: true })));
  await rm(fixtureDistPath, { force: true, recursive: true });
}
