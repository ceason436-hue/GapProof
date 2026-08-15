import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(webRoot, "screenshots");
const webPort = process.env.REAL_SCREENSHOT_PORT ?? "3101";
const webOrigin = `http://127.0.0.1:${webPort}`;
const studentId = "0198b111-1111-7000-8000-000000000003";
const caseId = "0198b111-1111-7000-8000-000000000002";
const scheduledFor = "2026-08-16T00:00:00.000Z";
const dueAt = "2026-08-16T12:00:00.000Z";

const taskBase = (id, status, title) => ({
  id,
  caseId,
  studentId,
  status,
  title,
  rationale: "请按步骤完成并确认选择。",
  estimatedMinutes: 6,
  scheduledFor,
  dueAt,
  completedAt: null,
});

const guided = {
  ...taskBase("0198b111-1111-7000-8000-000000000011", "ready", "修复现在完成时的动词形式"),
  taskType: "guided_intervention",
  steps: [
    { id: "synthetic-step-explain", kind: "explain", title: "看一个例子", content: "比较动作发生时间与助动词结构。" },
    { id: "synthetic-step-practice", kind: "guided_practice", title: "做一道确认小题", content: "完成本步并确认你的选择。" },
  ],
};
const retestItem = cycle => ({
  id: `synthetic-${cycle}-item`,
  prompt: "Mina has ___ three notes this week.",
  choices: [{ id: "choice-wrote", label: "wrote" }, { id: "choice-written", label: "written" }],
});
const scheduledD1 = {
  ...taskBase("0198b111-1111-7000-8000-000000000012", "scheduled", "下一次延迟检查"),
  taskType: "d1_retest",
  item: retestItem("d1"),
};
const scheduledD7 = {
  ...taskBase("0198b111-1111-7000-8000-000000000013", "scheduled", "后续保持检查"),
  taskType: "d7_retest",
  item: retestItem("d7"),
};
const currentD7 = {
  ...taskBase("0198b111-1111-7000-8000-000000000014", "ready", "第 7 天新题检查"),
  taskType: "d7_retest",
  item: retestItem("d7-current"),
};
const currentD1 = {
  ...taskBase("0198b111-1111-7000-8000-000000000015", "ready", "明日复习新题检查"),
  taskType: "d1_retest",
  item: retestItem("d1-current"),
};

const overview = ({ hasStartedJourney = true, completedToday = 0, weeklyGoal = null, pendingConfirmationCount = 0, recentProgress = [], nextCheck = null } = {}) => ({
  hasStartedJourney,
  activityDays: Array.from({ length: 7 }, (_, index) => ({
    localDate: `2026-08-${String(10 + index).padStart(2, "0")}`,
    completedTaskCount: index === 6 ? completedToday : 0,
  })),
  weeklyGoal,
  pendingConfirmationCount,
  recentProgress,
  nextCheck,
});

const fixtures = {
  "current-guided": {
    studentId,
    timeZone: "Asia/Tokyo",
    currentTaskId: guided.id,
    tasks: [guided, scheduledD1, scheduledD7],
    overview: overview({
      weeklyGoal: { targetDays: 5, completedDays: 2 },
      pendingConfirmationCount: 1,
      recentProgress: [{
        eventId: "0198b111-1111-7000-8000-000000000030",
        caseId,
        kind: "practice_completed",
        occurredAt: "2026-08-15T01:00:00.000Z",
      }],
      nextCheck: {
        taskId: scheduledD1.id,
        taskType: "d1_retest",
        title: scheduledD1.title,
        scheduledFor: scheduledD1.scheduledFor,
        dueAt: scheduledD1.dueAt,
        estimatedMinutes: scheduledD1.estimatedMinutes,
      },
    }),
  },
  "scheduled-null": {
    studentId,
    timeZone: "America/New_York",
    currentTaskId: null,
    tasks: [scheduledD1, scheduledD7],
    overview: overview({ nextCheck: null }),
  },
  "current-d7": {
    studentId,
    timeZone: "Asia/Tokyo",
    currentTaskId: currentD7.id,
    tasks: [currentD7, scheduledD1],
    overview: overview({
      weeklyGoal: { targetDays: 5, completedDays: 2 },
      pendingConfirmationCount: 1,
      nextCheck: {
        taskId: scheduledD1.id,
        taskType: "d1_retest",
        title: scheduledD1.title,
        scheduledFor: scheduledD1.scheduledFor,
        dueAt: scheduledD1.dueAt,
        estimatedMinutes: scheduledD1.estimatedMinutes,
      },
    }),
  },
  "current-d1": {
    studentId,
    timeZone: "Asia/Tokyo",
    currentTaskId: currentD1.id,
    tasks: [currentD1, scheduledD7],
    overview: overview({
      weeklyGoal: { targetDays: 5, completedDays: 2 },
      nextCheck: {
        taskId: scheduledD7.id,
        taskType: "d7_retest",
        title: scheduledD7.title,
        scheduledFor: scheduledD7.scheduledFor,
        dueAt: scheduledD7.dueAt,
        estimatedMinutes: scheduledD7.estimatedMinutes,
      },
    }),
  },
  completed: {
    studentId,
    timeZone: "Asia/Shanghai",
    currentTaskId: null,
    tasks: [],
    overview: overview({
      completedToday: 2,
      weeklyGoal: { targetDays: 5, completedDays: 2 },
      recentProgress: [{
        eventId: "0198b111-1111-7000-8000-000000000031",
        caseId,
        kind: "practice_completed",
        occurredAt: "2026-08-16T01:00:00.000Z",
      }],
    }),
  },
  empty: {
    studentId,
    timeZone: "Europe/Paris",
    currentTaskId: null,
    tasks: [],
    overview: overview({ hasStartedJourney: false }),
  },
};

