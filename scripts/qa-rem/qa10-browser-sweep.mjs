// QA-10 (round 4) browser sweep on the LIVE app.
//  - default landing = demo project
//  - fixture project: all 8 tabs, capture every console error/warning + failed/>=400 request verbatim
//  - round-3 claimed fixes spot-check: CLASH-LEAK (electrical-only project must show no demo clash $),
//    KPI-3 (empty project shows real 0/0 count), STALE-ERR (reopen modal clears old error)
//  - mobile 375x812 landing + one detail tab (no body overflow)
//  - Back button + ?project=fake behavior notes
// Usage: node scripts/qa-rem/qa10-browser-sweep.mjs
import {
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  delay,
  BASE_URL,
  writeLog,
  getSelectorState,
  selectProjectByTitle,
} from "./qa1-lib.mjs";
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const backend = new ConvexHttpClient(BACKEND);

const fixture = JSON.parse(
  fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa10-fixture.json"), "utf8")
);
const FIXTURE_NEEDLE = fixture.tag;
let EMPTY_TAG = null;

const LOG = [];
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};
const J = (o, max = 500) => {
  const s = JSON.stringify(o);
  return s.length > max ? s.slice(0, max) + "…" : s;
};

const TABS = [
  ["packages", "CSI Scoping"],
  ["discovery", "Discovery"],
  ["qna", "Pre-Bid Q&A"],
  ["leveling", "Bid Leveling"],
  ["coordination", "Scope Clash"],
  ["contracts", "Subcontracts"],
  ["audit", "Live Activity Audit"],
  ["diagnostics", "Evals & Architecture"],
];

function makeDiag(page) {
  const d = attachDiagnostics(page);
  const httpErrors = [];
  page.on("response", (r) => {
    if (r.status() >= 400) httpErrors.push({ status: r.status(), method: r.request().method(), url: r.url() });
  });
  return { ...d, httpErrors };
}
function snap(d) {
  return {
    console: d.consoleLogs.length,
    pageErrors: d.pageErrors.length,
    failedReq: d.failedRequests.length,
    httpErrors: d.httpErrors.length,
  };
}
function delta(d, before) {
  return {
    console: d.consoleLogs.slice(before.console).map((l) => `[${l.type}] ${l.text}`),
    pageErrors: d.pageErrors.slice(before.pageErrors),
    failedReq: d.failedRequests.slice(before.failedReq),
    httpErrors: d.httpErrors.slice(before.httpErrors),
  };
}
async function mainSample(page, max = 420) {
  return page.evaluate((max) => {
    const main = document.querySelector("main");
    const t = main ? main.innerText.replace(/\s+/g, " ").trim() : "";
    return t.slice(0, max);
  }, max);
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
async function selectStageMobile(page, value) {
  return page.evaluate((value) => {
    const sel = document.querySelector('select[aria-label="Navigate procurement stage"]');
    if (!sel) return { ok: false, reason: "stage select not found" };
    sel.value = value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: sel.value };
  }, value);
}
async function activeStage(page) {
  return page.evaluate(() => {
    const sel = document.querySelector('select[aria-label="Navigate procurement stage"]');
    return sel ? sel.value : null;
  });
}
async function dismissTourIfOpen(page) {
  return page.evaluate(() => {
    const closeBtn = document.querySelector('button[title="Close Teleprompter"]');
    if (closeBtn) {
      closeBtn.click();
      return { open: true, minimized: false, dismissed: true };
    }
    const expandBtn = document.querySelector('button[title="Expand Investor Demo Teleprompter"]');
    if (expandBtn) return { open: true, minimized: true, dismissed: false };
    return { open: false, minimized: false, dismissed: false };
  });
}
async function overflowState(page) {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    docScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    bodyScrollHeight: document.body.scrollHeight,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
  }));
}
async function resetScroll(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
}

