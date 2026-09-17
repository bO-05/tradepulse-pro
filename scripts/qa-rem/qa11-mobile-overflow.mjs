// QA-11 item 1: MOBILE-OVERFLOW P3 fix verification at 375x812.
// Fresh custom QA-REM project (non-demo, Delete button rendering) vs demo control,
// landing + 3 tabs (CSI Scoping, Bid Leveling, Pre-Bid Q&A). Evidence: scrollWidth measurements,
// overflow offender DOM, screenshots.
// Usage: node scripts/qa-rem/qa11-mobile-overflow.mjs
import fs from "node:fs";
import path from "node:path";
import {
  EVIDENCE_DIR,
  BASE_URL,
  launchBrowser,
  attachDiagnostics,
  waitForAppReady,
  selectProjectByTitle,
  getSelectorState,
  shot,
  writeLog,
  summarizeDiagnostics,
  delay,
} from "./qa1-lib.mjs";

const fixtures = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa11-fixtures.json"), "utf8"));
const LOG = [];
const ev = (s) => { LOG.push(s); console.log(s); };
const results = {};

async function measure(page, label) {
  const m = await page.evaluate(() => {
    const vw = window.innerWidth;
    const offenders = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > vw + 0.5 || r.left < -0.5) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className && typeof el.className === "string" ? el.className : "").slice(0, 120),
          left: Math.round(r.left * 10) / 10,
          right: Math.round(r.right * 10) / 10,
          width: Math.round(r.width * 10) / 10,
          text: (el.textContent || "").trim().slice(0, 60),
        });
      }
    }
    return {
      vw,
      docScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      overflowPx: document.documentElement.scrollWidth - vw,
      selected: (() => {
        const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
        return sel ? sel.options[sel.selectedIndex]?.textContent.trim() : null;
      })(),
      deleteBtnVisible: Boolean(
        [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim().includes("Delete"))
      ),
      activeStage: (() => {
        const sel = document.querySelector('select[aria-label="Navigate procurement stage"]');
        return sel ? sel.value : null;
      })(),
      offenders: offenders.slice(0, 12),
      offenderCount: offenders.length,
    };
  });
  const pass = m.docScrollWidth <= m.vw;
  ev(`[${label}] ${pass ? "NO-OVERFLOW" : "OVERFLOW"} vw=${m.vw} docScrollWidth=${m.docScrollWidth} bodyScrollWidth=${m.bodyScrollWidth} overflowPx=${m.overflowPx} selected="${m.selected}" deleteBtn=${m.deleteBtnVisible} activeStage=${m.activeStage} offenders=${m.offenderCount}`);
  if (m.offenders.length) {
    for (const o of m.offenders) ev(`    offender <${o.tag}> [${o.left}..${o.right}] w=${o.width} cls="${o.cls}" text="${o.text}"`);
  }
  return m;
}

async function clickTab(page, label) {
  return page.evaluate((label) => {
    const header = document.querySelector("header");
    if (!header) return { ok: false, reason: "no header" };
    const btns = [...header.querySelectorAll("button")];
    const match = btns.find((b) => {
      const title = b.getAttribute("title") || "";
      if (title.includes(label)) return true;
      const spans = [...b.querySelectorAll("span")];
      return spans.length <= 3 && spans.some((s) => (s.textContent || "").trim() === label);
    });
    if (!match) return { ok: false, reason: "tab button not found" };
    match.scrollIntoView({ block: "center" });
    match.click();
    return { ok: true, text: (match.textContent || "").trim().slice(0, 60) };
  }, label);
}

const { browser } = await launchBrowser();
const context = await browser.createBrowserContext();
const page = await context.newPage();
page.setDefaultTimeout(30000);
const diag = attachDiagnostics(page);
const httpErrors = [];
page.on("response", (r) => {
  if (r.status() >= 400) httpErrors.push(`${r.status()} ${r.request().method()} ${r.url()}`);
});

