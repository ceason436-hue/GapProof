import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(webRoot, "screenshots");
const port = process.env.SCREENSHOT_PORT ?? "3100";
const origin = `http://127.0.0.1:${port}`;
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const server = spawn(process.execPath, [nextBin, "start", "-p", port], {
  cwd: webRoot,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
server.stdout.on("data", chunk => { serverOutput += chunk; });
server.stderr.on("data", chunk => { serverOutput += chunk; });

for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    if ((await fetch(`${origin}/student/today`)).ok) break;
  } catch {}
  if (attempt === 39) throw new Error(`Production server did not start.\n${serverOutput}`);
  await new Promise(resolveWait => setTimeout(resolveWait, 500));
}

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const [width, height] of [[1440, 900], [1366, 768]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(`${origin}/student/today`, { waitUntil: "networkidle" });

    const before = await page.evaluate(() => {
      const rect = selector => {
        const value = document.querySelector(selector)?.getBoundingClientRect();
        if (!value) throw new Error(`Missing ${selector}`);
        return { top: value.top, left: value.left, bottom: value.bottom };
      };
      return { topbar: rect(".topbar"), brand: rect(".brand-crop"), sidebar: rect(".sidebar") };
    });

    await page.locator(".content").evaluate(element => { element.scrollTop = 400; });
    await page.waitForTimeout(100);
    const audit = await page.evaluate(() => {
      const rect = selector => {
        const value = document.querySelector(selector)?.getBoundingClientRect();
        if (!value) throw new Error(`Missing ${selector}`);
        return { top: value.top, left: value.left, bottom: value.bottom };
      };
      const content = document.querySelector(".content");
      if (!(content instanceof HTMLElement)) throw new Error("Missing .content");
      return {
        windowScrollY: window.scrollY,
        contentScrollTop: content.scrollTop,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        topbar: rect(".topbar"),
        brand: rect(".brand-crop"),
        sidebar: rect(".sidebar"),
        cta: rect(".fixed-action"),
        undersizedTargets: [...document.querySelectorAll("a, button, summary")]
          .filter(element => element.getClientRects().length > 0)
          .map(element => ({ label: element.getAttribute("aria-label") ?? element.textContent?.trim(), height: element.getBoundingClientRect().height }))
          .filter(target => target.height < 44),
      };
    });

    const stable = (a, b) => Math.abs(a.top - b.top) < 0.1 && Math.abs(a.left - b.left) < 0.1;
    if (audit.windowScrollY !== 0 || audit.contentScrollTop <= 0 || audit.horizontalOverflow || audit.undersizedTargets.length ||
        !stable(before.topbar, audit.topbar) || !stable(before.brand, audit.brand) || !stable(before.sidebar, audit.sidebar) ||
        audit.cta.bottom > height || audit.cta.top < 0) {
      throw new Error(`${width}x${height} shell regression: ${JSON.stringify({ before, audit })}`);
    }

    await page.locator(".content").evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: resolve(output, `today-${width}x${height}.png`) });
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}
