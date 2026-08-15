import { spawn } from "node:child_process";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nextEnvPath = resolve(webRoot, "next-env.d.ts");
const nextEnvBefore = await readFile(nextEnvPath);
const generatedAgentFiles = [resolve(webRoot, "AGENTS.md"), resolve(webRoot, "CLAUDE.md")];
const agentFileExisted = new Map(await Promise.all(generatedAgentFiles.map(async path => {
  try { await access(path); return [path, true]; } catch { return [path, false]; }
})));
const webPort = process.env.GUIDED_TASK_FIXTURE_WEB_PORT ?? "3105";
const webOrigin = `http://127.0.0.1:${webPort}`;
const studentId = "0198b111-1111-7000-8000-000000000003";
const caseId = "0198b111-1111-7000-8000-000000000002";
const taskId = "0198b111-1111-7000-8000-000000000012";
const stepIds = ["step-1", "step-2", "step-3"];
const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const task = {
  id: taskId, caseId, studentId, taskType: "guided_intervention", status: "ready",
  title: "合成引导任务", rationale: "受控 HTTP fixture：完成全部步骤后由服务端安排 D+1。",
  estimatedMinutes: 8, scheduledFor: "2026-08-16T00:00:00.000Z", dueAt: "2026-08-16T12:00:00.000Z", completedAt: null,
  steps: stepIds.map((id, index) => ({ id, kind: ["explain", "worked_example", "guided_practice"][index], title: `步骤 ${index + 1}`, content: `完成第 ${index + 1} 步。` })),
};
const today = {
  studentId, timeZone: "Asia/Shanghai", currentTaskId: taskId, tasks: [task],
  overview: {
    activityDays: Array.from({ length: 7 }, (_, index) => ({ localDate: `2026-08-${String(10 + index).padStart(2, "0")}`, completedTaskCount: 0 })),
    weeklyGoal: null, pendingConfirmationCount: 0, recentProgress: [], nextCheck: null,
  },
};
const envelope = data => ({ data, requestId: `guided-${scenario}-request`, traceId: `guided-${scenario}-trace` });
const completion = (body, version) => ({
  caseId, state: "d1_scheduled", stateVersion: version,
  completedTask: { ...task, status: "completed", completedAt: "2026-08-16T00:05:00.000Z" },
  scheduledRetest: {
    id: "0198b111-1111-7000-8000-000000000021", caseId, studentId, taskType: "d1_retest", status: "scheduled",
    title: "D+1 延迟检查", rationale: "服务端安排", estimatedMinutes: 5,
    scheduledFor: "2026-08-17T00:05:00.000Z", dueAt: "2026-08-17T12:05:00.000Z", completedAt: null,
    item: { id: "d1-item", prompt: "新题", choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }] },
  },
});
const readJsonBody = request => new Promise((resolveBody, rejectBody) => {
  let raw = "";
  request.setEncoding("utf8");
  request.on("data", chunk => { raw += chunk; });
  request.on("end", () => { try { resolveBody(JSON.parse(raw)); } catch (error) { rejectBody(error); } });
  request.on("error", rejectBody);
});
let scenario = "success";
let caseReads = 0;
const posts = [];
const fixtureServer = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === `/v1/students/${studentId}/today`) {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(envelope(today)));
    return;
  }
  if (request.method === "GET" && request.url === `/v1/cases/${caseId}`) {
    caseReads += 1;
    const stateVersion = scenario === "conflict" && posts.length > 0 ? 5 : 4;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(envelope({ id: caseId, studentId, state: "intervention_active", stateVersion, title: "Synthetic guided fixture", simulation: true, synthetic: true, updatedAt: "2026-08-16T00:00:00.000Z" })));
    return;
  }
  if (request.method === "POST" && request.url === `/v1/tasks/${taskId}/submit`) {
    const body = await readJsonBody(request);
    posts.push({ body, idempotencyKey: request.headers["idempotency-key"] });
    if (scenario === "network-unknown") { request.socket.destroy(); return; }
    if (scenario === "conflict" && posts.length === 1) {
      response.writeHead(409, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { code: "VERSION_CONFLICT", message: "Synthetic version conflict.", retryable: false }, requestId: "guided-conflict-request", traceId: "guided-conflict-trace" }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(envelope(completion(body, body.expectedVersion + 1))));
    return;
  }
  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: { code: "RESOURCE_NOT_FOUND", message: "Fixture route not found.", retryable: false }, requestId: "guided-not-found", traceId: "guided-not-found" }));
});
await new Promise((resolveListen, rejectListen) => { fixtureServer.once("error", rejectListen); fixtureServer.listen(0, "127.0.0.1", resolveListen); });
const fixtureAddress = fixtureServer.address();
if (!fixtureAddress || typeof fixtureAddress === "string") throw new Error("Fixture server did not expose a port.");
const fixtureOrigin = `http://127.0.0.1:${fixtureAddress.port}`;
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const webServer = spawn(process.execPath, [nextBin, "dev", "-H", "127.0.0.1", "-p", webPort], {
  cwd: webRoot, windowsHide: true,
  env: { ...process.env, GAPPROOF_API_ORIGIN: fixtureOrigin, GAPPROOF_DEMO_STUDENT_ID: studentId },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
webServer.stdout.on("data", chunk => { serverOutput += chunk; });
webServer.stderr.on("data", chunk => { serverOutput += chunk; });
const webServerExit = new Promise(resolveExit => webServer.once("exit", resolveExit));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

try {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`${webOrigin}/student/today?source=api`)).ok) break; } catch {}
    if (attempt === 39) throw new Error(`Web server did not start.\n${serverOutput}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 500));
  }
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const currentScenario of ["success", "conflict", "network-unknown"]) {
      scenario = currentScenario; caseReads = 0; posts.length = 0;
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      await page.goto(`${webOrigin}/student/today?source=api&fixture=${currentScenario}`, { waitUntil: "networkidle" });
      await page.locator('[data-guided-task-state="idle"]').waitFor({ timeout: 10_000 });
      for (const stepId of stepIds) await page.locator(`input[type="checkbox"][value="${stepId}"]`).check();
      await page.getByRole("button", { name: "确认完成任务" }).click();
      if (currentScenario === "success") {
        await page.locator('[data-guided-result="success"]').waitFor();
        assert(posts.length === 1, `success: expected one POST, observed ${posts.length}.`);
        assert(caseReads === 2, `success: expected initial and pre-submit Case reads, observed ${caseReads}.`);
        assert(uuidV7Pattern.test(posts[0].idempotencyKey ?? ""), "success: Idempotency-Key was not UUIDv7.");
        assert(JSON.stringify(posts[0].body) === JSON.stringify({ expectedVersion: 4, completedStepIds: stepIds }), "success: request body was not exact.");
        const resultText = await page.locator('[data-guided-result="success"]').innerText();
        assert(resultText.includes("D+1 已安排") && resultText.includes("下一次检查"), "success: neutral D+1 result missing.");
        assert(!/已掌握|已修复|个性化/.test(resultText), "success: learning-effect claim leaked.");
      } else if (currentScenario === "conflict") {
        await page.locator('[data-guided-task-state="conflict"]').waitFor();
        assert(posts.length === 1, "conflict: write was automatically repeated.");
        assert(caseReads === 3, `conflict: expected initial, pre-submit and conflict-refresh Case reads, observed ${caseReads}.`);
        assert(await page.getByRole("button", { name: "确认后重新提交" }).isEnabled(), "conflict: explicit reconfirmation was not required.");
        await page.getByRole("button", { name: "确认后重新提交" }).click();
        await page.locator('[data-guided-result="success"]').waitFor();
        assert(posts.length === 2, "conflict: explicit reconfirmation did not create one second POST.");
        assert(posts[1].idempotencyKey !== posts[0].idempotencyKey, "conflict: explicit new intent reused the old key.");
        assert(posts[1].body.expectedVersion === 5, "conflict: refreshed Case version was not used.");
      } else {
        await page.locator('[data-guided-task-state="error"]').waitFor();
        await page.waitForTimeout(1_000);
        assert(posts.length === 2, `network-unknown: expected exactly two POSTs, observed ${posts.length}.`);
        assert(posts[1].idempotencyKey === posts[0].idempotencyKey, "network-unknown: retry changed the key.");
        assert(JSON.stringify(posts[1].body) === JSON.stringify(posts[0].body), "network-unknown: retry changed the body.");
        assert(await page.getByRole("link", { name: "请刷新今日" }).count() === 1, "network-unknown: submit was not locked behind a refresh link.");
      }
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