try {
  ev(`QA-11 ITEM 1 MOBILE OVERFLOW @375x812 ${new Date().toISOString()} base=${BASE_URL}`);
  ev(`fixture UI=${fixtures.ui.tag} EMPTY=${fixtures.empty.tag}`);
  await page.setViewport({ width: 375, height: 812 });
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(2500);

  const demoM = await measure(page, "landing demo (control)");
  results.demoLanding = demoM.docScrollWidth <= demoM.vw ? "PASS" : "FAIL";
  const sel0 = await getSelectorState(page);
  results.defaultLandingDemo = sel0?.selectedText?.includes("The Domain Tower B") ? "PASS" : "FAIL";
  ev(`default landing selector="${sel0?.selectedText}" -> ${results.defaultLandingDemo}`);
  await shot(page, "remediation-qa11-01-mobile-375-demo-landing.png");

  ev("");
  ev("=== FRESH CUSTOM QA-REM PROJECT (non-demo) ===");
  const selUi = await selectProjectByTitle(page, fixtures.ui.tag);
  ev(`select UI fixture: ok=${selUi.ok} text="${selUi.text}"`);
  await delay(2500);
  const uiLanding = await measure(page, "landing custom UI fixture");
  results.uiLanding = uiLanding.docScrollWidth <= uiLanding.vw ? "PASS" : "FAIL";
  results.uiDeleteBtn = uiLanding.deleteBtnVisible ? "PASS" : "FAIL";
  await shot(page, "remediation-qa11-02-mobile-375-ui-landing.png");

  const TABS = [
    ["packages", "CSI Scoping", "remediation-qa11-03-mobile-375-ui-csi-scoping.png"],
    ["leveling", "Bid Leveling", "remediation-qa11-04-mobile-375-ui-bid-leveling.png"],
    ["qna", "Pre-Bid Q&A", "remediation-qa11-05-mobile-375-ui-pre-bid-qna.png"],
  ];
  for (const [stage, label, shotName] of TABS) {
    ev("");
    const clicked = await clickTab(page, label);
    ev(`click tab ${label} -> ${JSON.stringify(clicked)}`);
    await delay(2200);
    const m = await measure(page, `tab ${label}`);
    results[`tab_${stage}`] = m.docScrollWidth <= m.vw ? "PASS" : "FAIL";
    results[`tab_${stage}_switched`] = m.activeStage === stage ? "PASS" : "FAIL";
    await shot(page, shotName);
  }

  ev("");
  ev("=== 0-PACKAGE CUSTOM PROJECT (extra: Delete button + empty state) ===");
  const selEmpty = await selectProjectByTitle(page, fixtures.empty.tag);
  ev(`select EMPTY fixture: ok=${selEmpty.ok} text="${selEmpty.text}"`);
  await delay(2500);
  const emptyLanding = await measure(page, "landing custom EMPTY fixture");
  results.emptyLanding = emptyLanding.docScrollWidth <= emptyLanding.vw ? "PASS" : "FAIL";
  await shot(page, "remediation-qa11-06-mobile-375-empty-landing.png");
  const emptyTab = await clickTab(page, "Scope Clash");
  ev(`click tab Scope Clash -> ${JSON.stringify(emptyTab)}`);
  await delay(2200);
  const emptyClash = await measure(page, "tab Scope Clash on EMPTY fixture");
  results.emptyScopeClashTab = emptyClash.docScrollWidth <= emptyClash.vw ? "PASS" : "FAIL";
  await shot(page, "remediation-qa11-07-mobile-375-empty-scope-clash.png");

  const diagSummary = summarizeDiagnostics(diag);
  ev("");
  ev(`diagnostics: ${JSON.stringify(diagSummary)}`);
  ev(`http>=400: ${JSON.stringify(httpErrors)}`);
  results.noConsoleErrors = diagSummary.consoleErrors.length === 0 ? "PASS" : "FAIL";
  results.noPageErrors = diagSummary.pageErrors.length === 0 ? "PASS" : "FAIL";
  results.noFailedRequests = diagSummary.failedRequests.length === 0 ? "PASS" : "FAIL";

  const overall = Object.values(results).every((v) => v === "PASS") ? "PASS" : "FAIL";
  ev("");
  ev(`ITEM 1 OVERALL: ${overall}`);
  ev(`CHECKS: ${JSON.stringify(results)}`);
  console.log("JSON_RESULT " + JSON.stringify({ item: 1, result: overall, checks: results, diagnostics: diagSummary, httpErrors }));

  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "remediation-qa11-mobile-overflow.json"),
    JSON.stringify({ at: new Date().toISOString(), checks: results, demo: demoM, uiLanding, emptyLanding, emptyClash, diagnostics: diagSummary, httpErrors }, null, 2),
    "utf8"
  );
  writeLog("remediation-qa11-mobile-overflow.txt", LOG);
  process.exitCode = overall === "PASS" ? 0 : 1;
} catch (err) {
  ev(`ERROR: ${err && err.stack ? err.stack : err}`);
  const diagSummary = summarizeDiagnostics(diag);
  ev(`diagnostics at failure: ${JSON.stringify(diagSummary)}`);
  writeLog("remediation-qa11-mobile-overflow.txt", LOG);
  console.log("JSON_RESULT " + JSON.stringify({ item: 1, result: "FAIL", error: String(err), checks: results, diagnostics: diagSummary }));
  process.exitCode = 1;
} finally {
  await browser.close();
}