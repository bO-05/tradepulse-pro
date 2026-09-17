// QA-11 item 2 (2a-2d): fresh live re-verification.
//  2a default landing = demo project (brand-new browser context)
//  2b Scope Clash: EMPTY 0-package QA-REM fixture (no cards / 0 badge) vs demo control (clashes)
//  2c KPI "Buyout: 0/0 Awarded" on the 0-package fixture
//  2d New Project modal whitespace-title error disappears after close+reopen
// Usage: node scripts/qa-rem/qa11-item2-live-reverify.mjs
import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import {
  EVIDENCE_DIR,
  BASE_URL,
  launchBrowser,
  attachDiagnostics,
  waitForAppReady,
  selectProjectByTitle,
  getSelectorState,
  clickButtonByText,
  shot,
  writeLog,
  summarizeDiagnostics,
  delay,
} from "./qa1-lib.mjs";

const BACKEND = "https://brainy-skunk-440.convex.cloud";
const fixtures = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa11-fixtures.json"), "utf8"));
const LOG = [];
const ev = (s) => { LOG.push(s); console.log(s); };
const results = {};
const client = new ConvexHttpClient(BACKEND);

async function clickTab(page, label) {
  return page.evaluate((label) => {
    const header = document.querySelector("header");
    const btns = header ? [...header.querySelectorAll("button")] : [];
    const match = btns.find((b) => (b.getAttribute("title") || "").includes(label) || [...b.querySelectorAll("span")].some((s) => (s.textContent || "").trim() === label));
    if (!match) return { ok: false };
    match.click();
    return { ok: true, text: (match.textContent || "").trim().slice(0, 60) };
  }, label);
}

async function tabButtonState(page, label) {
  return page.evaluate((label) => {
    const header = document.querySelector("header");
    const btns = header ? [...header.querySelectorAll("button")] : [];
    const b = btns.find((x) => [...x.querySelectorAll("span")].some((s) => (s.textContent || "").trim() === label) || (x.getAttribute("title") || "").includes(label));
    return b ? b.textContent.replace(/\s+/g, " ").trim() : null;
  }, label);
}

async function mainSample(page, max = 1600) {
  return page.evaluate((max) => {
    const main = document.querySelector("main");
    return main ? main.innerText.replace(/\s+/g, " ").trim().slice(0, max) : "";
  }, max);
}

async function kpiText(page) {
  return page.evaluate(() => {
    const t = document.body.innerText;
    return {
      awardedFrag: (t.match(/Buyout:\s*\d+\/\d+\s*Awarded/) || [])[0] || null,
      budgetLine: t.split("\n").map((l) => l.trim()).find((l) => l.includes("Budget:") && l.includes("Buyout")) || null,
    };
  });
}

async function fillByLabel(page, labelPrefix, value) {
  return page.evaluate((labelPrefix, value) => {
    const lab = [...document.querySelectorAll("label")].find((l) => (l.textContent || "").trim().startsWith(labelPrefix));
    const inp = lab ? lab.parentElement.querySelector("input") : null;
    if (!inp) return { ok: false, reason: "input not found for " + labelPrefix };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(inp, value);
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    inp.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: inp.value };
  }, labelPrefix, value);
}

const { browser } = await launchBrowser();
const context = await browser.createBrowserContext();
const page = await context.newPage();
page.setDefaultTimeout(30000);
const diag = attachDiagnostics(page);
const httpErrors = [];
page.on("response", (r) => { if (r.status() >= 400) httpErrors.push(`${r.status()} ${r.request().method()} ${r.url()}`); });