let fixtureName = "current-guided";
const fixtureServer = createServer((request, response) => {
  if (request.url === `/v1/students/${studentId}/today`) {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      data: fixtures[fixtureName],
      requestId: `synthetic-${fixtureName}-request`,
      traceId: `synthetic-${fixtureName}-trace`,
    }));
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
const webServer = spawn(process.execPath, [nextBin, "start", "-p", webPort], {
  cwd: webRoot,
  windowsHide: true,
  env: {
    ...process.env,
    GAPPROOF_API_ORIGIN: fixtureOrigin,
    GAPPROOF_DEMO_STUDENT_ID: studentId,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
webServer.stdout.on("data", chunk => { serverOutput += chunk; });
webServer.stderr.on("data", chunk => { serverOutput += chunk; });

try {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`${webOrigin}/student/today`)).ok &&
          (await fetch(`${webOrigin}/student/today?source=api`)).ok) break;
    } catch {}
    if (attempt === 39) throw new Error(`Production server did not start.\n${serverOutput}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 500));
  }

  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const [state, fixture] of Object.entries(fixtures)) {
      fixtureName = state;
      for (const [width, height] of [[1440, 900], [1366, 768], [768, 1024], [390, 844]]) {
        const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
        if (state === "current-guided" || state === "current-d1" || state === "current-d7") {
          await page.route(`${webOrigin}/api/v1/cases/${caseId}`, async route => {
            if (route.request().method() !== "GET") {
              await route.fallback();
              return;
            }
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                data: {
                  id: caseId,
                  studentId,
                  state: state === "current-d7" ? "d7_scheduled" : state === "current-d1" ? "d1_scheduled" : "intervention_active",
                  stateVersion: 4,
                  title: "Synthetic guided case",
                  simulation: true,
                  synthetic: true,
                  updatedAt: "2026-08-15T01:00:00.000Z",
                },
                requestId: "synthetic-current-guided-case-request",
                traceId: "synthetic-current-guided-case-trace",
              }),
            });
          });
        }
        await page.goto(`${webOrigin}/student/today`, { waitUntil: "networkidle" });

        const expectedSelector = state === "current-guided"
          ? '[data-current-task-type="guided_intervention"]'
          : state === "current-d1"
            ? '[data-current-task-type="d1_retest"]'
          : state === "current-d7"
            ? '[data-current-task-type="d7_retest"]'
          : state === "scheduled-null"
            ? '[data-current-task="none"]'
            : state === "completed"
              ? '[data-completed-today="true"]'
              : '[data-first-use-today]';
        await page.locator(expectedSelector).waitFor();
        if (state === "current-guided") await page.locator('[data-guided-task-state="idle"]').waitFor();
        if (state === "current-d1") await page.locator('[data-d1-attempt-state="idle"]').waitFor();
        if (state === "current-d7") await page.locator('[data-d7-attempt-state="idle"]').waitFor();
        if (state !== "empty" && await page.locator("[data-today-overview]").count() !== 1) {
          throw new Error(`Default Today entry did not render the API overview for ${state}.`);
        }
        if (state === "empty") {
          if (await page.getByRole("link", { name: "上传错题或作业" }).count() !== 1) throw new Error("First-use upload entry missing.");
          if (await page.getByRole("link", { name: "没有材料，先做 3 道题" }).count() !== 1) throw new Error("First-use quick-check entry missing.");
        }
        if (state === "scheduled-null" && await page.locator('[data-task-status="scheduled"]').count() !== 2) {
          throw new Error("Scheduled-only fixture did not render both D1 and D7 tasks.");
        }
        if (state !== "empty") {
          const structure = await page.locator("[data-live-today-dashboard]").evaluate(dashboard => {
            const grid = dashboard.querySelector(":scope > .today-grid");
            const main = grid?.querySelector(":scope > .main-column");
            const right = grid?.querySelector(":scope > .right-column");
            const hero = main?.querySelector(":scope > .hero-card");
            const overviewPanel = main?.querySelector(":scope > .overview");
            const footprint = right?.querySelector(":scope > .footprint");
            const continuation = right?.querySelector(":scope > .continue");
            const nextCheck = right?.querySelector(":scope > .next-check");
            if (!(grid instanceof HTMLElement) || !(main instanceof HTMLElement) || !(right instanceof HTMLElement) ||
                !(hero instanceof HTMLElement) || !(overviewPanel instanceof HTMLElement) ||
                !(footprint instanceof HTMLElement) || !(continuation instanceof HTMLElement) || !(nextCheck instanceof HTMLElement)) {
              return null;
            }
            const gridStyle = getComputedStyle(grid);
            const heroStyle = getComputedStyle(hero);
            const heroRect = hero.getBoundingClientRect();
            const footprintRect = footprint.getBoundingClientRect();
            return {
              gridDisplay: gridStyle.display,
              gridColumns: gridStyle.gridTemplateColumns,
              gridGap: gridStyle.columnGap,
              heroBackground: heroStyle.backgroundColor,
              alignedColumns: Math.abs(heroRect.top - footprintRect.top) < 1,
              rightFollowsMain: footprintRect.top >= main.getBoundingClientRect().bottom,
              mainChildren: [...main.children].map(element => element.className),
              rightChildren: [...right.children].map(element => element.className),
            };
          });
          const desktopStructureValid = width > 900
            ? structure?.gridDisplay === "grid" && structure.gridGap === "40px" && structure.alignedColumns &&
              structure.gridColumns.trim().split(/\s+/).length === 2
            : width > 640
              ? structure?.gridDisplay === "grid" && structure.rightFollowsMain && structure.gridColumns.trim().split(/\s+/).length === 1
              : structure?.gridDisplay === "block" && structure.rightFollowsMain;
          if (!structure || !desktopStructureValid ||
              structure.heroBackground !== "rgb(28, 28, 30)" ||
              structure.mainChildren.length !== 2 || !structure.mainChildren[0].includes("hero-card") || !structure.mainChildren[1].includes("overview") ||
              structure.rightChildren.length !== 3 || !structure.rightChildren[0].includes("footprint") ||
              !structure.rightChildren[1].includes("continue") || structure.rightChildren[2] !== "next-check") {
            throw new Error(`${state} ${width}x${height} did not preserve the frozen Today skeleton: ${JSON.stringify(structure)}`);
          }
        }

        const audit = await page.evaluate(() => {
          const content = document.querySelector(".content");
          const topbar = document.querySelector(".topbar")?.getBoundingClientRect();
          const sidebar = document.querySelector(".sidebar")?.getBoundingClientRect();
          if (!(content instanceof HTMLElement) || !topbar || !sidebar) throw new Error("Missing fixed shell.");
          const before = { topbarTop: topbar.top, sidebarTop: sidebar.top };
          content.scrollTop = 400;
          const afterTopbar = document.querySelector(".topbar")?.getBoundingClientRect();
          const afterSidebar = document.querySelector(".sidebar")?.getBoundingClientRect();
          return {
            before,
            after: { topbarTop: afterTopbar?.top, sidebarTop: afterSidebar?.top },
            contentScrollTop: content.scrollTop,
            windowScrollY: window.scrollY,
            horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
            forms: document.querySelectorAll("form").length,
            attemptsLinks: document.querySelectorAll('a[href*="/attempts"]').length,
          };
        });
        if (audit.horizontalOverflow || audit.forms || audit.attemptsLinks ||
            audit.before.topbarTop !== audit.after.topbarTop || audit.before.sidebarTop !== audit.after.sidebarTop) {
          throw new Error(`${state} ${width}x${height} regression: ${JSON.stringify(audit)}`);
        }
        await page.locator(".content").evaluate(element => { element.scrollTop = 0; });
        await page.evaluate(() => {
          const banner = document.createElement("div");
          banner.textContent = "体验内容 · 不保存为正式学习记录";
          Object.assign(banner.style, {
            position: "fixed", right: "12px", bottom: "10px", zIndex: "99",
            padding: "6px 10px", borderRadius: "999px", background: "#111318",
            color: "white", font: "12px system-ui", boxShadow: "0 2px 8px rgba(0,0,0,.2)",
          });
          document.body.append(banner);
        });
        await page.screenshot({ path: resolve(output, `today-api-${state}-${width}x${height}.png`) });
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
} finally {
  webServer.kill();
  await new Promise(resolveClose => fixtureServer.close(resolveClose));
}
