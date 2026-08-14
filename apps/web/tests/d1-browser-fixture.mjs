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
const webPort = process.env.D1_FIXTURE_WEB_PORT ?? "3102";
const webOrigin = `http://127.0.0.1:${webPort}`;
const studentId = "0198b111-1111-7000-8000-000000000003";
const caseId = "0198b111-1111-7000-8000-000000000002";
const taskId = "0198b111-1111-7000-8000-000000000012";
const itemId = "synthetic-d1-item-v1";
const selectedChoiceId = "choice-written";
const otherChoiceId = "choice-wrote";

const task = {
  id: taskId,
  caseId,
  studentId,
  taskType: "d1_retest",
  status: "ready",
  title: "D+1 延迟检查",
  rationale: "受控 HTTP fixture：只验证当前 ready D1 浏览器交互。",
  estimatedMinutes: 5,
  scheduledFor: "2026-08-16T00:00:00.000Z",
  dueAt: "2026-08-16T12:00:00.000Z",
  completedAt: null,
  item: {
    id: itemId,
    prompt: "Mina has ___ three notes this week.",
    choices: [
      { id: otherChoiceId, label: "wrote" },
      { id: selectedChoiceId, label: "written" },
    ],
  },
};

const today = {
  studentId,
  timeZone: "Asia/Shanghai",
  currentTaskId: taskId,
  tasks: [task],
};

const envelope = (data, suffix) => ({
  data,
  requestId: `synthetic-${suffix}-request`,
  traceId: `synthetic-${suffix}-trace`,
});

const attemptResult = (body, version = body.expectedVersion + 1) => ({
  attemptId: "0198b111-1111-7000-8000-000000000020",
  caseId,
  taskId,
  itemId: body.itemId,
  selectedChoiceId: body.selectedChoiceId,
  passed: true,
  scoringMethod: "exact-choice-v1",
  state: "d7_scheduled",
  stateVersion: version,
  completedTask: { ...task, status: "completed", completedAt: "2026-08-16T00:05:00.000Z" },
  scheduledRetest: {
    ...task,
    id: "0198b111-1111-7000-8000-000000000021",
    taskType: "d7_retest",
    status: "scheduled",
    title: "D+7 延迟检查",
    scheduledFor: "2026-08-22T00:05:00.000Z",
    dueAt: "2026-08-22T12:05:00.000Z",
    item: { ...task.item, id: "synthetic-d7-item-v1" },
  },
});

const readJsonBody = request => new Promise((resolveBody, rejectBody) => {
  let raw = "";
  request.setEncoding("utf8");
  request.on("data", chunk => { raw += chunk; });
  request.on("end", () => {
    try { resolveBody(JSON.parse(raw)); } catch (error) { rejectBody(error); }
  });
  request.on("error", rejectBody);
});

let scenario = "success";
let caseReads = 0;
const posts = [];

const fixtureServer = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === `/v1/students/${studentId}/today`) {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(envelope(today, `${scenario}-today`)));
    return;
  }
  if (request.method === "GET" && request.url === `/v1/cases/${caseId}`) {
    caseReads += 1;
    const stateVersion = scenario === "conflict" && posts.length > 0 ? 5 : 4;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(envelope({
      id: caseId,
      studentId,
      state: "d1_scheduled",
      stateVersion,
      title: "Synthetic D1 browser fixture",
      simulation: true,
      synthetic: true,
      updatedAt: "2026-08-16T00:00:00.000Z",
    }, `${scenario}-case-${caseReads}`)));
    return;
  }
  if (request.method === "POST" && request.url === `/v1/tasks/${taskId}/attempts`) {
    const body = await readJsonBody(request);
    posts.push({
      body,
      idempotencyKey: request.headers["idempotency-key"],
      contentType: request.headers["content-type"],
    });
    if (scenario === "network-unknown") {
      request.socket.destroy();
      return;
    }
    if (scenario === "conflict" && posts.length === 1) {
      response.writeHead(409, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        error: { code: "VERSION_CONFLICT", message: "Synthetic version conflict.", retryable: false },
        requestId: "synthetic-conflict-request",
        traceId: "synthetic-conflict-trace",
      }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(envelope(attemptResult(body), `${scenario}-attempt`)));
    return;
  }
  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({
    error: { code: "RESOURCE_NOT_FOUND", message: "Synthetic fixture route not found.", retryable: false },
    requestId: "synthetic-not-found-request",
    traceId: "synthetic-not-found-trace",
  }));
});

await new Promise((resolveListen, rejectListen) => {
  fixtureServer.once("error", rejectListen);
  fixtureServer.listen(0, "127.0.0.1", resolveListen);
});
const fixtureAddress = fixtureServer.address();
if (!fixtureAddress || typeof fixtureAddress === "string") throw new Error("Fixture server did not expose a TCP port.");
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

