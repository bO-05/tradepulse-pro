import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";
import {
  BASE_URL,
  EVIDENCE_DIR,
  launchBrowser,
  attachDiagnostics,
  waitForAppReady,
  selectProjectByTitle,
  bodyText,
  shot,
  writeLog,
  summarizeDiagnostics,
  delay,
} from "./qa1-lib.mjs";

const log = [];
const say = (s) => {
  console.log(s);
  log.push(s);
};
const checks = {};

const url = "https://brainy-skunk-440.convex.cloud";
const backend = new ConvexHttpClient(url);
const title = `QA-REM-QA9-REGR-${Date.now()}`;
const projectId = await backend.mutation("projects:createProject", {
  title,
  location: "Austin, TX",
  projectType: "QA9 Regression Fixture",
  estBudget: 2000000,
  targetCompletionWeeks: 30,
  specDocumentText: "QA-9 regression sweep fixture (zero packages).",
  isDemoProject: false,
  generalContractorName: "QA9 Verification GC, LLC",
});
say(`QA9 REGRESSION NETWORK SWEEP at ${new Date().toISOString()}`);
say(`created regression fixture: "${title}" (${projectId})`);

const TABS = [
  "CSI Scoping",
  "Discovery",
  "Pre-Bid Q&A",
  "Bid Leveling",
  "Scope Clash",
  "Subcontracts",
  "Live Activity Audit",
  "Evals & Architecture",
];

const { browser } = await launchBrowser();
const context = await browser.createBrowserContext();
const page = await context.newPage();
const diag = attachDiagnostics(page);
const responses = [];
page.on("response", (r) => {
  responses.push({ status: r.status(), method: r.request().method(), url: r.url() });
});

const clickHeaderTab = (label) =>
  page.evaluate((needle) => {
    const header = document.querySelector("header");
    const btn = [...header.querySelectorAll("button")].find((b) => (b.textContent || "").includes(needle));
    if (!btn) return { ok: false };
    btn.click();
    return { ok: true };
  }, label);

const getStageValue = () =>
  page.$eval('select[aria-label="Navigate procurement stage"]', (el) => el.value).catch(() => null);

