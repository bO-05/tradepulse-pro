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
import { makeLog, loadState, saveState, dismissDemoTour, clickStage, clickVisibleButton, waitFor } from "./qa5-lib.mjs";

const state = loadState();
const PROJECT_TITLE = state.projectTitle;
const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const { say, write } = makeLog("remediation-qa5-part4b-log.txt");
say(`=== QA-5 PART 4B (Row 9 card-render recount, second deduction toast, Row 11 KPI read) ===`);
say(`PROJECT: ${PROJECT_TITLE} | UTC: ${new Date().toISOString()}`);

const consoleEvents = [];
const pageErrors = [];
const failedRequests = [];
const httpErrors = [];
const client = new ConvexHttpClient(BACKEND);

const { browser } = await launchBrowser();
const page = await browser.newPage();
page.on("console", (m) => consoleEvents.push({ type: m.type(), text: m.text() }));
page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));
page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${r.url()} :: ${r.failure() ? r.failure().errorText : "?"}`));
page.on("response", (res) => {
  if (res.status() >= 400) httpErrors.push(`${res.request().method()} ${res.url()} -> ${res.status()}`);
});

const out = {};
try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await dismissDemoTour(page);
  const sel = await getSelectorState(page);
  if (!(sel && sel.selectedText && sel.selectedText.includes(PROJECT_TITLE))) {
    await selectProjectByTitle(page, PROJECT_TITLE);
    await delay(1500);
  }

  // Row 9 recount (case-insensitive)
  await clickStage(page, "Scope Clash");
  await waitFor(page, () => document.body.innerText.includes("Cross-Trade Scope Clash"), 15000, 500);
  await delay(2500);
  const clash = await page.evaluate(() => {
    const t = document.body.innerText;
    const countCI = (rx) => (t.match(rx) || []).length;
    const idx = t.indexOf("1. Redundant Scope Double-Buys");
    const idx2 = t.indexOf("Cross-Trade Coordination Applied");
    return {
      doubleBuyCards: countCI(/Redundant Scope Double-Buys/gi),
      doubleBuyBadges: countCI(/Redundant Double-Buy Detected/gi),
      deductedBadges: countCI(/Credit Deducted & Leveled/gi),
      scopeVoidBadges: countCI(/Critical Scope Void Detected/gi),
      assignedBadges: countCI(/Scope Assigned & Covered/gi),
      deductButtons: [...document.querySelectorAll("button")].filter((b) => /1-Click Deduct Credit/.test(b.textContent || "")).map((b) => b.textContent.trim()),
      section: idx >= 0 ? t.slice(idx, idx2 > idx ? idx2 : idx + 3000) : null,
    };
  });
  say(`[row9] recount: ${JSON.stringify({ ...clash, section: undefined })}`);
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa5-part4b-clash-section.txt"), (clash.section || "no section") + "\n", "utf8");
  out.row9 = { ...clash, section: undefined };

  const deduct2 = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /1-Click Deduct Credit \(-.12,000/.test(x.textContent || ""));
    if (!b) return { ok: false, available: [...document.querySelectorAll("button")].filter((x) => /1-Click Deduct/.test(x.textContent || "")).map((x) => x.textContent.trim()) };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true, text: b.textContent.trim() };
  });
  say(`[row9] second deduction click: ${JSON.stringify(deduct2)}`);
  await delay(2500);
  const toast = await page.evaluate(() => {
    const el = [...document.querySelectorAll("div")].find((d) => typeof d.className === "string" && d.className.includes("fixed bottom-5 right-5"));
    return el ? el.textContent.trim() : null;
  });
  say(`[row9] toast after deduction: ${JSON.stringify(toast)}`);
  out.deduct2 = { ...deduct2, toast };
  await shot(page, "remediation-qa5-p4b-01-row9-second-deduct.png");

  const projects = await client.query("projects:listProjects", {});
  const projectId = projects.find((p) => p.title === PROJECT_TITLE)?._id;
  const logs = await client.query("auditLogs:listRecentLogs", { projectId, limit: 100 });
  const creditLogs = logs.filter((l) => /credit/i.test(l.title));
  out.auditAfter = { count: logs.length, creditLogs: creditLogs.map((l) => ({ title: l.title, desc: (l.description || "").slice(0, 220), actor: l.actor })) };
  say(`[row10] audit count after 2nd deduction: ${logs.length}`);
  say(`[row10] credit logs: ${JSON.stringify(out.auditAfter.creditLogs)}`);

  // Row 11 KPI read with correct labels
  await clickStage(page, "Evals & Architecture");
  await waitFor(page, () => document.body.innerText.includes("PARITY ACHIEVED"), 15000, 500);
  await delay(1500);
  const kpis = await page.evaluate(() => {
    const t = document.body.innerText;
    const grab = (label) => {
      const rx = new RegExp(label.toUpperCase() + "\\n([^\\n]+)");
      const m = t.match(rx);
      return m ? m[1].trim() : null;
    };
    const status = (t.match(/Run .*? completed![^\n]*/) || [])[0] || null;
    const runId = (t.match(/Run ID: (eval_\d+)/) || [])[1] || null;
    const casePasses = (t.match(/PASS/g) || []).length;
    return {
      parity: grab("Parity Achieved"),
      mape: grab("Leveled Cost MAPE"),
      scopeRecall: grab("Scope Recall"),
      clashRecall: grab("MEP Clash Recall"),
      aiaConformity: grab("AIA A401 Conformity"),
      status,
      runId,
      passBadges: casePasses,
    };
  });
  say(`[row11] KPIs (correct labels): ${JSON.stringify(kpis)}`);
  out.row11 = kpis;
  await shot(page, "remediation-qa5-p4b-02-row11-kpis.png");

  out.diagnostics = {
    consoleErrors: consoleEvents.filter((e) => e.type === "error").map((e) => e.text),
    pageErrors,
    failedRequests,
    httpErrors,
  };
  saveState({ part4b: out, part4bAt: new Date().toISOString() });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa5-part4b-result.json"), JSON.stringify(out, null, 2), "utf8");
  write();
} catch (err) {
  say(`FATAL: ${err && err.stack ? err.stack : err}`);
  out.error = String(err);
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa5-part4b-result.json"), JSON.stringify(out, null, 2), "utf8");
  write();
  process.exitCode = 1;
} finally {
  await browser.close();
}