try {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`${webOrigin}/student/today?source=api`)).ok) break;
    } catch {}
    if (attempt === 39) throw new Error(`Production server did not start.\n${serverOutput}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 500));
  }

  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const currentScenario of ["success", "conflict", "network-unknown"]) {
      scenario = currentScenario;
      caseReads = 0;
      posts.length = 0;
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      const browserPostPaths = [];
      page.on("request", request => {
        if (request.method() === "POST") browserPostPaths.push(new URL(request.url()).pathname);
      });
      await page.goto(`${webOrigin}/student/today?source=api&fixture=${currentScenario}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(2_000);
      const initialAttemptState = await page.locator("[data-d1-attempt-state]").getAttribute("data-d1-attempt-state");
      if (initialAttemptState !== "idle") {
        throw new Error(`D1 Case initialization entered ${initialAttemptState}; caseReads=${caseReads}; page=${await page.locator("body").innerText()}\n${serverOutput}`);
      }
      await page.locator(`[data-current-task-type="d1_retest"] input[value="${selectedChoiceId}"]`).check();
      const caseReadsBeforeSubmit = caseReads;
      await page.getByRole("button", { name: "提交本次选择" }).click();

      if (currentScenario === "success") {
        await page.locator('[data-attempt-result="passed"]').waitFor();
        assert(posts.length === 1, `Success made ${posts.length} POST requests instead of one.`);
        assert(browserPostPaths[0] === `/api/v1/tasks/${taskId}/attempts`, "Browser did not POST through the same-origin /api path.");
        assert(uuidV7Pattern.test(posts[0].idempotencyKey ?? ""), "Idempotency-Key is not UUIDv7.");
        assert(JSON.stringify(posts[0].body) === JSON.stringify({ expectedVersion: 4, itemId, selectedChoiceId }), "Success POST body did not use the authoritative version/item/choice.");
        const resultText = await page.locator('[data-attempt-result="passed"]').innerText();
        assert(resultText.includes(selectedChoiceId), "Success UI did not echo the submitted choice.");
        assert(!resultText.includes(otherChoiceId), "Success UI echoed a choice that was not submitted.");
        assert(!/expectedChoiceId|answerKey|scoringMethod|exact-choice-v1/i.test(resultText), "Success UI leaked answer/scoring data.");
      } else if (currentScenario === "conflict") {
        await page.locator('[data-d1-attempt-state="conflict"]').waitFor();
        await page.waitForTimeout(300);
        assert(posts.length === 1, "VERSION_CONFLICT automatically repeated the write.");
        assert(caseReads === caseReadsBeforeSubmit + 1, `VERSION_CONFLICT expected exactly one Case refresh; observed ${caseReads - caseReadsBeforeSubmit}.`);
        assert(await page.getByRole("button", { name: "确认后重新提交" }).isEnabled(), "Conflict did not require an explicit new confirmation click.");
        await page.getByRole("button", { name: "确认后重新提交" }).click();
        await page.locator('[data-attempt-result="passed"]').waitFor();
        assert(posts.length === 2, "Explicit conflict confirmation did not create exactly one new POST.");
        assert(posts[1].body.expectedVersion === 5, "Conflict confirmation did not use the refreshed Case version.");
        assert(posts[0].idempotencyKey !== posts[1].idempotencyKey, "A newly confirmed intent reused the conflicted intent UUID.");
      } else {
        await page.locator('[data-d1-attempt-state="error"]').waitFor();
        assert(await page.getByText("结果未确认", { exact: false }).isVisible(), "Unknown result guidance was not shown.");
        assert(posts.length === 2, `Unknown result made ${posts.length} POST requests instead of two.`);
        assert(posts[0].idempotencyKey === posts[1].idempotencyKey, "Unknown-result retry changed the Idempotency-Key.");
        assert(JSON.stringify(posts[0].body) === JSON.stringify(posts[1].body), "Unknown-result retry changed the request body.");
        assert(uuidV7Pattern.test(posts[0].idempotencyKey ?? ""), "Unknown-result Idempotency-Key is not UUIDv7.");
        const selected = page.locator(`input[value="${selectedChoiceId}"]`);
        const other = page.locator(`input[value="${otherChoiceId}"]`);
        const submit = page.getByRole("button", { name: "请先确认任务状态" });
        assert(await selected.isDisabled() && await other.isDisabled() && await submit.isDisabled(), "Unknown result did not lock choice editing and submission.");
        await other.dispatchEvent("change");
        await submit.dispatchEvent("click");
        await page.waitForTimeout(300);
        assert(await selected.isChecked(), "Unknown-result lock allowed the selected choice to change.");
        assert(posts.length === 2, "Unknown-result lock allowed a third POST.");
        assert(new Set(posts.map(post => post.idempotencyKey)).size === 1, "Unknown-result lock created a new UUID.");
      }
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
