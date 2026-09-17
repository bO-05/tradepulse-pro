import { createRequire } from "module";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const SITE = "https://brainy-skunk-440.convex.site";
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EVIDENCE_DIR = path.resolve("doc/tradepulse audits/outputs/evidence");
const PROJECT_PREFIX = "QA-REM-qa3-ui-coerced-"; // owned by QA-3

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOG = [];
const log = (...p) => { const l = p.join(" "); LOG.push(l); console.log(l); };
const events = [];
const shot = (page, name) => page.screenshot({ path: path.join(EVIDENCE_DIR, `remediation-qa3-${name}.png`) });

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--window-size=1440,900"],
  defaultViewport: { width: 1440, height: 900 },
});

try {
  const page = await browser.newPage();
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) events.push(`console.${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on("pageerror", (e) => events.push(`pageerror: ${String(e && e.message).slice(0, 300)}`));
  page.on("response", (r) => { if (r.status() >= 400) events.push(`http${r.status()}: ${r.url()}`); });

  await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(10000);

  const picked = await page.evaluate((prefix) => {
    const sel = document.querySelector("select");
    if (!sel) return null;
    const opt = Array.from(sel.options).find((o) => o.textContent.includes(prefix));
    if (!opt) return { error: "QA-REM project option not found", options: Array.from(sel.options).map((o) => o.textContent).slice(0, 20) };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(sel, opt.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { selected: opt.textContent };
  }, PROJECT_PREFIX);
  log(`PROJECT SELECT: ${JSON.stringify(picked)}`);
  await sleep(4000);

  const opened = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").includes("60s Judge Dock"));
    if (!b) return false;
    b.click();
    return true;
  });
  log(`DOCK opened=${opened}`);
  await sleep(1500);
  await shot(page, "12-dock-open");

  const targetPkg = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll("span")).find((s) => (s.textContent || "").includes(" - "));
    return el ? el.textContent : null;
  });
  log(`DOCK target package: ${JSON.stringify(targetPkg)}`);

  const clicked = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").includes("Run Full Autonomous Procurement Lifecycle"));
    if (!b) return false;
    b.click();
    return true;
  });
  log(`RUN FULL CYCLE clicked=${clicked}`);

  let result = null;
  const start = Date.now();
  while (Date.now() - start < 120000) {
    await sleep(3000);
    result = await page.evaluate(() => {
      const t = document.body.innerText;
      const i = t.indexOf("Full Autonomous Lifecycle Complete");
      if (i >= 0) return t.slice(i, i + 400);
      const j = t.indexOf("Lifecycle simulation failed");
      if (j >= 0) return t.slice(j, j + 300);
      const k = t.indexOf("Executing Full Autonomous Procurement Loop");
      return k >= 0 ? "__RUNNING__" : null;
    });
    if (result && result !== "__RUNNING__") break;
  }
  log(`RUN RESULT after ${Math.round((Date.now() - start) / 1000)}s: ${JSON.stringify(result)}`);
  await shot(page, "13-dock-result");
} catch (err) {
  log(`FATAL: ${String(err && err.stack ? err.stack : err)}`);
} finally {
  await browser.close();
}

fs.writeFileSync(
  path.join(EVIDENCE_DIR, "remediation-qa3-dock-probe.txt"),
  ["=== QA-3 60s JUDGE DOCK FULL-CYCLE PROBE ===", `Site: ${SITE}`, `UTC: ${new Date().toISOString()}`, `Project prefix: ${PROJECT_PREFIX}`, "", ...LOG, "", "--- EVENTS ---", ...events].join("\n"),
  "utf8"
);
console.log(`Evidence written: remediation-qa3-dock-probe.txt (${events.length} events)`);