// ---- New Project modal helpers (mirrors prior round's method) ----
async function openModal(page) {
  return page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim().includes("New Project"));
    if (!b) return false;
    b.click();
    return true;
  });
}
async function isModalOpen(page) {
  return page.evaluate(() => Boolean(document.querySelector('[aria-labelledby="new-project-title"]')));
}
async function closeModal(page) {
  return page.evaluate(() => {
    const b = document.querySelector('button[aria-label="Close new project dialog"]');
    if (!b) return false;
    b.click();
    return true;
  });
}
async function fillFieldByLabel(page, label, value) {
  return page.evaluate(
    (label, value) => {
      const form = [...document.querySelectorAll("form")].find((f) => (f.textContent || "").includes("Project Title"));
      if (!form) return { ok: false, reason: "create form not found" };
      const candidates = [...form.querySelectorAll("label")].filter((l) => l.textContent.trim() === label);
      if (!candidates.length) return { ok: false, reason: `label not found: ${label}` };
      const el = candidates[0].parentElement.querySelector("input, textarea, select") || candidates[0].nextElementSibling;
      if (!el) return { ok: false, reason: `input after label not found: ${label}` };
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, value: String(el.value).slice(0, 60) };
    },
    label,
    value
  );
}
async function dispatchSubmit(page) {
  return page.evaluate(() => {
    const form = [...document.querySelectorAll("form")].find((f) => (f.textContent || "").includes("Project Title"));
    if (!form) return { ok: false };
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    return { ok: true };
  });
}
async function readFormError(page) {
  return page.evaluate(() => {
    const form = [...document.querySelectorAll("form")].find((f) => (f.textContent || "").includes("Project Title"));
    if (!form) return null;
    const p = [...form.querySelectorAll('p,div[role="alert"]')].find((x) => /rose|red|error/i.test(x.className || ""));
    return p ? p.textContent.trim() : null;
  });
}

async function captureDiagBlock(d, before, tag) {
  const x = delta(d, before);
  let clean = true;
  for (const c of x.console) {
    ev(`    console ${c}`);
    clean = false;
  }
  for (const p of x.pageErrors) {
    ev(`    pageerror ${p}`);
    clean = false;
  }
  for (const f of x.failedReq) {
    ev(`    failedReq ${f}`);
    clean = false;
  }
  for (const h of x.httpErrors) {
    ev(`    http>=400 ${h.method} ${h.status} ${h.url}`);
    clean = false;
  }
  if (clean) ev("    diag=clean");
  return x;
}

async function sweep(page, d, tag) {
  ev("");
  ev(`=== TAB SWEEP: ${tag} ===`);
  const collected = {};
  for (const [id, label] of TABS) {
    const before = snap(d);
    const clicked = await clickTab(page, label);
    await delay(1800);
    const stage = await activeStage(page);
    const sample = await mainSample(page);
    ev(`TAB ${id.padEnd(12)} (${label}) clicked=${J(clicked, 160)} activeStage=${stage} switched=${stage === id}`);
    collected[id] = await captureDiagBlock(d, before, id);
    collected[id].mainSample = sample;
    ev(`    main="${sample}"`);
    await shot(page, `remediation-qa10-tab-${id}-${tag}.png`);
  }
  return collected;
}

