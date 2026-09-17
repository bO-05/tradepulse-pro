import { ConvexHttpClient } from "convex/browser";
import { launchBrowser, attachDiagnostics, waitForAppReady, clickButtonByText, setInputValue, shot, getSelectorState, selectProjectByTitle, writeLog } from "./qa1-lib.mjs";
import { setTimeout as delay } from "node:timers/promises";

const client = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const title = `QA-REM-JD-LIVE-${Date.now()}`;
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const { browser } = await launchBrowser();
const page = await browser.newPage();
const diag = attachDiagnostics(page);

await page.goto("https://brainy-skunk-440.convex.site", { waitUntil: "domcontentloaded", timeout: 60000 });
await waitForAppReady(page);
say("app ready");

// 1) Create an empty project through the UI
await clickButtonByText(page, "New Project");
await delay(800);
await setInputValue(page, 'input[placeholder*="Austin Innovation"]', title);
await page.evaluate(() => {
  const nums = [...document.querySelectorAll('input[type="number"]')];
  const set = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  if (nums[0]) set(nums[0], 3500000);
  if (nums[1]) set(nums[1], 40);
});
await clickButtonByText(page, "Create Commercial Project");
await delay(4000);
await shot(page, "remediation-jd-live-01-created.png");

const created = (await client.query("projects:listProjects", {})).find((p) => p.title === title);
say(`backend project: ${created ? created._id : "NOT FOUND"}`);

// 2) Open Judge Dock and run full cycle on the empty project
await clickButtonByText(page, "60s Judge Dock");
await delay(1200);
const run = await clickButtonByText(page, "Full Autonomous");
say(`run cycle button: ${JSON.stringify(run)}`);

let resultText = "";
const start = Date.now();
while (Date.now() - start < 60000) {
  await delay(2000);
  const t = await page.evaluate(() => document.body.innerText);
  const i = t.indexOf("Full Autonomous Lifecycle Complete");
  if (i >= 0) { resultText = t.slice(i, i + 300); break; }
  const j = t.indexOf("Lifecycle simulation failed");
  if (j >= 0) { resultText = t.slice(j, j + 300); break; }
}
say(`dock result: ${JSON.stringify(resultText.slice(0, 220))}`);
await shot(page, "remediation-jd-live-02-dock-result.png");

// 3) Backend truth for the empty project after the dock run
const pkgs = created ? await client.query("tradePackages:listByProject", { projectId: created._id }) : [];
const logs = created ? await client.query("auditLogs:listRecentLogs", { projectId: created._id, limit: 50 }) : [];
say(`backend packages after dock: ${pkgs.length}`);
say(`backend audit events after dock: ${logs.length}`);
const jdOk = pkgs.length > 0;
say(`JD-A RESULT: ${jdOk ? "PASS (dock writes persisted on empty project)" : "FAIL (false success persists)"}`);

// 4) Selection persistence across reload (SEL-A)
await page.reload({ waitUntil: "domcontentloaded" });
await waitForAppReady(page);
await delay(1500);
const sel = await getSelectorState(page);
say(`after reload selected: ${JSON.stringify(sel?.selectedText)} expected title: ${title}`);
const selOk = Boolean(sel && sel.selectedText && sel.selectedText.includes(title));
say(`SEL-A RESULT: ${selOk ? "PASS (selection durable across reload)" : "FAIL (selection not durable)"}`);
await shot(page, "remediation-jd-live-03-reload-selection.png");

const diagSummary = {
  consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text),
  pageErrors: diag.pageErrors,
  failedRequests: diag.failedRequests,
};
say(`diagnostics: ${JSON.stringify(diagSummary)}`);
writeLog("remediation-jd-live-log.txt", log);
await browser.close();

if (!jdOk || !selOk) process.exitCode = 1;