try {
  ev(`QA-11 ITEM 2 LIVE RE-VERIFY ${new Date().toISOString()} base=${BASE_URL}`);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(2500);

  // ---- 2a fresh default landing ----
  const sel0 = await getSelectorState(page);
  const projCountBeforeModal = (await client.query("projects:listProjects", {})).length;
  ev(`[2a] FRESH context default landing selected="${sel0?.selectedText}" options=${sel0?.options?.length} backendProjects=${projCountBeforeModal}`);
  results["2a_defaultLandingDemo"] = sel0?.selectedText?.includes("The Domain Tower B - Commercial MEP") ? "PASS" : "FAIL";
  results["2a_backendProjectCountExpected3"] = projCountBeforeModal === 3 ? "PASS" : "FAIL";
  await shot(page, "remediation-qa11-08-fresh-default-landing-demo.png");

  // ---- 2d stale modal error ----
  ev("");
  ev("=== 2d: New Project modal whitespace title close+reopen ===");
  const open1 = await clickButtonByText(page, "New Project");
  ev(`open New Project #1 -> ${JSON.stringify(open1)}`);
  await delay(700);
  const modalOpen = await page.evaluate(() => document.body.innerText.includes("Create New Construction Project"));
  ev(`modal open=${modalOpen}`);
  const fillWs = await fillByLabel(page, "Project Title", "   ");
  ev(`fill whitespace title -> ${JSON.stringify(fillWs)}`);
  await shot(page, "remediation-qa11-09-staleerr-whitespace-filled.png");
  const submit1 = await clickButtonByText(page, "Create Commercial Project");
  ev(`submit whitespace -> ${JSON.stringify(submit1)}`);
  await delay(900);
  const errShown = await page.evaluate(() => {
    const p = [...document.querySelectorAll("p")].find((x) => (x.textContent || "").trim() === "Project title is required.");
    return p ? p.textContent.trim() : null;
  });
  ev(`inline error after submit: "${errShown}"`);
  results["2d_errorShownOnWhitespaceSubmit"] = errShown === "Project title is required." ? "PASS" : "FAIL";
  await shot(page, "remediation-qa11-10-staleerr-error-shown.png");

  const closeRes = await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="Close new project dialog"]');
    if (!b) return { ok: false };
    b.click();
    return { ok: true };
  });
  await delay(600);
  const modalClosed = await page.evaluate(() => !document.body.innerText.includes("Create New Construction Project"));
  ev(`close modal -> ${JSON.stringify(closeRes)}; closed=${modalClosed}`);
  results["2d_modalClosed"] = modalClosed ? "PASS" : "FAIL";

  const open2 = await clickButtonByText(page, "New Project");
  ev(`open New Project #2 -> ${JSON.stringify(open2)}`);
  await delay(700);
  const reopened = await page.evaluate(() => {
    const modalOpenNow = document.body.innerText.includes("Create New Construction Project");
    const stale = [...document.querySelectorAll("p")].find((x) => (x.textContent || "").trim() === "Project title is required.");
    const errTexts = [...document.querySelectorAll("p")].map((x) => (x.textContent || "").trim()).filter((t) => /required|must be|positive|between/.test(t));
    const lab = [...document.querySelectorAll("label")].find((l) => (l.textContent || "").trim().startsWith("Project Title"));
    const inp = lab ? lab.parentElement.querySelector("input") : null;
    return { modalOpenNow, staleErrorVisible: !!stale, errorParagraphs: errTexts, titleVal: inp ? inp.value : null };
  });
  ev(`reopened state: ${JSON.stringify(reopened)}`);
  results["2d_staleErrGoneOnReopen"] = reopened.modalOpenNow && !reopened.staleErrorVisible && reopened.errorParagraphs.length === 0 ? "PASS" : "FAIL";
  results["2d_titleClearedOnReopen"] = reopened.titleVal === "" || reopened.titleVal === null ? "PASS" : "FAIL";
  await shot(page, "remediation-qa11-11-staleerr-reopened-clean.png");
  await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="Close new project dialog"]');
    if (b) b.click();
  });
  await delay(400);

  // ---- 2b/2c: EMPTY 0-package fixture ----
  ev("");
  ev("=== 2b/2c: EMPTY 0-package QA-REM fixture ===");
  const emptyPkgs = await client.query("tradePackages:listByProject", { projectId: fixtures.empty.projectId });
  ev(`backend packages on EMPTY fixture: ${emptyPkgs.length}`);
  const clashEmptyBackend = await client.query("coordination:detectCrossTradeClashes", { projectId: fixtures.empty.projectId });
  ev(`backend detectCrossTradeClashes(EMPTY): ${JSON.stringify(clashEmptyBackend)}`);
  const selEmpty = await selectProjectByTitle(page, fixtures.empty.tag);
  ev(`select EMPTY -> ${JSON.stringify(selEmpty)}`);
  await delay(2800);
  const kpiEmpty = await kpiText(page);
  ev(`[2c] EMPTY KPI: awardedFrag=${JSON.stringify(kpiEmpty.awardedFrag)} budgetLine=${JSON.stringify(kpiEmpty.budgetLine)}`);
  results["2c_buyout0of0"] = kpiEmpty.awardedFrag === "Buyout: 0/0 Awarded" ? "PASS" : "FAIL";
  await shot(page, "remediation-qa11-12-empty-kpi.png");

  const clashTabEmpty = await clickTab(page, "Scope Clash");
  await delay(2200);
  const tabBadgeEmpty = await tabButtonState(page, "Scope Clash");
  const emptyText = await mainSample(page, 1600);
  ev(`[2b] EMPTY Scope Clash tab button="${tabBadgeEmpty}" click=${JSON.stringify(clashTabEmpty)}`);
  ev(`[2b] EMPTY main sample: "${emptyText.slice(0, 700)}"`);
  const emptyChecks = {
    noDoubleBuyCards: !emptyText.includes("Redundant Double-Buy Detected"),
    noVoidCards: !/Scope Void/i.test(emptyText),
    noDemo50500: !emptyText.includes("50,500"),
    noDemo46500: !emptyText.includes("46,500"),
    noDemoTradeLeak: !emptyText.includes("Variable Frequency Drives") && !emptyText.includes("Rooftop Mechanical Equipment Disconnect"),
    tabBadgeNoClashCount: !/\d+\s*Clashes/.test(tabBadgeEmpty || ""),
  };
  for (const [k, v] of Object.entries(emptyChecks)) results[`2b_empty_${k}`] = v ? "PASS" : "FAIL";
  ev(`[2b] empty fixture clash checks: ${JSON.stringify(emptyChecks)}`);
  await shot(page, "remediation-qa11-13-empty-scope-clash.png");

  // ---- demo control: Scope Clash still shows clashes; KPI context ----
  ev("");
  ev("=== demo control ===");
  const selDemo = await selectProjectByTitle(page, "The Domain Tower B");
  ev(`select demo -> ${JSON.stringify(selDemo)}`);
  await delay(2800);
  const kpiDemo = await kpiText(page);
  ev(`demo KPI: awardedFrag=${JSON.stringify(kpiDemo.awardedFrag)} budgetLine=${JSON.stringify(kpiDemo.budgetLine)}`);
  const clashBtnDemo = await tabButtonState(page, "Scope Clash");
  ev(`demo Scope Clash tab button="${clashBtnDemo}"`);
  await clickTab(page, "Scope Clash");
  await delay(2200);
  const demoText = await mainSample(page, 1600);
  ev(`demo main sample: "${demoText.slice(0, 900)}"`);
  const demoChecks = {
    has50500: demoText.includes("$50,500") || demoText.includes("50,500"),
    has46500: demoText.includes("$46,500") || demoText.includes("46,500"),
    hasDoubleBuyCards: (demoText.match(/Redundant Double-Buy Detected/g) || []).length >= 2,
    tabBadgeClashes: /\d+\s*Clashes/.test(clashBtnDemo || ""),
  };
  for (const [k, v] of Object.entries(demoChecks)) results[`2b_demo_${k}`] = v ? "PASS" : "FAIL";
  ev(`demo clash checks: ${JSON.stringify(demoChecks)}`);
  const clashDemoBackend = await client.query("coordination:detectCrossTradeClashes", { projectId: "jx72rgackj9r53k1wptveax8jh8egbqy" });
  ev(`backend detectCrossTradeClashes(demo): doubleBuys=${clashDemoBackend.doubleBuys?.length} voids=${clashDemoBackend.scopeVoids?.length} summary=${JSON.stringify(clashDemoBackend.summary)}`);
  await shot(page, "remediation-qa11-14-demo-scope-clash.png");

  // ---- UI fixture KPI context (1 package) ----
  await selectProjectByTitle(page, fixtures.ui.tag);
  await delay(2500);
  const kpiUi = await kpiText(page);
  ev(`UI fixture (1 pkg) KPI: awardedFrag=${JSON.stringify(kpiUi.awardedFrag)}`);
  await shot(page, "remediation-qa11-15-ui-fixture-kpi.png");

  // no accidental project creation
  const projAfter = await client.query("projects:listProjects", {});
  ev("");
  ev(`backend projects after modal test: ${projAfter.length} [${projAfter.map((p) => p.title).join(" | ")}]`);
  results["2d_noProjectCreatedByWhitespaceSubmit"] = projAfter.length === 3 ? "PASS" : "FAIL";

  const diagSummary = summarizeDiagnostics(diag);
  ev(`diagnostics console=${JSON.stringify(diagSummary.consoleErrors)} pageErrors=${JSON.stringify(diagSummary.pageErrors)} failedRequests=${JSON.stringify(diagSummary.failedRequests)} warnings=${diagSummary.consoleWarnings.length}`);
  ev(`http>=400: ${JSON.stringify(httpErrors)}`);
  results.noConsoleErrors = diagSummary.consoleErrors.length === 0 ? "PASS" : "FAIL";
  results.noPageErrors = diagSummary.pageErrors.length === 0 ? "PASS" : "FAIL";
  results.noFailedRequests = diagSummary.failedRequests.length === 0 ? "PASS" : "FAIL";

  const overall = Object.values(results).every((v) => v === "PASS") ? "PASS" : "FAIL";
  ev("");
  ev(`ITEM 2 (2a-2d) OVERALL: ${overall}`);
  ev(`CHECKS: ${JSON.stringify(results)}`);
  console.log("JSON_RESULT " + JSON.stringify({ item: "2a-2d", result: overall, checks: results, diagnostics: diagSummary, httpErrors, clashEmptyBackend, clashDemoBackend }));

  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa11-item2-reverify.json"), JSON.stringify({
    at: new Date().toISOString(), checks: results, kpiEmpty, kpiDemo, kpiUi, tabBadgeEmpty, clashBtnDemo,
    emptyText, demoText, clashEmptyBackend, clashDemoBackend, diagnostics: diagSummary, httpErrors,
  }, null, 2), "utf8");
  writeLog("remediation-qa11-item2-reverify.txt", LOG);
  process.exitCode = overall === "PASS" ? 0 : 1;
} catch (err) {
  ev(`ERROR: ${err && err.stack ? err.stack : err}`);
  const diagSummary = summarizeDiagnostics(diag);
  ev(`diagnostics at failure: ${JSON.stringify(diagSummary)}`);
  writeLog("remediation-qa11-item2-reverify.txt", LOG);
  console.log("JSON_RESULT " + JSON.stringify({ item: "2a-2d", result: "FAIL", error: String(err), checks: results, diagnostics: diagSummary }));
  process.exitCode = 1;
} finally {
  await browser.close();
}