async function run() {
  const { browser } = await launchBrowser();
  const summary = {};
  try {
    // create the EMPTY fixture for KPI-3 / CLASH-LEAK spot checks
    EMPTY_TAG = `QA-REM-QA10-EMPTY-${Date.now()}`;
    const emptyProjectId = await backend.mutation("projects:createProject", {
      title: EMPTY_TAG,
      location: "Austin, TX",
      projectType: "commercial",
      estBudget: 1500000,
      targetCompletionWeeks: 40,
      specDocumentText: "QA-10 empty fixture for KPI/clash checks. No packages by design.",
      isDemoProject: false,
    });
    fixture.emptyTag = EMPTY_TAG;
    fixture.emptyProjectId = emptyProjectId;
    fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa10-fixture.json"), JSON.stringify(fixture, null, 2), "utf8");

    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.setDefaultTimeout(25000);
    const d = makeDiag(page);

    ev("=== QA-10 BROWSER SWEEP ===");
    ev(`Base URL: ${BASE_URL}`);
    ev(`UTC: ${new Date().toISOString()}`);
    ev(`Fixture: ${fixture.tag} (${fixture.projectId}) pkg=${fixture.packageId}`);
    ev(`Empty fixture: ${EMPTY_TAG} (${emptyProjectId})`);
    ev("");

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(2000);

    const bundle = await page.evaluate(() => {
      const s = document.querySelector('script[type="module"]');
      return s ? s.getAttribute("src") : null;
    });
    ev(`Deployed bundle: ${bundle}`);

    const sel0 = await getSelectorState(page);
    const landingDemo = Boolean(sel0 && sel0.selectedText && sel0.selectedText.includes("The Domain Tower B"));
    ev(`LANDING default selected="${sel0?.selectedText}" options=${sel0?.options.length} isDemo=${landingDemo}`);
    ev(`LANDING option list: ${J(sel0?.options.map((o) => o.text), 700)}`);
    const tourState = await dismissTourIfOpen(page);
    ev(`LANDING tour present=${tourState.open} dismissed=${tourState.dismissed}`);
    await delay(600);
    await shot(page, "remediation-qa10-01-landing.png");
    summary.landing = { selected: sel0?.selectedText, isDemo: landingDemo, tour: tourState, bundle };

    // switch to fixture and sweep
    ev("");
    ev(`=== switch to fixture ${fixture.tag} ===`);
    const sw = await selectProjectByTitle(page, FIXTURE_NEEDLE);
    ev(`select fixture: ${J(sw, 200)}`);
    await delay(2600);
    const selFixture = await getSelectorState(page);
    ev(`selected now: "${selFixture?.selectedText}"`);
    const kpiFixture = await page.evaluate(() => {
      const m = document.querySelector("main");
      const t = m ? m.innerText.replace(/\s+/g, " ") : "";
      const idx = t.indexOf("Buyout:");
      return idx >= 0 ? t.slice(idx, idx + 40) : "(Buyout label not found)";
    });
    ev(`KPI on fixture: "${kpiFixture}" (expect 0/1 Awarded)`);
    summary.kpiFixture = kpiFixture;
    summary.fixtureTabDiag = await sweep(page, d, "fixture");

    // coordination / clash-leak check on electrical-only fixture
    await clickTab(page, "Scope Clash");
    await delay(1500);
    const coordFixture = await mainSample(page, 900);
    const demoClashLeak = /50,500|46,500/.test(coordFixture);
    ev(`CLASH-LEAK check (electrical-only fixture): demo clash amounts present=${demoClashLeak}`);
    ev(`    coordination sample: "${coordFixture}"`);
    summary.clashLeakFixture = { demoAmountsPresent: demoClashLeak, sample: coordFixture };
    await shot(page, "remediation-qa10-02-coordination-electrical-only.png");

    // switch to empty fixture
    ev("");
    ev(`=== switch to empty fixture ${EMPTY_TAG} ===`);
    const swEmpty = await selectProjectByTitle(page, EMPTY_TAG);
    ev(`select empty: ${J(swEmpty, 200)}`);
    await delay(2600);
    const beforeEmpty = snap(d);
    const kpiEmpty = await page.evaluate(() => {
      const m = document.querySelector("main");
      const t = m ? m.innerText.replace(/\s+/g, " ") : "";
      const idx = t.indexOf("Buyout:");
      return idx >= 0 ? t.slice(idx, idx + 40) : "(Buyout label not found)";
    });
    ev(`KPI-3 check on empty project: "${kpiEmpty}" (expect 0/0 Awarded)`);
    summary.kpiEmpty = kpiEmpty;
    await captureDiagBlock(d, beforeEmpty, "empty-switch");
    await shot(page, "remediation-qa10-03-empty-kpi.png");

    await clickTab(page, "Scope Clash");
    await delay(1500);
    const coordEmpty = await mainSample(page, 900);
    const emptyClashLeak = /50,500|46,500/.test(coordEmpty);
    ev(`CLASH-LEAK check (zero-package project): demo clash amounts present=${emptyClashLeak}`);
    ev(`    coordination sample: "${coordEmpty}"`);
    summary.clashLeakEmpty = { demoAmountsPresent: emptyClashLeak, sample: coordEmpty };
    await shot(page, "remediation-qa10-04-coordination-empty.png");
    const emptySweep = await sweep(page, d, "empty");
    summary.emptyTabDiag = emptySweep;

    // STALE-ERR spot check
    ev("");
    ev("=== STALE-ERR spot check (close/reopen New Project modal) ===");
    const b1 = snap(d);
    const opened1 = await openModal(page);
    await page.waitForSelector('[aria-labelledby="new-project-title"]', { timeout: 10000 });
    await dispatchSubmit(page);
    await delay(1200);
    const err1 = await readFormError(page);
    ev(`open#1=${opened1} after empty submit error="${err1}" (expect Project title is required.)`);
    await closeModal(page);
    await delay(500);
    const opened2 = await openModal(page);
    await delay(500);
    const staleErr = await readFormError(page);
    ev(`reopened=${opened2} stale error after reopen="${staleErr}" (expect null)`);
    const staleDiag = await captureDiagBlock(d, b1, "stale-err");
    await shot(page, "remediation-qa10-05-stale-error-reopen.png");
    if (await isModalOpen(page)) await closeModal(page);
    await delay(400);
    summary.staleErr = { open1: opened1, error1: err1, reopened: opened2, staleError: staleErr, diag: staleDiag };

    // Back button behavior
    ev("");
    ev("=== BACK BUTTON behavior ===");
    const swBack = await selectProjectByTitle(page, FIXTURE_NEEDLE);
    await delay(2200);
    const stageBeforeBack = await activeStage(page);
    const urlBeforeBack = page.url();
    const tabClick = await clickTab(page, "Live Activity Audit");
    await delay(1500);
    const stageAfterTab = await activeStage(page);
    const urlAfterTab = page.url();
    let goBack = null;
    try {
      goBack = await page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 });
    } catch (e) {
      goBack = { error: String(e?.message || e) };
    }
    await delay(1200);
    const stageAfterBack = await activeStage(page);
    const urlAfterBack = page.url();
    const selAfterBack = (await getSelectorState(page))?.selectedText;
    ev(`stage before tab=${stageBeforeBack} after tab=${stageAfterTab} after goBack=${stageAfterBack}`);
    ev(`url before tab=${urlBeforeBack}`);
    ev(`url after tab =${urlAfterTab}`);
    ev(`url after back=${urlAfterBack} goBackResult=${goBack === null ? "null(no history entry)" : typeof goBack}`);
    ev(`selector after back="${selAfterBack}"`);
    summary.backButton = { stageBeforeBack, stageAfterTab, stageAfterBack, urlBeforeBack, urlAfterTab, urlAfterBack, goBackResult: goBack === null ? "null" : "navigation", selectorAfterBack: selAfterBack };
    await shot(page, "remediation-qa10-06-back-after-tab.png");

    // ?project=fake
    ev("");
    ev("=== ?project=fake behavior ===");
    const bFake = snap(d);
    await page.goto(`${BASE_URL}/?project=fake`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(2000);
    const fakeSel = await getSelectorState(page);
    const fakeBody = await mainSample(page, 300);
    const fakeUrl = page.url();
    const fakeDiag = await captureDiagBlock(d, bFake, "project-fake");
    ev(`url=${fakeUrl}`);
    ev(`selector="${fakeSel?.selectedText}"`);
    ev(`body sample="${fakeBody}"`);
    await shot(page, "remediation-qa10-07-deeplink-fake-project.png");
    summary.fakeProject = { url: fakeUrl, selector: fakeSel?.selectedText, bodySample: fakeBody, diag: fakeDiag };

    // ---- MOBILE 375x812 ----
    ev("");
    ev("=== MOBILE 375x812 ===");
    const mctx = await browser.createBrowserContext();
    const mpage = await mctx.newPage();
    mpage.setDefaultTimeout(25000);
    await mpage.setViewport({ width: 375, height: 812 });
    const md = makeDiag(mpage);
    await mpage.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(mpage);
    await delay(2200);
    const mSel = await getSelectorState(mpage);
    const mTour = await dismissTourIfOpen(mpage);
    await resetScroll(mpage);
    const mOverflowLanding = await overflowState(mpage);
    ev(`mobile landing: selected="${mSel?.selectedText}" tour=${J(mTour)} overflow=${J(mOverflowLanding)}`);
    await shot(mpage, "remediation-qa10-08-mobile-375-landing.png");
    summary.mobile = { landing: mOverflowLanding, tour: mTour };

    const mSwitch = await selectProjectByTitle(mpage, FIXTURE_NEEDLE);
    ev(`mobile select fixture: ${J(mSwitch, 160)}`);
    await delay(2500);
    const mStageClick = await selectStageMobile(mpage, "leveling");
    await delay(2000);
    const mStage = await activeStage(mpage);
    await resetScroll(mpage);
    const mOverflowLeveling = await overflowState(mpage);
    const mSample = await mainSample(mpage, 300);
    const mDiag = await captureDiagBlock(md, { console: 0, pageErrors: 0, failedReq: 0, httpErrors: 0 }, "mobile");
    ev(`mobile leveling: stageClick=${J(mStageClick)} activeStage=${mStage} overflow=${J(mOverflowLeveling)}`);
    ev(`    main="${mSample}"`);
    await shot(mpage, "remediation-qa10-09-mobile-375-leveling.png");
    summary.mobile.leveling = { stage: mStage, overflow: mOverflowLeveling, diag: mDiag };

    // ---- SESSION SUMMARY ----
    ev("");
    ev("=== FULL-SESSION SUMMARY (desktop) ===");
    const allErrors = d.consoleLogs.filter((l) => l.type === "error");
    const allWarnings = d.consoleLogs.filter((l) => l.type === "warning");
    ev(`desktop console messages=${d.consoleLogs.length} errors=${allErrors.length} warnings=${allWarnings.length}`);
    for (const e of allErrors) ev(`  ERROR: ${e.text}`);
    for (const w of allWarnings) ev(`  WARN : ${w.text}`);
    ev(`desktop pageerrors=${d.pageErrors.length}`);
    for (const p of d.pageErrors) ev(`  PAGEERROR: ${p}`);
    ev(`desktop failed requests=${d.failedRequests.length}`);
    for (const f of d.failedRequests) ev(`  FAILEDREQ: ${f}`);
    ev(`desktop >=400 responses=${d.httpErrors.length}`);
    for (const h of d.httpErrors) ev(`  HTTP>=400: ${h.method} ${h.status} ${h.url}`);
    ev(`mobile console errors=${md.consoleLogs.filter((l) => l.type === "error").length} warnings=${md.consoleLogs.filter((l) => l.type === "warning").length} pageerrors=${md.pageErrors.length} failedreq=${md.failedRequests.length} http>=400=${md.httpErrors.length}`);
    summary.desktopSession = {
      consoleErrors: allErrors.map((l) => l.text),
      consoleWarnings: allWarnings.map((l) => l.text),
      pageErrors: d.pageErrors,
      failedRequests: d.failedRequests,
      httpErrors: d.httpErrors,
    };

    fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa10-browser-sweep.json"), JSON.stringify(summary, null, 2), "utf8");
    const dest = writeLog("remediation-qa10-browser-sweep.txt", LOG);
    console.log(`Wrote ${dest}`);
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error("FATAL", e);
  try {
    writeLog("remediation-qa10-browser-sweep.txt", LOG.concat([`FATAL: ${e?.stack || e}`]));
  } catch {}
  process.exit(1);
});