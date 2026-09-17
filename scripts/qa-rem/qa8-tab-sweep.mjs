// QA-8 (round 3) console/network sweep across all 8 tabs (demo populated + QA-REM empty project).
// Usage: node scripts/qa-rem/qa8-tab-sweep.mjs
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

const LOG = [];
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};
const J = (o, max = 400) => {
  const s = JSON.stringify(o);
  return s.length > max ? s.slice(0, max) + "…" : s;
};

const diag = {};
const httpErrors = [];
function snapDiag() {
  return { console: diag.consoleLogs.length, pageErrors: diag.pageErrors.length, failedReq: diag.failedRequests.length, httpErrors: httpErrors.length };
}
function deltaDiag(before) {
  return {
    console: diag.consoleLogs.slice(before.console).map((l) => `[${l.type}] ${l.text}`),
    pageErrors: diag.pageErrors.slice(before.pageErrors),
    failedReq: diag.failedRequests.slice(before.failedReq),
    httpErrors: httpErrors.slice(before.httpErrors),
  };
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
    if (!match) return { ok: false, reason: "tab button not found", available: btns.map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 50) };
    match.scrollIntoView({ block: "center" });
    match.click();
    return { ok: true, title: match.getAttribute("title"), text: (match.textContent || "").trim().slice(0, 60) };
  }, label);
}

async function activeStage(page) {
  return page.evaluate(() => {
    const sel = document.querySelector('select[aria-label="Navigate procurement stage"]');
    return sel ? sel.value : null;
  });
}

async function mainSample(page, max = 400) {
  return page.evaluate((max) => {
    const main = document.querySelector("main");
    const t = main ? main.innerText.replace(/\s+/g, " ").trim() : "";
    return t.slice(0, max);
  }, max);
}

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

async function sweep(page, tag, expectTabSwitch) {
  ev("");
  ev(`=== TAB SWEEP: ${tag} ===`);
  for (const [id, label] of TABS) {
    const before = snapDiag();
    const clicked = await clickTab(page, label);
    await delay(1900);
    const stage = await activeStage(page);
    const d = deltaDiag(before);
    const sample = await mainSample(page);
    const switched = stage === id;
    ev(`TAB ${id.padEnd(12)} (${label}) clicked=${J(clicked)} activeStage=${stage} switched=${switched}${expectTabSwitch && !switched ? " <-- NOT-SWITCHED" : ""}`);
    if (d.console.length) {
      for (const c of d.console) ev(`    console ${c}`);
    }
    if (d.pageErrors.length) for (const p of d.pageErrors) ev(`    pageerror ${p}`);
    if (d.failedReq.length) for (const f of d.failedReq) ev(`    failedReq ${f}`);
    if (d.httpErrors.length) for (const h of d.httpErrors) ev(`    http>=400 ${h.method} ${h.status} ${h.url}`);
    if (!d.console.length && !d.pageErrors.length && !d.failedReq.length && !d.httpErrors.length) ev("    diag=clean");
    ev(`    main="${sample}"`);
    await shot(page, `remediation-qa8-tab-${id}-${tag}.png`);
  }
}

async function run() {
  const { browser } = await launchBrowser();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(25000);
    Object.assign(diag, attachDiagnostics(page));
    page.on("response", (r) => {
      if (r.status() >= 400) httpErrors.push({ status: r.status(), method: r.request().method(), url: r.url() });
    });

    ev("=== QA-8 TAB CONSOLE/NETWORK SWEEP ===");
    ev(`Base URL: ${BASE_URL}`);
    ev(`UTC: ${new Date().toISOString()}`);

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(1500);

    const sel = await getSelectorState(page);
    ev(`selector: ${J({ selected: sel.selectedText, count: sel.options.length })}`);

    await selectProjectByTitle(page, "The Domain Tower B");
    await delay(2500);
    await sweep(page, "demo", true);

    ev("");
    ev("=== switch to QA-REM empty project ===");
    const selQa = await selectProjectByTitle(page, "QA-REM-QA8-UX-");
    ev(`select QA project: ${J(selQa)}`);
    await delay(2500);
    const selNow = await getSelectorState(page);
    ev(`selected now: ${J(selNow.selectedText)}`);
    await sweep(page, "empty", true);

    ev("");
    ev("=== FULL-SESSION SUMMARY ===");
    const allConsoleErrors = diag.consoleLogs.filter((l) => l.type === "error");
    const allConsoleWarnings = diag.consoleLogs.filter((l) => l.type === "warning");
    ev(`session console messages=${diag.consoleLogs.length} errors=${allConsoleErrors.length} warnings=${allConsoleWarnings.length}`);
    for (const e of allConsoleErrors) ev(`  ERROR: ${e.text}`);
    for (const w of allConsoleWarnings) ev(`  WARN : ${w.text}`);
    ev(`session pageerrors=${diag.pageErrors.length}`);
    for (const p of diag.pageErrors) ev(`  PAGEERROR: ${p}`);
    ev(`session failed requests=${diag.failedRequests.length}`);
    for (const f of diag.failedRequests) ev(`  FAILEDREQ: ${f}`);
    ev(`session >=400 responses=${httpErrors.length}`);
    for (const h of httpErrors) ev(`  HTTP>=400: ${h.method} ${h.status} ${h.url}`);

    const dest = writeLog("remediation-qa8-tab-sweep.txt", LOG);
    console.log(`Wrote ${dest}`);
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});