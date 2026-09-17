// QA-12 (round 5, final convergence) browser sweep on the LIVE app.
//  - fresh context: default landing = demo project
//  - create QA-REM fixture via the UI -> verify listed/selected/persisted (fresh context reload)
//  - 8 tabs on the fixture with verbatim diagnostics (0 console errors / 0 failed>=400 expected)
//  - mobile 375x812 one pass: overflow measured on demo AND custom fixture, per project type
// Usage: node scripts/qa-rem/qa12-browser-sweep.mjs
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
  bodyText,
} from "./qa1-lib.mjs";
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const backend = new ConvexHttpClient(BACKEND);
const TAG = `QA-REM-QA12-UI-${Date.now()}`;

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
async function activeStage(page) {
  return page.evaluate(() => {
    const sel = document.querySelector('select[aria-label="Navigate procurement stage"]');
    return sel ? sel.value : null;
  });
}
async function selectStage(page, value) {
  return page.evaluate((value) => {
    const sel = document.querySelector('select[aria-label="Navigate procurement stage"]');
    if (!sel) return { ok: false, reason: "stage select not found" };
    sel.value = value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: sel.value };
  }, value);
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
    overflowPx: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
    overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > window.innerWidth,
  }));
}
async function overflowOffenders(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const out = [];
    const all = document.querySelectorAll("body *");
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 1) {
        const cls = typeof el.className === "string" ? el.className.split(/\s+/).slice(0, 4).join(".") : "";
        out.push({ tag: el.tagName, cls, right: Math.round(r.right), width: Math.round(r.width) });
        if (out.length >= 8) break;
      }
    }
    return out;
  });
}

// ---- modal helpers ----
async function openModal(page) {
  return page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim().includes("New Project"));
    if (!b) return false;
    b.click();
    return true;
  });
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
      return { ok: true, label, value: String(el.value).slice(0, 60) };
    },
    label,
    value
  );
}
async function submitCreate(page) {
  return page.evaluate(() => {
    const form = [...document.querySelectorAll("form")].find((f) => (f.textContent || "").includes("Project Title"));
    if (!form) return { ok: false };
    const btn = [...form.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Commercial Project"));
    if (btn) {
      btn.click();
      return { ok: true, viaButton: true };
    }
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    return { ok: true, viaButton: false };
  });
}

async function captureDiagBlock(d, before) {
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
    collected[id] = await captureDiagBlock(d, before);
    collected[id].mainSample = sample;
    ev(`    main="${sample}"`);
    await shot(page, `remediation-qa12-tab-${id}-${tag}.png`);
  }
  return collected;
}

