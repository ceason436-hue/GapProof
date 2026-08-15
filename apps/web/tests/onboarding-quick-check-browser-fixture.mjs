import { spawn } from "node:child_process";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webPort = process.env.ONBOARDING_FIXTURE_WEB_PORT ?? "3110";
const webOrigin = `http://127.0.0.1:${webPort}`;
const studentId = "0198c111-1111-7000-8000-000000000001";
const nextEnvPath = resolve(webRoot, "next-env.d.ts");
const nextEnvBefore = await readFile(nextEnvPath);
const generated = [resolve(webRoot, "AGENTS.md"), resolve(webRoot, "CLAUDE.md")];
const existed = new Map(await Promise.all(generated.map(async path => { try { await access(path); return [path, true]; } catch { return [path, false]; } })));
const questions = [
  { itemId: "quick-check-participle-v1", prompt: "Mia has ___ the message to her teacher.", choices: [{ id: "choice-wrote", label: "wrote" }, { id: "choice-written", label: "written" }] },
  { itemId: "quick-check-past-v1", prompt: "They ___ to the museum yesterday.", choices: [{ id: "choice-go", label: "go" }, { id: "choice-went", label: "went" }] },
  { itemId: "quick-check-passive-v1", prompt: "The class poster ___ by Leo last week.", choices: [{ id: "choice-was-written", label: "was written" }, { id: "choice-wrote", label: "wrote" }] },
];
const envelope = data => ({ data, requestId: "fixture-request", traceId: "fixture-trace" });
let postMode = "success";
const posts = [];
const readJson = request => new Promise((resolveBody, rejectBody) => { const chunks = []; request.on("data", chunk => chunks.push(chunk)); request.on("end", () => resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8")))); request.on("error", rejectBody); });
const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.method === "GET" && request.url === `/v1/students/${studentId}/today`) {
    response.end(JSON.stringify(envelope({ studentId, timeZone: "Asia/Singapore", currentTaskId: null, tasks: [], overview: { hasStartedJourney: false, activityDays: Array.from({ length: 7 }, (_, index) => ({ localDate: `2026-08-${String(9 + index).padStart(2, "0")}`, completedTaskCount: 0 })), weeklyGoal: null, pendingConfirmationCount: 0, recentProgress: [], nextCheck: null } })));
    return;
  }
  if (request.method === "GET" && request.url === "/v1/quick-checks/synthetic") {
    response.end(JSON.stringify(envelope({ mode: "synthetic_demo", source: "original_fixture", estimatedMinutes: 3, questions })));
    return;
  }
  if (request.method === "POST" && request.url === "/v1/quick-checks/synthetic/attempts") {
    posts.push({ body: await readJson(request), key: request.headers["idempotency-key"] });
    if (postMode === "network_unknown") {
      request.socket.destroy();
      return;
    }
    if (postMode === "server_error") {
      response.statusCode = 503;
      response.end(JSON.stringify({ error: { code: "QUICK_CHECK_UNAVAILABLE", message: "Fixture failure", retryable: false }, requestId: "fixture-error", traceId: "fixture-error" }));
      return;
    }
    response.end(JSON.stringify(envelope({ mode: "synthetic_demo", source: "original_fixture", scoringMethod: "exact-choice-v1", correctCount: 3, totalCount: 3, finding: "mixed_review", summary: "三题规则化评分已完成。", recommendation: "如需建立学习记录，请上传材料并确认同一 Case。", learningRecordCreated: false, reportReady: false })));
    return;
  }
  response.statusCode = 404; response.end(JSON.stringify({ error: { code: "RESOURCE_NOT_FOUND", message: "fixture route", retryable: false }, requestId: "fixture-404", traceId: "fixture-404" }));
});
await new Promise((resolveListen, rejectListen) => { server.once("error", rejectListen); server.listen(0, "127.0.0.1", resolveListen); });
const address = server.address();
if (!address || typeof address === "string") throw new Error("Fixture port missing");
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const web = spawn(process.execPath, [nextBin, "dev", "-H", "127.0.0.1", "-p", webPort], { cwd: webRoot, windowsHide: true, env: { ...process.env, GAPPROOF_API_ORIGIN: `http://127.0.0.1:${address.port}`, GAPPROOF_DEMO_STUDENT_ID: studentId }, stdio: ["ignore", "pipe", "pipe"] });
let output = ""; web.stdout.on("data", chunk => { output += chunk; }); web.stderr.on("data", chunk => { output += chunk; });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
try {
  for (let attempt = 0; attempt < 40; attempt += 1) { try { if ((await fetch(`${webOrigin}/student/today`)).ok) break; } catch {} if (attempt === 39) throw new Error(`Web did not start\n${output}`); await new Promise(resolveWait => setTimeout(resolveWait, 250)); }
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${webOrigin}/student/today`, { waitUntil: "networkidle" });
    assert(await page.getByRole("heading", { name: "从第一次检查开始" }).count() === 1, "First-use Today did not render.");
    assert(await page.getByRole("link", { name: "上传错题或作业" }).count() === 1, "Upload entry missing.");
    await page.getByRole("link", { name: "没有材料，先做 3 道题" }).click();
    await page.locator("fieldset").first().waitFor();
    assert(await page.locator("fieldset").count() === 3, "Quick check did not render exactly three questions.");
    await page.getByLabel("written", { exact: true }).check(); await page.getByLabel("went", { exact: true }).check(); await page.getByLabel("was written", { exact: true }).check();
    await page.getByRole("button", { name: "提交 3 道题" }).dblclick();
    await page.locator("[data-quick-check-result]").waitFor();
    assert(await page.getByText("未创建 Case、未写学习记录、报告未开放。").count() === 1, "Stateless result boundary missing.");
    assert(posts.length === 1, `Double submit sent ${posts.length} POST requests.`);
    assert(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(posts[0]?.key ?? ""), "POST did not use UUIDv7 idempotency key.");
    assert(JSON.stringify(posts[0]?.body) === JSON.stringify({ answers: questions.map((question, index) => ({ itemId: question.itemId, selectedChoiceId: ["choice-written", "choice-went", "choice-was-written"][index] })) }), "POST body did not preserve the exact three choices.");

    postMode = "network_unknown";
    posts.length = 0;
    const unknownPage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await unknownPage.goto(`${webOrigin}/diagnose/quick-check`, { waitUntil: "networkidle" });
    await unknownPage.getByLabel("written", { exact: true }).check(); await unknownPage.getByLabel("went", { exact: true }).check(); await unknownPage.getByLabel("was written", { exact: true }).check();
    await unknownPage.getByRole("button", { name: "提交 3 道题" }).click();
    await unknownPage.locator('[data-quick-check-state="network_unknown"]').waitFor();
    assert(posts.length === 2, `NETWORK_UNKNOWN expected one safe retry, observed ${posts.length} POSTs.`);
    assert(posts.every(post => post.key === posts[0].key && JSON.stringify(post.body) === JSON.stringify(posts[0].body)), "NETWORK_UNKNOWN retry changed the intent key or body.");
    assert(await unknownPage.getByRole("button", { name: "提交 3 道题" }).isDisabled(), "NETWORK_UNKNOWN did not lock submission.");
    await unknownPage.close();

    postMode = "server_error";
    posts.length = 0;
    const retryPage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await retryPage.goto(`${webOrigin}/diagnose/quick-check`, { waitUntil: "networkidle" });
    await retryPage.getByLabel("written", { exact: true }).check(); await retryPage.getByLabel("went", { exact: true }).check(); await retryPage.getByLabel("was written", { exact: true }).check();
    await retryPage.getByRole("button", { name: "提交 3 道题" }).click();
    await retryPage.locator('[data-quick-check-state="error"]').waitFor();
    assert(await retryPage.getByRole("button", { name: "提交 3 道题" }).isEnabled(), "Explicit server failure did not preserve retry.");
    const failedKey = posts[0]?.key;
    postMode = "success";
    await retryPage.getByRole("button", { name: "提交 3 道题" }).click();
    await retryPage.locator("[data-quick-check-result]").waitFor();
    assert(posts.length === 2 && posts[1]?.key !== failedKey, "Explicit retry did not create one fresh intent.");
    await retryPage.close();
    for (const [name, heading] of [["7 日计划", "先有诊断证据，再安排下一步"], ["我的进步", "进步需要学习证据支持"], ["学习报告", "报告功能尚未开放"]]) { await page.getByRole("link", { name, exact: true }).first().click(); await page.getByRole("heading", { name: heading }).waitFor(); }
  } finally { await browser.close(); }
  console.log("Onboarding and synthetic quick-check browser fixture passed.");
} finally {
  web.kill(); server.close();
  await writeFile(nextEnvPath, nextEnvBefore);
  await Promise.all(generated.map(path => existed.get(path) ? Promise.resolve() : rm(path, { force: true })));
}
