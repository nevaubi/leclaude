// Headless smoke test: loads every top-level page, reports console errors, failed requests and render exceptions.
// Usage: node scripts/smoke.mjs http://localhost:3000
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let chromium;
for (const mod of ["playwright", "/opt/node22/lib/node_modules/playwright"]) { try { ({ chromium } = require(mod)); break; } catch {} }
if (!chromium) { console.error("playwright not found; npm i -D playwright"); process.exit(2); }

const base = process.argv[2] ?? "http://localhost:3000";
const routes = ["/", "/search", "/ediscovery", "/ediscovery?tab=depositions", "/ediscovery?tab=timeline", "/ediscovery?tab=people", "/ediscovery?tab=conflicts", "/ediscovery?tab=codes", "/workflows", "/office", "/library", "/settings"];
const dynamicFromApi = async (path, pick) => { try { const r = await fetch(base + path); const j = await r.json(); return pick(j) ?? []; } catch { return []; } };

const docs = await dynamicFromApi("/api/office/docs", (j) => (j.docs ?? []).slice(0, 12).map((d) => `/office/${d.kind}/${d.id}`));
const wfs = await dynamicFromApi("/api/workflows", (j) => (j.workflows ?? j.items ?? []).slice(0, 3).map((w) => `/workflows/${w.id}`));
const all = [...routes, ...docs, ...wfs];

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let failures = 0;
for (const route of all) {
  const errors = [];
  const onConsole = (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`); };
  const onPageError = (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`);
  const onFailed = (req) => { if (!/favicon|_next\/webpack-hmr|_rsc=/.test(req.url()) && req.failure()?.errorText !== "net::ERR_ABORTED") errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText ?? ""}`); };
  page.on("console", onConsole); page.on("pageerror", onPageError); page.on("requestfailed", onFailed);
  const t = Date.now();
  try {
    const res = await page.goto(base + route, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(800);
    const status = res?.status();
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 200));
    const broken = status && status >= 400;
    const filtered = errors.filter((e) => !/hydrat|Download the React DevTools/i.test(e));
    if (broken || filtered.length) failures++;
    console.log(`${broken || filtered.length ? "FAIL" : "ok  "} ${String(status).padEnd(3)} ${(Date.now() - t + "ms").padEnd(7)} ${route}${filtered.length ? "\n      " + filtered.slice(0, 4).join("\n      ") : ""}${broken ? "\n      " + bodyText.replace(/\s+/g, " ") : ""}`);
  } catch (e) {
    failures++;
    console.log(`FAIL --- ${route}: ${String(e).slice(0, 200)}`);
  } finally {
    page.off("console", onConsole); page.off("pageerror", onPageError); page.off("requestfailed", onFailed);
  }
}
await browser.close();
console.log(`\n${all.length - failures}/${all.length} routes clean`);
process.exit(failures ? 1 : 0);
