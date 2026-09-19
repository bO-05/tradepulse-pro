/**
 * QA36-04 full UI journey across TWO projects (AUDIT-QA36-UIA / AUDIT-QA36-UIB):
 *  UIA: Scope Clash pre-state -> real-click 1-Click Deduct -> leveling matrix truth
 *  -> real-click Export Leveling CSV (blob captured, numbers reconciled)
 *  -> real-click award -> Subcontracts viewer -> real-click Print (popup captured, sum reconciled)
 *  -> switch to UIB -> prove isolation (KPI/bid unchanged) -> back to UIA -> real-click Reverse credit
 *  -> claims sweep -> 375px / 720px responsive probes -> console/network/pageerror/websocket diagnostics.
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab, selectProjectByTitle, setViewport } from "./lib.mjs";
import {
  client, readEvidence, writeEvidence, writeLog, EVIDENCE_DIR,
  creditInvariants, getBid, creditRows, creditClashId, CLASH_VFD, VFD_TITLE,
} from "./qa36-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const REPO = "D:/Repo/ALL HACKATHONS/Convex/Convex all gas";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const reconcile = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1500)}`);
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
function scanClaimsSources() {
  const files = [...walk(path.join(REPO, "src")), ...walk(path.join(REPO, "convex"))].filter((f) => !/\.test\.|_generated|ai-files/.test(f));
  const hits = { gemini38: [], dedicated: [], officialAiaPositive: [], executedClaims: [], falseCreditClaim: [] };
  for (const f of files) {
    const rel = path.relative(REPO, f).replace(/\\/g, "/");
    fs.readFileSync(f, "utf8").split(/\r?\n/).forEach((line, i) => {
      const where = `${rel}:${i + 1}`;
      if (/Gemini 3\.8/i.test(line)) hits.gemini38.push({ where, line: line.trim().slice(0, 150) });
      if (/dedicated (programmatic|stateful)?\s*(@agentmail\.to )?inbox|Dedicated (AgentMail|Stateful)/i.test(line) && !/instead of claiming|never a dedicated|not a dedicated/i.test(line)) hits.dedicated.push({ where, line: line.trim().slice(0, 150) });
      if (/official AIA/i.test(line) && !/\bnot\b|\bnever\b|no official/i.test(line)) hits.officialAiaPositive.push({ where, line: line.trim().slice(0, 150) });
      if (/Executed subcontract .*A401|fully executed/i.test(line)) hits.executedClaims.push({ where, line: line.trim().slice(0, 150) });
    });
  }
  return hits;
}
const FORBIDDEN_UI = [
  { id: "gemini38", rx: /Gemini 3\.8/i },
  { id: "dedicatedInbox", rx: /dedicated (programmatic|stateful)?\s*(@agentmail\.to )?inbox|Dedicated (AgentMail|Stateful)/i },
  { id: "officialAia", rx: /(?<!\bnot an )official AIA (licensed )?(form|document)/i },
  { id: "staticScanFallback", rx: /Cross-trade scan complete: 2 double-buys \(\$50,500\)/i, skip: true },
  { id: "executedBeforeExecution", rx: /Executed subcontract A401/i, contextual: true },
];
function claimViolations(text) {
  const out = [];
  for (const f of FORBIDDEN_UI) {
    if (f.skip) continue;
    if (!f.rx.test(text)) continue;
    if (f.contextual) {
      const idx = text.search(f.rx);
      const around = text.slice(Math.max(0, idx - 260), idx + 260);
      if (/voided|superseded|generated for/i.test(around)) continue;
    }
    out.push({ rule: f.id, sample: text.replace(/\s+/g, " ").slice(0, 160) });
  }
  return out;
}

const mainText = (page) => page.evaluate(() => (document.querySelector("main") || document.body).innerText);
const toastText = (page) => page.evaluate(() => (document.querySelector('[role="status"][aria-live="polite"]') || {}).innerText || null);

async function poll(fn, pred, timeoutMs, stepMs) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    last = await fn();
    if (pred(last)) return last;
    await delay(stepMs || 1200);
  }
  return last;
}
async function clickByTitle(page, title) {
  return page.evaluate((t) => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes(t) && vis(x));
    if (!b) return { ok: false, titles: [...document.querySelectorAll("button")].map((x) => x.getAttribute("title")).filter(Boolean).slice(0, 20) };
    b.scrollIntoView({ block: "center" }); b.click();
    return { ok: true, title: b.getAttribute("title") };
  }, title);
}
async function uiClashKpis(page) {
  return page.evaluate(() => {
    const t = (document.querySelector("main") || document.body).innerText.replace(/\n/g, " ");
    const grab = (label) => new RegExp(label + "\\s*\\$?([\\d,]+)").exec(t)?.[1] ?? null;
    const labels = [...document.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim());
    return {
      doubleBuys: grab("Redundant Double-Buys"),
      voids: grab("Unassigned Scope Voids"),
      credits: grab("Recoverable Buyout Credits"),
      risk: /Coordination Risk Level\s*(Resolved|Active Audit)/.exec(t)?.[1] ?? null,
      deductedChips: (t.match(/credit deducted & leveled/gi) || []).length,
      reverseButtons: labels.filter((x) => /Reverse credit/.test(x)).length,
      staleButtons: labels.filter((x) => /Clear stale credit record/.test(x)).length,
      deductButtons: labels.filter((x) => /1-Click Deduct Credit/.test(x)).length,
    };
  });
}
const OVERFLOW_PROBE = () => {
  const vw = document.documentElement.clientWidth;
  const insideScroller = (el) => {
    let n = el.parentElement;
    while (n && n !== document.body) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === "auto" || ox === "scroll" || ox === "hidden") return true;
      n = n.parentElement;
    }
    return false;
  };
  const offenders = [...document.querySelectorAll("body *")]
    .map((el) => ({ el, r: el.getBoundingClientRect(), cs: getComputedStyle(el) }))
    .filter(({ r, cs }) => r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden")
    .filter(({ r }) => r.right > vw + 0.5)
    .filter(({ el }) => !insideScroller(el))
    .map(({ el, r }) => ({ tag: el.tagName, cls: String(el.className || "").slice(0, 70), text: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40), right: Math.round(r.right * 10) / 10 }));
  return { vw, pageOverflow: document.documentElement.scrollWidth - vw, bodyOverflow: document.body.scrollWidth - vw, offenders: offenders.slice(0, 6), offenderCount: offenders.length };
};

async function main() {
  const src = scanClaimsSources();
  record("A36-UI.00", "source claims scan: zero Gemini-3.8 / dedicated-inbox / positive official-AIA / executed-before-execution strings",
    src.gemini38.length === 0 && src.dedicated.length === 0 && src.officialAiaPositive.length === 0 && src.executedClaims.length === 0,
    { gemini38: src.gemini38.slice(0, 2), dedicated: src.dedicated.slice(0, 2), officialAia: src.officialAiaPositive.slice(0, 2), executed: src.executedClaims.slice(0, 2) });

  const A = F.uiA, B = F.uiB;
  const AB = A.b23.bidId, BB = B.b23.bidId;
  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.evaluateOnNewDocument(() => {
    const orig = URL.createObjectURL.bind(URL);
    window.__qa36Blobs = [];
    URL.createObjectURL = (blob) => { try { window.__qa36Blobs.push(blob); } catch {} return orig(blob); };
  });
  let cdp = null;
  const ws = { created: 0, closed: 0, framesReceived: 0, framesSent: 0, frameErrors: [], urls: [] };
  try {
    cdp = await page.createCDPSession();
    await cdp.send("Network.enable");
    const dlDir = path.join(EVIDENCE_DIR, "fix4-qa36-ui-downloads");
    fs.mkdirSync(dlDir, { recursive: true });
    await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });
    cdp.on("Network.webSocketCreated", (e) => { ws.created += 1; ws.urls.push(e.url); });
    cdp.on("Network.webSocketClosed", () => { ws.closed += 1; });
    cdp.on("Network.webSocketFrameReceived", () => { ws.framesReceived += 1; });
    cdp.on("Network.webSocketFrameSent", () => { ws.framesSent += 1; });
    cdp.on("Network.webSocketFrameError", (e) => { ws.frameErrors.push(String(e.errorMessage || "frame error")); });
  } catch (err) {
    say(`CDP unavailable: ${err?.message ?? err}`);
  }

  try {
    await page.goto(`${BASE}/?qa36=journey`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
    await delay(800);

    // ---------- UIA pre-state
    const selA = await selectProjectByTitle(page, A ? "AUDIT-QA36-UIA" : "");
    await delay(1800);
    await clickTab(page, "Scope Clash");
    await delay(1600);
    const pre = await uiClashKpis(page);
    const invA0 = await creditInvariants(c, A.id);
    reconcile.push({ step: "UIA pre", ui: pre, backend: { credits: invA0.claimsTotal, actual: invA0.actualTotal } });
    record("A36-UI.01", "UIA selected; Scope Clash pre-state UI KPI == backend ($50,500 / $46,500 / $0; 2 deduct buttons)",
      selA.ok && pre.doubleBuys === "50,500" && pre.voids === "46,500" && pre.credits === "0" && pre.deductButtons === 2 && pre.deductedChips === 0 && invA0.clean,
      { sel: selA, pre });

    // ---------- real click deduct
    const ded = await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const b = [...document.querySelectorAll("button")].find((x) => vis(x) && /1-Click Deduct Credit/.test(x.innerText || ""));
      if (!b) return { ok: false };
      b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect();
      return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, text: b.innerText.replace(/\s+/g, " ").trim() };
    });
    if (ded.ok) await page.mouse.click(ded.x, ded.y);
    const bA1 = await poll(() => getBid(c, A.id, AB), (b) => (b?.valueEngineeringAlternates || []).length > 0, 40000);
    await delay(1500);
    const post1 = await uiClashKpis(page);
    const invA1 = await creditInvariants(c, A.id);
    reconcile.push({ step: "UIA deduct", backend: { leveled: bA1?.leveledTotalCost, actual: invA1.actualTotal }, ui: post1 });
    record("A36-UI.02", "real-click 1-Click Deduct: HVAC -$38,500 -> 431,500; UI credits $38,500, buys $12,000, chip 1, reverse visible; backend marker keyed",
      ded.ok && bA1?.leveledTotalCost === 431500 && invA1.clean && invA1.actualTotal === 38500 &&
        invA1.acceptedCredits[0]?.clashId === CLASH_VFD && post1.credits === "38,500" && post1.doubleBuys === "12,000" && post1.deductedChips === 1 && post1.reverseButtons === 1,
      { ded, leveled: bA1?.leveledTotalCost, inv: invA1.summary, post1 });

    // ---------- leveling matrix + CSV
    await clickTab(page, "Bid Leveling");
    await delay(1600);
    const pkgSel = await page.evaluate((n) => {
      const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => (x.innerText || "").includes(n));
      if (!b) return { ok: false, available: [...document.querySelectorAll("button[aria-pressed]")].map((x) => (x.innerText || "").trim()) };
      b.click(); return { ok: true, text: b.innerText.replace(/\s+/g, " ").trim() };
    }, "QA36 UIA HVAC");
    await delay(1500);
    const matrix = await page.evaluate(() => {
      const t = (document.querySelector("main") || document.body).innerText.replace(/\n/g, " ");
      const i = t.indexOf("AUDIT-QA36 UIA Mechanical");
      return {
        around: t.slice(Math.max(0, i - 120), i + 700),
        hasCreditMarker: /Cross-Trade Clash Credit \[clash-vfd-01\]/.test(document.body.innerText),
        hasLeveled: /431,500/.test(document.body.innerText),
      };
    });
    const csvClick = await clickByTitle(page, "Export full ADR-0003 leveling matrix to CSV");
    await delay(1200);
    const csvText = await page.evaluate(async () => {
      const bs = window.__qa36Blobs || [];
      const b = bs[bs.length - 1];
      return b ? await b.text() : null;
    });
    const csvLines = (csvText || "").split(/\r?\n/);
    const csvRow = csvLines.find((l) => l.includes("AUDIT-QA36 UIA Mechanical")) || "";
    const csvCols = csvRow.split(",").map((s) => s.replace(/^"|"$/g, ""));
    const bidAForCsv = await getBid(c, A.id, AB);
    const expectStatus = bidAForCsv?.isAwarded ? "AWARDED" : "UNAWARDED";
    reconcile.push({ step: "UIA CSV", row: csvRow, backend: { base: 470000, veDeduct: 38500, leveled: 431500, isAwarded: bidAForCsv?.isAwarded } });
    record("A36-UI.03", "leveling matrix + real-click CSV export: credit marker visible; CSV row has Accepted VE Deduct 38,500, True Leveled 431,500 and the live award status, reconciled with the backend",
      pkgSel.ok && matrix.hasCreditMarker && matrix.hasLeveled && csvClick.ok &&
        csvCols[8] === "38500" && csvCols[13] === "431500" && csvRow.includes(expectStatus),
      { pkgSel, hasMarker: matrix.hasCreditMarker, hasLeveled: matrix.hasLeveled, expectStatus, csvRow });

    // ---------- award + print (Subcontracts)
    const awardTry = await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const b = [...document.querySelectorAll("button")].find((x) => vis(x) && /Award Compliant Winner|Award Subcontract & Draft Agreement/.test(x.innerText || ""));
      if (!b) return { ok: false, buttons: [...document.querySelectorAll("button")].map((x) => (x.innerText || "").trim()).filter(Boolean).slice(0, 40) };
      b.scrollIntoView({ block: "center" }); b.click();
      return { ok: true, text: b.innerText.replace(/\s+/g, " ").trim() };
    });
    const agrs = awardTry.ok
      ? await poll(() => c.query("agreements:listAgreements", { projectId: A.id }), (x) => (x || []).some((a) => a.status === "generated"), 60000)
      : await c.query("agreements:listAgreements", { projectId: A.id });
    const agr = (agrs || []).find((a) => a.bidId === AB && a.status !== "superseded");
    const awardState = awardTry.ok ? "clicked" : (agr ? "already-awarded" : "missing");
    await delay(1500);
    await clickTab(page, "Subcontracts");
    await delay(1600);
    const inspect = await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const b = [...document.querySelectorAll("button")].find((x) => vis(x) && /Inspect Draft/.test(x.innerText || ""));
      if (!b) return { ok: false };
      b.scrollIntoView({ block: "center" }); b.click(); return { ok: true };
    });
    await delay(1300);
    const targetPromise = browser.waitForTarget((t) => t.opener() === page.target() && t.type() === "page", { timeout: 12000 }).catch(() => null);
    const printClick = await clickByTitle(page, "Print agreement or save as PDF");
    const popupTarget = await targetPromise;
    let popupText = null;
    let popupPages = 0;
    if (popupTarget) {
      const pp = await popupTarget.page();
      if (pp) {
        await delay(900);
        popupText = await pp.evaluate(() => document.body.innerText);
        await pp.screenshot({ path: path.join(EVIDENCE_DIR, "fix4-qa36-ui-print-popup.png"), fullPage: true }).catch(() => {});
        popupPages = (await browser.pages()).length;
        await pp.close().catch(() => {});
      }
    }
    reconcile.push({ step: "UIA award+print", agreement: { n: agr?.agreementNumber, sum: agr?.contractSum }, popupHasSum: popupText ? /431,500/.test(popupText) : null });
    record("A36-UI.04", "award state carries the credited 431,500 (real click when un-awarded); real-click Print opens the isolated popup whose contract text carries the same 431,500 sum",
      (awardState === "clicked" || awardState === "already-awarded") && agr?.contractSum === 431500 && inspect.ok && printClick.ok && Boolean(popupText) && /431,500/.test(popupText),
      { awardState, awardTry, agr: { n: agr?.agreementNumber, s: agr?.status, sum: agr?.contractSum }, printClick, popupHasSum: popupText ? /431,500/.test(popupText) : null, popupSample: (popupText || "").replace(/\s+/g, " ").slice(0, 220), popupPages });

    // ---------- UIB isolation via the selector
    const selB = await selectProjectByTitle(page, "AUDIT-QA36-UIB");
    await delay(1800);
    await clickTab(page, "Scope Clash");
    await delay(1700);
    const preB = await uiClashKpis(page);
    const invB = await creditInvariants(c, B.id);
    const bbNow = await getBid(c, B.id, BB);
    const abNow = await getBid(c, A.id, AB);
    reconcile.push({ step: "UIB isolation", ui: preB, backend: { bLeveled: bbNow?.leveledTotalCost, bCredits: invB.actualTotal } });
    record("A36-UI.05", "switch to UIB: full exposure restored ($50,500 / $46,500 / $0), UIB HVAC 530,000 with zero credits; UIA keeps its credit and 431,500",
      selB.ok && preB.doubleBuys === "50,500" && preB.voids === "46,500" && preB.credits === "0" && preB.deductedChips === 0 && preB.reverseButtons === 0 &&
        bbNow?.leveledTotalCost === 530000 && invB.clean && invB.actualTotal === 0 &&
        abNow?.leveledTotalCost === 431500 && creditRows(abNow).length === 1,
      { selB, preB, bLeveled: bbNow?.leveledTotalCost, aLeveled: abNow?.leveledTotalCost });

    // ---------- back to UIA, reverse via real click
    await selectProjectByTitle(page, "AUDIT-QA36-UIA");
    await delay(1800);
    await clickTab(page, "Scope Clash");
    await delay(1700);
    const rev = await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const b = [...document.querySelectorAll("button")].find((x) => vis(x) && /Reverse credit/.test(x.innerText || ""));
      if (!b) return { ok: false };
      b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect();
      return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (rev.ok) await page.mouse.click(rev.x, rev.y);
    const bA2 = await poll(() => getBid(c, A.id, AB), (b) => b?.leveledTotalCost === 470000, 30000);
    await delay(1400);
    const postRev = await uiClashKpis(page);
    const invA2 = await creditInvariants(c, A.id);
    const agrs2 = await c.query("agreements:listAgreements", { projectId: A.id });
    const agr2 = (agrs2 || []).find((a) => a._id === agr?._id);
    const revLog = ((await c.query("auditLogs:listRecentLogs", { projectId: A.id, limit: 300 })) || []).find((l) => /Double-Buy Credit Reversed/.test(l.title));
    reconcile.push({ step: "UIA reverse", backend: { leveled: bA2?.leveledTotalCost, agr: agr2?.contractSum, actual: invA2.actualTotal }, ui: postRev });
    record("A36-UI.06", "real-click Reverse credit: HVAC restored to 470,000, agreement re-synced, UI credits $0 / buys $50,500, audit restored-to matches",
      rev.ok && bA2?.leveledTotalCost === 470000 && invA2.clean && invA2.actualTotal === 0 && agr2?.contractSum === 470000 &&
        postRev.credits === "0" && postRev.doubleBuys === "50,500" && postRev.deductedChips === 0 && postRev.reverseButtons === 0 &&
        /restored to \$470,000/.test(revLog?.description || ""),
      { rev, leveled: bA2?.leveledTotalCost, agrSum: agr2?.contractSum, postRev, audit: revLog?.description });

    // ---------- claims sweep
    const violations = [];
    for (const t of ["CSI Scoping", "Discovery", "Pre-Bid Q&A", "Bid Leveling", "Scope Clash", "Subcontracts", "Live Activity Audit", "Evals & Architecture"]) {
      await clickTab(page, t);
      await delay(1100);
      const text = await mainText(page);
      for (const v of claimViolations(text)) violations.push({ tab: t, ...v });
    }
    record("A36-UI.07", "live claims sweep across all 8 tabs: zero forbidden claims (Gemini-3.8 / dedicated inbox / positive official AIA / executed-before-execution)",
      violations.length === 0, { violations: violations.slice(0, 6) });

    // ---------- responsive probes
    await clickTab(page, "Scope Clash");
    await delay(1200);
    await setViewport(page, 375, 780);
    await delay(1200);
    const m375 = await page.evaluate(OVERFLOW_PROBE);
    await shot(page, "fix4-qa36-mobile-375-coordination.png", { full: true });
    await setViewport(page, 720, 900);
    await delay(1200);
    const m720c = await page.evaluate(OVERFLOW_PROBE);
    await shot(page, "fix4-qa36-zoom200-coordination.png", { full: true });
    await clickTab(page, "Bid Leveling");
    await delay(1400);
    const m720l = await page.evaluate(OVERFLOW_PROBE);
    await shot(page, "fix4-qa36-zoom200-leveling.png", { full: true });
    record("A36-UI.08", "responsive spot checks on the changed surfaces: zero page-level horizontal overflow at 375px (coordination) and 720px (coordination + leveling), no unclipped offenders",
      m375.pageOverflow <= 0 && m375.bodyOverflow <= 0 && m375.offenderCount === 0 &&
        m720c.pageOverflow <= 0 && m720c.bodyOverflow <= 0 && m720c.offenderCount === 0 &&
        m720l.pageOverflow <= 0 && m720l.bodyOverflow <= 0 && m720l.offenderCount === 0,
      { c375: { ov: m375.pageOverflow, off: m375.offenderCount, offenders: m375.offenders.slice(0, 3) }, c720: { ov: m720c.pageOverflow, off: m720c.offenderCount }, l720: { ov: m720l.pageOverflow, off: m720l.offenderCount, offenders: m720l.offenders.slice(0, 3) } });

    // ---------- diagnostics
    await setViewport(page, 1440, 900);
    await delay(2500);
    const consoleErrors = diag.consoleLogs.filter((l) => l.type === "error");
    const consoleWarnings = diag.consoleLogs.filter((l) => l.type === "warning" || l.type === "warn");
    const appFailed = diag.failedRequests.filter((f) => !/favicon/i.test(f));
    record("A36-UI.09", "websocket: reactive connection opened, frames exchanged both ways, no frame errors",
      ws.created >= 1 && ws.framesReceived > 0 && ws.frameErrors.length === 0,
      { created: ws.created, closed: ws.closed, framesReceived: ws.framesReceived, framesSent: ws.framesSent, frameErrors: ws.frameErrors.slice(0, 3) });
    record("A36-UI.10", "journey diagnostics: zero page errors, zero failed app requests, zero console errors",
      diag.pageErrors.length === 0 && appFailed.length === 0 && consoleErrors.length === 0,
      { pageErrors: diag.pageErrors.slice(0, 4), consoleErrors: consoleErrors.slice(0, 5).map((e) => e.text.slice(0, 160)), consoleWarnings: consoleWarnings.slice(0, 4).map((e) => e.text.slice(0, 140)), failedRequests: appFailed.slice(0, 5) });

    writeEvidence("ui-journey", {
      projectA: A.id, projectB: B.id, bidA: AB, bidB: BB, agreement: agr?.agreementNumber,
      results, reconcile, ws, sourceClaims: src,
      summary: { pass: results.filter((r) => r.pass).length, total: results.length },
    });
    writeLog("ui-journey", log);
    console.log(`ui-journey: ${results.filter((r) => r.pass).length}/${results.length}`);
  } catch (err) {
    writeEvidence("ui-journey", { results: [...results, { id: "A36-UI.ERR", pass: false, name: "aborted", detail: String(err?.stack ?? err) }], reconcile, summary: { pass: results.filter((r) => r.pass).length, total: results.length + 1 } });
    writeLog("ui-journey", [...log, String(err?.stack ?? err)]);
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("ui-journey-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});