async function run() {
  const { browser, executablePath } = await launchBrowser();
  const summary = { tag: TAG, base: BASE_URL, at: new Date().toISOString(), browser: executablePath };
  try {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.setDefaultTimeout(30000);
    const d = makeDiag(page);

    ev("=== QA-12 BROWSER SWEEP ===");
    ev(`Base URL: ${BASE_URL}`);
    ev(`UTC: ${new Date().toISOString()}`);
    ev(`Fixture tag: ${TAG}`);
    ev("");

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(2200);

    const bundle = await page.evaluate(() => {
      const s = document.querySelector('script[type="module"]');
      return s ? s.getAttribute("src") : null;
    });
    ev(`Deployed bundle: ${bundle}`);
    summary.bundle = bundle;

    const sel0 = await getSelectorState(page);
    const landingDemo = Boolean(sel0 && sel0.selectedText && sel0.selectedText.includes("The Domain Tower B"));
    ev(`LANDING default selected="${sel0?.selectedText}" options=${sel0?.options.length} isDemo=${landingDemo}`);
    ev(`LANDING option list: ${J(sel0?.options.map((o) => o.text), 700)}`);
    const tourState = await dismissTourIfOpen(page);
    ev(`LANDING tour present=${tourState.open} dismissed=${tourState.dismissed}`);
    await delay(600);
    await shot(page, "remediation-qa12-01-landing.png");
    summary.landing = { selected: sel0?.selectedText, isDemo: landingDemo, tour: tourState, optionCount: sel0?.options.length };

    // ---- create fixture via UI ----
    ev("");
    ev("=== CREATE FIXTURE VIA UI ===");
    const bCreate = snap(d);
    const opened = await openModal(page);
    await page.waitForSelector('[aria-labelledby="new-project-title"]', { timeout: 10000 });
    ev(`modal open=${opened}`);
    const fields = [];
    fields.push(await fillFieldByLabel(page, "Project Title", TAG));
    fields.push(await fillFieldByLabel(page, "Location", "Austin, TX"));
    fields.push(await fillFieldByLabel(page, "Project Type", "Commercial / QA-12"));
    fields.push(await fillFieldByLabel(page, "General Contractor / Contracting Entity", "QA-12 Verifier GC, LP"));
    fields.push(await fillFieldByLabel(page, "Estimated Budget ($)", "2400000"));
    fields.push(await fillFieldByLabel(page, "Duration (Weeks)", "52"));
    fields.push(
      await fillFieldByLabel(
        page,
        "Specification Summary",
        "QA-12 UI fixture. Division 26 electrical distribution and Division 23 HVAC scopes for lifecycle verification."
      )
    );
    for (const f of fields) if (!f.ok) ev(`  field FAIL: ${J(f)}`);
    const submitted = await submitCreate(page);
    ev(`submit=${J(submitted)}`);
    // wait for modal to close
    let modalClosed = false;
    for (let i = 0; i < 60; i++) {
      modalClosed = await page.evaluate(() => !document.querySelector('[aria-labelledby="new-project-title"]'));
      if (modalClosed) break;
      await delay(500);
    }
    ev(`modal closed=${modalClosed} after submit`);
    await delay(2500);
    const selAfterCreate = await getSelectorState(page);
    const createdSelected = Boolean(selAfterCreate && selAfterCreate.selectedText && selAfterCreate.selectedText.includes(TAG));
    ev(`selector after create: "${selAfterCreate?.selectedText}" selectedFixture=${createdSelected}`);
    const createDiag = await captureDiagBlock(d, bCreate);
    await shot(page, "remediation-qa12-02-after-create.png");

    const projects = await backend.query("projects:listProjects", {});
    const createdProject = projects.find((p) => p.title === TAG);
    if (!createdProject) throw new Error("fixture not found in backend after UI create");
    const projectId = createdProject._id;
    ev(`backed fixture id: ${projectId}`);
    summary.fixture = { tag: TAG, projectId, createdSelected, createDiag };

    // fresh-context reload persistence check
    const ctxFresh = await browser.createBrowserContext();
    const freshPage = await ctxFresh.newPage();
    freshPage.setDefaultTimeout(30000);
    await freshPage.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(freshPage);
    await delay(2500);
    const freshSel = await getSelectorState(freshPage);
    const freshHasFixture = Boolean(freshSel && freshSel.options.some((o) => o.text.includes(TAG)));
    const freshLandingDemo = Boolean(freshSel && freshSel.selectedText && freshSel.selectedText.includes("The Domain Tower B"));
    ev(`fresh context: fixture listed=${freshHasFixture}; landing="${freshSel?.selectedText}" isDemo=${freshLandingDemo}`);
    summary.freshContext = { fixtureListed: freshHasFixture, landingDemo: freshLandingDemo };
    await ctxFresh.close();

    // ---- 8 tab sweep on the fixture ----
    if (!createdSelected) {
      ev("fixture not selected after create; selecting manually");
      await selectProjectByTitle(page, TAG);
      await delay(2500);
    }
    summary.fixtureTabDiag = await sweep(page, d, "fixture");

    // ---- MOBILE 375x812 one pass ----
    ev("");
    ev("=== MOBILE 375x812 ===");
    const mctx = await browser.createBrowserContext();
    const mpage = await mctx.newPage();
    mpage.setDefaultTimeout(30000);
    await mpage.setViewport({ width: 375, height: 812 });
    const md = makeDiag(mpage);
    await mpage.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(mpage);
    await delay(2200);
    await dismissTourIfOpen(mpage);
    const mSel = await getSelectorState(mpage);
    await mpage.evaluate(() => window.scrollTo(0, 0));
    const demoOverflow = await overflowState(mpage);
    const demoOffenders = await overflowOffenders(mpage);
    ev(`mobile DEMO (landing="${mSel?.selectedText}"): ${J(demoOverflow)}`);
    ev(`  demo offenders: ${J(demoOffenders, 400)}`);
    await shot(mpage, "remediation-qa12-mobile-demo-landing.png");
    summary.mobileDemo = { overflow: demoOverflow, offenders: demoOffenders, selected: mSel?.selectedText };

    const mSwitch = await selectProjectByTitle(mpage, TAG);
    ev(`mobile select fixture: ${J(mSwitch, 160)}`);
    await delay(2500);
    await selectStage(mpage, "packages");
    await delay(1800);
    await mpage.evaluate(() => window.scrollTo(0, 0));
    const customOverflowScoping = await overflowState(mpage);
    const customOffendersScoping = await overflowOffenders(mpage);
    ev(`mobile CUSTOM (CSI Scoping): ${J(customOverflowScoping)}`);
    ev(`  custom offenders: ${J(customOffendersScoping, 400)}`);
    await shot(mpage, "remediation-qa12-mobile-custom-scoping.png");

    await selectStage(mpage, "leveling");
    await delay(1800);
    await mpage.evaluate(() => window.scrollTo(0, 0));
    const customOverflowLeveling = await overflowState(mpage);
    const customOffendersLeveling = await overflowOffenders(mpage);
    ev(`mobile CUSTOM (Bid Leveling): ${J(customOverflowLeveling)}`);
    ev(`  custom offenders: ${J(customOffendersLeveling, 400)}`);
    await shot(mpage, "remediation-qa12-mobile-custom-leveling.png");
    summary.mobileCustom = {
      scoping: { overflow: customOverflowScoping, offenders: customOffendersScoping },
      leveling: { overflow: customOverflowLeveling, offenders: customOffendersLeveling },
    };
    const mobileHttpErrors = md.httpErrors.slice();
    const mobileConsoleErrors = md.consoleLogs.filter((l) => l.type === "error").map((l) => l.text);
    const mobileConsoleWarnings = md.consoleLogs.filter((l) => l.type === "warning").map((l) => l.text);
    ev(`mobile diag: consoleErrors=${mobileConsoleErrors.length} warnings=${mobileConsoleWarnings.length} pageErrors=${md.pageErrors.length} failedReq=${md.failedRequests.length} http>=400=${mobileHttpErrors.length}`);
    for (const e of mobileConsoleErrors) ev(`  M-ERROR: ${e}`);
    for (const w of mobileConsoleWarnings) ev(`  M-WARN : ${w}`);
    summary.mobileDiag = { consoleErrors: mobileConsoleErrors, consoleWarnings: mobileConsoleWarnings, pageErrors: md.pageErrors, failedRequests: md.failedRequests, httpErrors: mobileHttpErrors };

    // ---- SESSION SUMMARY (desktop) ----
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
    summary.desktopSession = {
      consoleErrors: allErrors.map((l) => l.text),
      consoleWarnings: allWarnings.map((l) => l.text),
      pageErrors: d.pageErrors,
      failedRequests: d.failedRequests,
      httpErrors: d.httpErrors,
    };

    fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa12-fixture.json"), JSON.stringify({ tag: TAG, projectId, createdAt: new Date().toISOString() }, null, 2), "utf8");
    fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa12-browser-sweep.json"), JSON.stringify(summary, null, 2), "utf8");
    const dest = writeLog("remediation-qa12-browser-sweep.txt", LOG);
    console.log(`Wrote ${dest}`);
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error("FATAL", e);
  try {
    writeLog("remediation-qa12-browser-sweep.txt", LOG.concat([`FATAL: ${e?.stack || e}`]));
  } catch {}
  process.exit(1);
});