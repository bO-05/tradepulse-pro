// QA-11 item 3 final verify: backend + selector contain only the demo project; demo integrity intact.
// Usage: node scripts/qa-rem/qa11-final-verify.mjs
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";
import {
  EVIDENCE_DIR,
  BASE_URL,
  launchBrowser,
  attachDiagnostics,
  waitForAppReady,
  getSelectorState,
  shot,
  writeLog,
  summarizeDiagnostics,
  delay,
} from "./qa1-lib.mjs";

const BACKEND = "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(BACKEND);
const LOG = [];
const ev = (s) => { LOG.push(s); console.log(s); };
const checks = {};

const projects = await client.query("projects:listProjects", {});
ev(`backend projects: ${projects.length} [${projects.map((p) => `${p.title}${p.isDemoProject ? " (DEMO)" : ""}`).join(" | ")}]`);
checks.backendDemoOnly = projects.length === 1 && projects[0].isDemoProject ? "PASS" : "FAIL";
const demo = projects.find((p) => p.isDemoProject);
const pkgs = await client.query("tradePackages:listByProject", { projectId: demo._id });
const bids = await client.query("bids:listAllProjectBids", { projectId: demo._id });
const agreements = await client.query("agreements:listAgreements", { projectId: demo._id });
ev(`demo: title="${demo.title}" isDemoProject=${demo.isDemoProject} estBudget=${demo.estBudget} packages=${pkgs.length} bids=${bids.length} agreements=${agreements.length}`);
checks.demoTitle = demo.title === "The Domain Tower B - Commercial MEP" ? "PASS" : "FAIL";
checks.demoIsDemoProject = demo.isDemoProject === true ? "PASS" : "FAIL";
checks.demoPackageCountPositive = pkgs.length > 0 ? "PASS" : "FAIL";
checks.demoPackageCount3 = pkgs.length === 3 ? "PASS" : "FAIL";
checks.demoBids6 = bids.length === 6 ? "PASS" : "FAIL";
checks.demoAgreements1 = agreements.length === 1 ? "PASS" : "FAIL";

const { browser } = await launchBrowser();
const context = await browser.createBrowserContext();
const page = await context.newPage();
page.setDefaultTimeout(30000);
const diag = attachDiagnostics(page);
try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(2500);
  const sel = await getSelectorState(page);
  ev(`selector options=${sel.options.length}: ${JSON.stringify(sel.options)}`);
  ev(`selector selected="${sel.selectedText}"`);
  checks.selectorDemoOnly = sel.options.length === 1 ? "PASS" : "FAIL";
  checks.selectorDefaultDemo = sel.selectedText.includes("The Domain Tower B - Commercial MEP") ? "PASS" : "FAIL";
  await shot(page, "remediation-qa11-22-final-selector-demo-only.png");

  const diagSummary = summarizeDiagnostics(diag);
  ev(`diagnostics: ${JSON.stringify(diagSummary)}`);
  checks.noConsoleErrors = diagSummary.consoleErrors.length === 0 ? "PASS" : "FAIL";
  checks.noPageErrors = diagSummary.pageErrors.length === 0 ? "PASS" : "FAIL";
  checks.noFailedRequests = diagSummary.failedRequests.length === 0 ? "PASS" : "FAIL";

  const overall = Object.values(checks).every((v) => v === "PASS") ? "PASS" : "FAIL";
  ev(`FINAL VERIFY OVERALL: ${overall}`);
  ev(`CHECKS: ${JSON.stringify(checks)}`);
  console.log("JSON_RESULT " + JSON.stringify({ item: 3, result: overall, checks, projects: projects.map((p) => p.title), selector: sel, diagnostics: diagSummary }));
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa11-final-verify.json"), JSON.stringify({
    at: new Date().toISOString(), result: overall, checks,
    backend: { projectCount: projects.length, projects: projects.map((p) => ({ title: p.title, isDemoProject: p.isDemoProject })) },
    demo: { title: demo.title, isDemoProject: demo.isDemoProject, estBudget: demo.estBudget, packageCount: pkgs.length, packages: pkgs.map((p) => p.tradeName), bidCount: bids.length, agreementCount: agreements.length },
    selector: sel, diagnostics: diagSummary,
  }, null, 2), "utf8");
  writeLog("remediation-qa11-final-verify.txt", LOG);
  process.exitCode = overall === "PASS" ? 0 : 1;
} catch (err) {
  ev(`ERROR: ${err && err.stack ? err.stack : err}`);
  writeLog("remediation-qa11-final-verify.txt", LOG);
  process.exitCode = 1;
} finally {
  await browser.close();
}