let sweepReports = [];
try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(1400);

  // snapshot counters BEFORE any deliberate fault injection
  const base = { console: diag.consoleLogs.length, pageErrors: diag.pageErrors.length, failed: diag.failedRequests.length, responses: responses.length };
  const sweepHttp = () => responses.slice(base.responses).filter((r) => r.status >= 400);
  const sweepFailed = () => diag.failedRequests.slice(base.failed);
  const sweepConsoleErrs = () => diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text);
  const sweepPageErrs = () => diag.pageErrors.slice(base.pageErrors);

  const sel = await selectProjectByTitle(page, title);
  say(`selected fixture: ${JSON.stringify(sel && { value: sel.value, text: sel.text })}`);
  await page.waitForFunction(() => document.body.innerText.includes("No Trade Packages Configured"), { timeout: 30000 });
  await delay(1000);

  for (const label of TABS) {
    const before = { console: diag.consoleLogs.length, pageErrors: diag.pageErrors.length, failed: diag.failedRequests.length, responses: responses.length };
    await clickHeaderTab(label);
    await delay(800);
    const stageNow = await getStageValue();
    const newConsoleErrs = diag.consoleLogs.slice(before.console).filter((l) => l.type === "error").map((l) => l.text);
    const newPageErrs = diag.pageErrors.slice(before.pageErrors);
    const newHttpErrs = responses.slice(before.responses).filter((r) => r.status >= 400).map((r) => `${r.status} ${r.method} ${r.url}`);
    const newFailed = diag.failedRequests.slice(before.failed);
    const shotPath = await shot(page, `remediation-qa9-14-regr-tab-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`);
    sweepReports.push({ label, stage: stageNow, newConsoleErrs, newPageErrs, newHttpErrs, newFailed, shot: shotPath });
    say(`  TAB ${label}: stage=${stageNow} consoleErrs=${JSON.stringify(newConsoleErrs)} http>=400=${JSON.stringify(newHttpErrs)} failed=${JSON.stringify(newFailed)}`);
  }

  await clickHeaderTab("CSI Scoping");
  await delay(900);
  const csiText = await bodyText(page);
  checks.csiEmptyPanel = csiText.includes("No Trade Packages Configured") ? "PASS" : "FAIL";
  checks.csiCreateCTA = (csiText.match(/Create Trade Package/g) || []).length >= 1 ? "PASS" : "FAIL";
  const csiStage = await getStageValue();

  const finalConsoleErrs = sweepConsoleErrs();
  const finalPageErrs = sweepPageErrs();
  const finalHttp = sweepHttp();
  const finalFailed = sweepFailed();
  checks.sweepZeroConsoleErrors = finalConsoleErrs.length === 0 && finalPageErrs.length === 0 ? "PASS" : "FAIL";
  checks.sweepZeroFailedRequests = finalFailed.length === 0 ? "PASS" : "FAIL";
  checks.sweepZeroHttpGE400 = finalHttp.length === 0 ? "PASS" : "FAIL";
  say(`\nCSI stage after revisit: ${csiStage}`);
  say(`sweep responses observed (after control): ${responses.length - base.responses}`);
  say(`sweep http>=400: ${JSON.stringify(finalHttp)}`);
  say(`sweep failedRequests: ${JSON.stringify(finalFailed)}`);
  say(`sweep consoleErrors: ${JSON.stringify(finalConsoleErrs)}`);
  say(`sweep pageErrors: ${JSON.stringify(finalPageErrs)}`);

  // --- negative control AFTER sweep: prove the response listener detects >=400 ---
  const controlUrl = `${BASE_URL}/api/qa9-nonexistent-${Date.now()}`;
  const control = await page.evaluate(async (u) => {
    try {
      const r = await fetch(u);
      return { status: r.status };
    } catch (e) {
      return { error: String(e) };
    }
  }, controlUrl);
  await delay(900);
  const controlSeen = responses.some((r) => r.url.includes("/api/qa9-nonexistent-") && r.status >= 400);
  say(`\nnegative control fetch (post-sweep): ${JSON.stringify(control)}; response listener captured it: ${controlSeen}`);
  checks.controlListenerWorks = controlSeen && control.status >= 400 ? "PASS" : "FAIL";
  say(`all responses this session: ${JSON.stringify(responses)}`);

  // full 8-tab pass condition per tab
  checks.eightTabsReached =
    sweepReports.length === 8 &&
    ["packages", "discovery", "qna", "leveling", "coordination", "contracts", "audit", "diagnostics"].every((s) =>
      sweepReports.some((r) => r.stage === s)
    )
      ? "PASS"
      : "FAIL";

  const overall = Object.values(checks).every((v) => v === "PASS") ? "PASS" : "FAIL";
  say(`\nCHECKS: ${JSON.stringify(checks, null, 2)}`);
  say(`REGRESSION NETWORK SWEEP RESULT: ${overall}`);

  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "remediation-qa9-network-results.json"),
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        fixture: { title, id: projectId },
        checks,
        overall,
        control: { request: controlUrl, result: control, observedByListener: controlSeen },
        responses,
        sweepReports,
        diagnostics: summarizeDiagnostics(diag),
      },
      null,
      2
    ),
    "utf8"
  );
  writeLog("remediation-qa9-06-network-log.txt", log);
  process.exitCode = overall === "PASS" ? 0 : 1;
} catch (err) {
  say(`ERROR: ${err && err.stack ? err.stack : err}`);
  say(`diagnostics at failure: ${JSON.stringify(summarizeDiagnostics(diag))}`);
  writeLog("remediation-qa9-06-network-log.txt", log);
  process.exitCode = 1;
} finally {
  await browser.close();
  try {
    await backend.mutation("projects:deleteProject", { projectId });
    const after = await backend.query("projects:listProjects", {});
    say(`cleanup: deleted regression fixture; remaining projects: ${after.length} -> ${after.map((p) => p.title).join(" | ")}`);
    writeLog("remediation-qa9-06-network-log.txt", log);
  } catch (err) {
    say(`cleanup FAILED for ${projectId}: ${err && err.message}`);
    writeLog("remediation-qa9-06-network-log.txt", log);
  }
}