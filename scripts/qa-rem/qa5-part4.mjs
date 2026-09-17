import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import {
  BASE_URL,
  EVIDENCE_DIR,
  launchBrowser,
  shot,
  waitForAppReady,
  getSelectorState,
  selectProjectByTitle,
  delay,
} from "./qa1-lib.mjs";
import {
  makeLog,
  loadState,
  saveState,
  dismissDemoTour,
  clickStage,
  clickVisibleButton,
  waitFor,
} from "./qa5-lib.mjs";

const state = loadState();
const PROJECT_TITLE = state.projectTitle;
const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";

const { say, write } = makeLog("remediation-qa5-part4-log.txt");
say(`=== QA-5 PART 4 (Rows 9-11: scope clash, audit stream, diagnostics eval) ===`);
say(`SITE: ${BASE_URL}`);
say(`UTC START: ${new Date().toISOString()}`);
say(`PROJECT: ${PROJECT_TITLE}`);

const consoleEvents = [];
const pageErrors = [];
const failedRequests = [];
const httpErrors = [];
const results = {};
let currentRow = "row9";
const step = (row, msg, observed) => {
  say(`[${row}] ${msg}`);
  if (observed !== undefined) say(`[${row}]   observed: ${typeof observed === "string" ? observed : JSON.stringify(observed)}`);
};

const { browser, executablePath } = await launchBrowser();
say(`EXECUTABLE: ${executablePath}`);
const page = await browser.newPage();
page.on("console", (m) => consoleEvents.push({ type: m.type(), text: m.text(), at: Date.now() }));
page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));
page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${r.url()} :: ${r.failure() ? r.failure().errorText : "?"}`));
page.on("response", (res) => {
  if (res.status() >= 400) httpErrors.push(`${res.request().method()} ${res.url()} -> ${res.status()}`);
});
const client = new ConvexHttpClient(BACKEND);
let projectId = null;

const clashProbe = () =>
  page.evaluate(() => {
    const t = document.body.innerText;
    return {
      doubleBuyCount: (t.match(/Redundant Double-Buy Detected|Credit Deducted & Leveled/g) || []).length,
      scopeVoidCount: (t.match(/Critical Scope Void Detected|Scope Assigned & Covered/g) || []).length,
      deductButtons: [...document.querySelectorAll("button")].filter((b) => /1-Click Deduct Credit/.test(b.textContent || "")).map((b) => (b.textContent || "").trim()),
      assignButtons: [...document.querySelectorAll("button")].filter((b) => /^Assign to/.test((b.textContent || "").trim())).map((b) => (b.textContent || "").trim()),
      deductedText: (t.match(/Credit Deducted & Leveled/g) || []).length,
      assignedText: (t.match(/Scope Assigned & Covered/g) || []).length,
      exposure: (t.match(/Unassigned Scope Voids[\s\S]{0,80}/) || [])[0] || null,
    };
  });

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await dismissDemoTour(page);
  const sel = await getSelectorState(page);
  if (!(sel && sel.selectedText && sel.selectedText.includes(PROJECT_TITLE))) {
    await selectProjectByTitle(page, PROJECT_TITLE);
    await delay(1500);
  }
  const projects = await client.query("projects:listProjects", {});
  projectId = projects.find((p) => p.title === PROJECT_TITLE)?._id || null;
  step("row9", "backend projectId", projectId);

  // ================= ROW 9: scope clash =================
  await clickStage(page, "Scope Clash");
  await waitFor(page, () => document.body.innerText.includes("Cross-Trade Scope Clash"), 15000, 500);
  await delay(2000);
  const beforeScan = await clashProbe();
  step("row9", "clash view before scan", beforeScan);
  await shot(page, "remediation-qa5-p4-01-row9-clash-view.png");

  const scanClick = await clickVisibleButton(page, "Run Forensic Clash Scan");
  step("row9", "click Run Forensic Clash Scan", scanClick);
  const scanDone = await waitFor(
    page,
    () => {
      const t = document.body.innerText;
      if (/Scanning Cross-Trade Specs/.test(t)) return null;
      if (/Clash scan|Forensic scan|No active cross-trade/i.test(t)) return t.match(/[^\n]*(Clash scan|Forensic scan)[^\n]*/i)?.[0] || true;
      return null;
    },
    60000,
    1000
  );
  step("row9", "scan completion signal", scanDone);
  await delay(2000);
  const afterScan = await clashProbe();
  step("row9", "clash view after scan", afterScan);
  await shot(page, "remediation-qa5-p4-02-row9-clash-after-scan.png");

  let deduction = null;
  if (afterScan.deductButtons.length > 0) {
    const click = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /1-Click Deduct Credit/.test(x.textContent || ""));
      if (!b) return { ok: false };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, text: (b.textContent || "").trim() };
    });
    step("row9", "click deduction", click);
    const deducted = await waitFor(page, () => (/Credit Deducted & Leveled/.test(document.body.innerText) ? true : null), 30000, 500);
    const after = await clashProbe();
    deduction = { click, deducted: deducted.ok, after };
    step("row9", "deduction result", deduction);
    await shot(page, "remediation-qa5-p4-03-row9-deduction.png");
  } else if (afterScan.assignButtons.length > 0) {
    const click = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /^Assign to/.test((x.textContent || "").trim()));
      if (!b) return { ok: false };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, text: (b.textContent || "").trim() };
    });
    step("row9", "no deduct available -> assign scope void", click);
    const assigned = await waitFor(page, () => (/Scope Assigned & Covered/.test(document.body.innerText) ? true : null), 30000, 500);
    const after = await clashProbe();
    deduction = { click, assigned: assigned.ok, after, kind: "assign" };
    step("row9", "assign result", deduction);
    await shot(page, "remediation-qa5-p4-03-row9-assign.png");
  }

  const hasClashCards = afterScan.doubleBuyCount > 0 || afterScan.scopeVoidCount > 0;
  const mutationOk = deduction ? (deduction.deducted || deduction.assigned) : false;
  results.row9 = {
    status: hasClashCards ? (deduction ? (mutationOk ? "PASS" : "PARTIAL (cards render, mutation failed)") : "PARTIAL (cards render, no action available)") : "OBSERVED-WITH-NO-DATA",
    beforeScan,
    afterScan,
    deduction,
  };
  step("row9", "ROW 9 VERDICT", { status: results.row9.status, hasClashCards, mutationOk });

  // ================= ROW 10: activity audit stream =================
  currentRow = "row10";
  await clickStage(page, "Live Activity Audit");
  await waitFor(page, () => document.body.innerText.includes("Activity Events ("), 15000, 500);
  await delay(2000);
  const audit = await page.evaluate(() => {
    const t = document.body.innerText;
    const count = Number((t.match(/Activity Events \((\d+)\)/) || [])[1] || 0);
    const titles = [...t.matchAll(/Event #\d+[^\n]*\n?([^\n]*)/g)].map((m) => m[1]).filter(Boolean);
    return { count, titlesSample: titles.slice(0, 40), bodyHead: t.slice(t.indexOf("Activity Events ("), t.indexOf("Activity Events (") + 4000) };
  });
  const keywords = ["Award", "Execution", "Bid", "RFQ", "RFI", "Addendum", "Package", "Contractor", "Deduct", "Clash", "Project"];
  const foundKeywords = keywords.filter((k) => audit.bodyHead.toLowerCase().includes(k.toLowerCase()));
  step("row10", "audit stream", { count: audit.count, foundKeywords, titleSample: audit.titlesSample.slice(0, 25) });
  await shot(page, "remediation-qa5-p4-04-row10-audit-stream.png");
  results.row10 = {
    status: audit.count > 0 && foundKeywords.length >= 5 ? "PASS" : audit.count > 0 ? "PARTIAL" : "FAIL",
    count: audit.count,
    foundKeywords,
    titleSample: audit.titlesSample.slice(0, 25),
  };
  step("row10", "ROW 10 VERDICT", { status: results.row10.status, count: audit.count, foundKeywords });

  const backendLogs = projectId ? await client.query("auditLogs:listRecentLogs", { projectId, limit: 100 }) : [];
  step("row10", "backend audit events (authoritative count)", { count: backendLogs.length, titles: backendLogs.map((l) => l.title) });

  // ================= ROW 11: diagnostics eval =================
  currentRow = "row11";
  await clickStage(page, "Evals & Architecture");
  await waitFor(page, () => document.body.innerText.includes("Chief Estimator"), 15000, 500);
  await delay(1500);
  const preEval = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      hasRunButton: /Run Chief Estimator Evals/.test(t),
      runIdText: (t.match(/Run ID:[^\n]*/) || [])[0] || null,
      kpis: t.slice(t.indexOf("Chief Estimator"), t.indexOf("Chief Estimator") + 900),
    };
  });
  step("row11", "diagnostics before eval", preEval);
  await shot(page, "remediation-qa5-p4-05-row11-before-eval.png");

  const evalClick = await clickVisibleButton(page, "Run Chief Estimator Evals");
  step("row11", "click Run Chief Estimator Evals", evalClick);
  const evalDone = await waitFor(
    page,
    () => {
      const t = document.body.innerText;
      if (/Evaluation failed/i.test(t)) return { kind: "error", text: (t.match(/Evaluation failed[^\n]*/) || [])[0] || "failed" };
      const m = t.match(/Run [^\n]* completed![^\n]*/);
      if (m) return { kind: "success", text: m[0] };
      return null;
    },
    200000,
    3000
  );
  step("row11", "eval outcome", evalDone);
  await delay(2500);
  const kpis = await page.evaluate(() => {
    const t = document.body.innerText;
    const grab = (label) => {
      const rx = new RegExp(label + "\\n([^\\n]+)");
      const m = t.match(rx);
      return m ? m[1].trim() : null;
    };
    return {
      passedCases: grab("Passed Cases"),
      mape: grab("Leveled Cost MAPE"),
      scopeRecall: grab("Scope Recall"),
      clashRecall: grab("Clash Recall"),
      aiaConformity: grab("AIA Conformity"),
      traceRows: (t.match(/Trace/g) || []).length,
      runId: (t.match(/Run ID:\s*([^\s]+)/) || [])[1] || null,
    };
  });
  step("row11", "eval KPI values", kpis);
  await shot(page, "remediation-qa5-p4-06-row11-eval-result.png");
  const nonBlank = Object.entries(kpis).filter(([k, v]) => ["passedCases", "mape", "scopeRecall", "clashRecall"].includes(k) && v && !/^[-\s]*$/.test(v));
  results.row11 = {
    status: evalDone.ok && evalDone.value && evalDone.value.kind === "success" && nonBlank.length >= 3 ? "PASS" : evalDone.ok ? "PARTIAL" : "FAIL",
    outcome: evalDone.value,
    kpis,
  };
  step("row11", "ROW 11 VERDICT", { status: results.row11.status, kpis });

  results.diagnostics = {
    consoleErrors: consoleEvents.filter((e) => e.type === "error").map((e) => e.text),
    pageErrors,
    failedRequests,
    httpErrors,
    counts: {
      consoleErrors: consoleEvents.filter((e) => e.type === "error").length,
      pageErrors: pageErrors.length,
      failedRequests: failedRequests.length,
      httpErrors: httpErrors.length,
    },
  };
  say(`DIAGNOSTICS: ${JSON.stringify(results.diagnostics.counts)}`);
  saveState({ part4: results, part4At: new Date().toISOString() });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa5-part4-events.json"), JSON.stringify({ results, consoleEvents, pageErrors, failedRequests, httpErrors }, null, 2), "utf8");
  say(`QA5_RESULT ${JSON.stringify({ row9: { status: results.row9.status, deduction }, row10: { status: results.row10.status, count: audit.count }, row11: { status: results.row11.status, kpis } })}`);
  write();
} catch (err) {
  say(`FATAL in ${currentRow}: ${err && err.stack ? err.stack : err}`);
  say(`EVENTS: ${JSON.stringify({ consoleErrors: consoleEvents.filter((e) => e.type === "error").map((e) => e.text), pageErrors, failedRequests, httpErrors })}`);
  write();
  process.exitCode = 1;
} finally {
  await browser.close();
}