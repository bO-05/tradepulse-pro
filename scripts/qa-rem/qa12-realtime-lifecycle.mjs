// QA-12 two-context realtime Judge Dock + condensed lifecycle spot-check on the UI-created fixture.
//  A: idle viewer (marker proves no reload). B: runs Judge Dock full cycle.
//  Then lifecycle on B: leveling numbers -> award/A401 present -> execute -> Adjust locked -> audit events.
// Usage: node scripts/qa-rem/qa12-realtime-lifecycle.mjs
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
const fixture = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa12-fixture.json"), "utf8"));

const LOG = [];
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};
const J = (o, max = 700) => {
  const s = JSON.stringify(o);
  return s.length > max ? s.slice(0, max) + "…" : s;
};
const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

async function counts(label) {
  const packages = await backend.query("tradePackages:listByProject", { projectId: fixture.projectId });
  let contractors = 0;
  let bids = 0;
  for (const p of packages) {
    contractors += (await backend.query("contractors:listByPackage", { tradePackageId: p._id })).length;
    bids += (await backend.query("bids:listByPackage", { tradePackageId: p._id })).length;
  }
  const agreements = await backend.query("agreements:listAgreements", { projectId: fixture.projectId });
  const logs = await backend.query("auditLogs:listRecentLogs", { projectId: fixture.projectId, limit: 500 });
  const out = {
    label,
    packages: packages.length,
    contractors,
    bids,
    agreements: agreements.length,
    agreementStatuses: agreements.map((a) => a.status),
    agreementNumbers: agreements.map((a) => a.agreementNumber).filter(Boolean),
    auditLogs: logs.length,
  };
  ev(`backend[${label}]: ${J(out, 500)}`);
  return out;
}

async function headerState(page) {
  return page.evaluate(() => {
    const header = document.querySelector("header");
    const main = document.querySelector("main");
    return {
      header: header ? header.innerText.replace(/\s+/g, " ").trim().slice(0, 900) : null,
      kpi: main ? (main.innerText.match(/Buyout:\s*\d+\/\d+\s*Awarded/) || [null])[0] : null,
      marker: window.__qa12Marker ?? null,
      url: location.href,
      activeStage: (() => {
        const sel = document.querySelector('select[aria-label="Navigate procurement stage"]');
        return sel ? sel.value : null;
      })(),
    };
  });
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

async function clickButtonByText(page, needle, exact = false) {
  return page.evaluate(
    (needle, exact) => {
      const buttons = [...document.querySelectorAll("button")];
      const match = buttons.find((b) => {
        const t = (b.textContent || "").trim();
        return exact ? t === needle : t.includes(needle);
      });
      if (!match) return { ok: false, available: buttons.map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 50) };
      match.scrollIntoView({ block: "center" });
      match.click();
      return { ok: true, text: (match.textContent || "").trim(), disabled: match.disabled };
    },
    needle,
    exact
  );
}

async function mainText(page, max = 4000) {
  return page.evaluate((max) => {
    const m = document.querySelector("main");
    return m ? m.innerText.replace(/\s+/g, " ").trim().slice(0, max) : "";
  }, max);
}

async function diagSummary(d) {
  return {
    consoleErrors: d.consoleLogs.filter((l) => l.type === "error").map((l) => l.text),
    consoleWarnings: d.consoleLogs.filter((l) => l.type === "warning").map((l) => l.text),
    pageErrors: d.pageErrors,
    failedRequests: d.failedRequests,
  };
}

async function run() {
  const { browser } = await launchBrowser();
  const summary = { fixture, at: new Date().toISOString() };
  try {
    ev("=== QA-12 TWO-CONTEXT REALTIME DOCK + LIFECYCLE ===");
    ev(`Base URL: ${BASE_URL}`);
    ev(`Fixture: ${fixture.tag} (${fixture.projectId})`);
    ev(`UTC: ${new Date().toISOString()}`);
    ev("");

    const before = await counts("before");

    const ctxA = await browser.createBrowserContext();
    const ctxB = await browser.createBrowserContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    pageA.setDefaultTimeout(30000);
    pageB.setDefaultTimeout(30000);
    const dA = attachDiagnostics(pageA);
    const dB = attachDiagnostics(pageB);

    await pageA.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(pageA);
    await delay(1500);
    await selectProjectByTitle(pageA, fixture.tag);
    await delay(3000);
    await pageA.evaluate(() => {
      window.__qa12Marker = "alive-" + Date.now();
    });
    const aBefore = await headerState(pageA);
    ev(`A selected: "${(await getSelectorState(pageA))?.selectedText}"`);
    ev(`A before: kpi="${aBefore.kpi}" marker=${aBefore.marker}`);

    await pageB.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(pageB);
    await delay(1500);
    await selectProjectByTitle(pageB, fixture.tag);
    await delay(3000);
    ev(`B selected: "${(await getSelectorState(pageB))?.selectedText}"`);

    const opened = await clickButtonByText(pageB, "60s Judge Dock");
    ev(`B dock open: ${J(opened, 200)}`);
    await pageB.waitForSelector('[role="dialog"]', { timeout: 15000 });
    await delay(800);
    await shot(pageB, "remediation-qa12-03-dock-open-B.png");
    const targetPkg = await pageB.evaluate(() => {
      const t = document.body.innerText.match(/Target CSI Trade Package:?\s*([^\n]+)/);
      return t ? t[1].trim() : null;
    });
    ev(`B dock target package: "${targetPkg}"`);

    const clicked = await clickButtonByText(pageB, "1-Click Run Full Autonomous Procurement Lifecycle");
    ev(`B full cycle click: ${J(clicked, 300)}`);

    const t0 = Date.now();
    let aChange = null;
    let bMessage = null;
    while (Date.now() - t0 < 150000) {
      const state = await headerState(pageA);
      if (!aChange && (state.kpi !== aBefore.kpi || state.header !== aBefore.header)) {
        aChange = { atMs: Date.now() - t0, state };
        ev(`A REACTIVE UPDATE after ${aChange.atMs}ms (no refresh)`);
        ev(`A after: kpi="${state.kpi}" marker=${state.marker}`);
      }
      const dialogText = await pageB.evaluate(() => {
        const d = document.querySelector('[role="dialog"]');
        return d ? d.innerText.replace(/\s+/g, " ") : null;
      });
      if (dialogText && /Full Autonomous Lifecycle Complete|Lifecycle simulation failed/.test(dialogText)) {
        bMessage = dialogText;
        break;
      }
      await delay(2000);
    }
    if (!aChange) {
      const state = await headerState(pageA);
      aChange = { atMs: Date.now() - t0, state, timedOut: true };
      ev(`A NO UPDATE observed within ${aChange.atMs}ms (timed out)`);
    }

    const bResult = bMessage
      ? bMessage.split(/(?=✓|Lifecycle simulation failed)/).find((s) => /Full Autonomous Lifecycle Complete|Lifecycle simulation failed/.test(s)) ?? bMessage
      : null;
    ev("");
    ev(`B dock result message: ${J(bResult, 900)}`);
    await shot(pageB, "remediation-qa12-04-dock-result-B.png");

    const aAfter = await headerState(pageA);
    ev(`A after full state: kpi="${aAfter.kpi}" marker=${aAfter.marker} url=${aAfter.url} stage=${aAfter.activeStage}`);
    await shot(pageA, "remediation-qa12-05-A-after-no-refresh.png");
    const after = await counts("after");

    const changed = aAfter.header !== aBefore.header || aAfter.kpi !== aBefore.kpi;
    const noReload = aAfter.marker === aBefore.marker;
    ev("");
    ev(`REALTIME VERDICT: A changed=${changed} no-reload(marker preserved)=${noReload} latency=${aChange?.atMs}ms`);
    summary.realtime = {
      targetPkg,
      bResult,
      aBefore: { kpi: aBefore.kpi, marker: aBefore.marker, header: aBefore.header },
      aAfter: { kpi: aAfter.kpi, marker: aAfter.marker, header: aAfter.header },
      aChangeAtMs: aChange?.atMs ?? null,
      aChanged: changed,
      aNoReload: noReload,
      backendBefore: before,
      backendAfter: after,
    };

    // ---------- LIFECYCLE SPOT-CHECK (context B) ----------
    ev("");
    ev("=== LIFECYCLE SPOT-CHECK (on B) ===");
    await clickButtonByText(pageB, "Close Dock");
    await delay(800);

    // 1. Leveling matrix numbers
    await clickTab(pageB, "Bid Leveling");
    await delay(2500);
    const levelingText = await mainText(pageB, 6000);
    const dollarMatches = levelingText.match(/\$[\d,]{4,}/g) || [];
    const levelingHasAdjust = /Adjust Leveling/.test(levelingText);
    const levelingHasLocked = /Leveling Locked|Leveling locked/.test(levelingText);
    const levelingHasAwarded = /Awarded/i.test(levelingText);
    ev(`leveling: dollars=${dollarMatches.length} sample=${J(dollarMatches.slice(0, 8), 200)} adjustBtn=${levelingHasAdjust} locked=${levelingHasLocked} awarded=${levelingHasAwarded}`);
    ev(`leveling sample: ${J(levelingText.slice(0, 1200), 1200)}`);
    await shot(pageB, "remediation-qa12-06-leveling-after-dock.png");
    summary.lifecycle = { leveling: { dollarMatches: dollarMatches.slice(0, 12), adjustBtn: levelingHasAdjust, locked: levelingHasLocked, awarded: levelingHasAwarded } };

    // 2. Contracts: A401 visible + execute
    await clickTab(pageB, "Subcontracts");
    await delay(2500);
    const contractsBefore = await mainText(pageB, 5000);
    const a401Match = contractsBefore.match(/A401-[0-9A-Z-]+/g);
    const hasRecordExecution = /Record Execution Status/.test(contractsBefore);
    const hasPendingExecution = /Pending Execution/.test(contractsBefore);
    ev(`contracts: A401 numbers=${J(a401Match, 200)} recordExecutionBtn=${hasRecordExecution} pendingExecution=${hasPendingExecution}`);
    ev(`contracts sample: ${J(contractsBefore.slice(0, 1000), 1000)}`);
    await shot(pageB, "remediation-qa12-07-contracts-a401-pending.png");
    summary.lifecycle.contractsBefore = { a401: a401Match, recordExecutionBtn: hasRecordExecution, pendingExecution: hasPendingExecution };

    let executeFlow = null;
    if (hasRecordExecution) {
      const clickExec = await clickButtonByText(pageB, "Record Execution Status");
      await delay(900);
      const dialogVisible = await pageB.evaluate(() => Boolean(document.querySelector('[role="alertdialog"]')));
      const dialogText = await pageB.evaluate(() => {
        const d = document.querySelector('[role="alertdialog"]');
        return d ? d.innerText.replace(/\s+/g, " ").trim() : null;
      });
      ev(`execute click=${J(clickExec, 200)} confirmDialog=${dialogVisible} text="${dialogText}"`);
      let confirmClick = null;
      if (dialogVisible) {
        confirmClick = await clickButtonByText(pageB, "Record execution", true);
        ev(`confirm click: ${J(confirmClick, 200)}`);
        await delay(2600);
      }
      const contractsAfter = await mainText(pageB, 5000);
      const hasExecuted = /Execution Status Recorded/.test(contractsAfter);
      const stillPending = /Pending Execution/.test(contractsAfter);
      ev(`after execute: executed=${hasExecuted} stillPending=${stillPending}`);
      await shot(pageB, "remediation-qa12-08-contracts-executed.png");
      executeFlow = { dialogVisible, dialogText, confirmClick, hasExecuted, stillPending };
    } else {
      ev("execute flow SKIPPED: no Record Execution Status button found");
    }
    summary.lifecycle.executeFlow = executeFlow;

    // 3. Leveling locked after execution
    await clickTab(pageB, "Bid Leveling");
    await delay(2500);
    const levelingAfter = await mainText(pageB, 6000);
    const lockedAfter = /Leveling Locked|Leveling locked/.test(levelingAfter);
    const disabledAdjust = await pageB.evaluate(() => {
      const btns = [...document.querySelectorAll("button")];
      const b = btns.find((x) => /Adjust Leveling|Leveling Locked/.test(x.textContent || ""));
      return b ? { text: (b.textContent || "").trim(), disabled: b.disabled, title: b.getAttribute("title") } : null;
    });
    ev(`leveling after execute: locked=${lockedAfter} adjustBtnState=${J(disabledAdjust, 300)}`);
    await shot(pageB, "remediation-qa12-09-leveling-locked.png");
    summary.lifecycle.levelingAfter = { locked: lockedAfter, adjustBtnState: disabledAdjust };

    // 4. Audit stream
    await clickTab(pageB, "Live Activity Audit");
    await delay(2500);
    const auditText = await mainText(pageB, 8000);
    const auditEventHints = [
      "Project",
      "Trade Package",
      "Award",
      "Agreement",
      "Execution",
      "RFI",
      "Bid",
      "Lifecycle",
    ].filter((k) => new RegExp(k, "i").test(auditText));
    ev(`audit: hints=${J(auditEventHints)}`);
    ev(`audit sample: ${J(auditText.slice(0, 1500), 1500)}`);
    await shot(pageB, "remediation-qa12-10-audit-after-lifecycle.png");
    summary.lifecycle.audit = { hints: auditEventHints, sample: auditText.slice(0, 2000) };

    const afterLifecycle = await counts("after-lifecycle");
    summary.lifecycle.backendAfterLifecycle = afterLifecycle;

    const sA = await diagSummary(dA);
    const sB = await diagSummary(dB);
    ev("");
    ev(`A diag: errors=${sA.consoleErrors.length} warnings=${sA.consoleWarnings.length} pageErrors=${sA.pageErrors.length} failedReq=${sA.failedRequests.length}`);
    ev(`B diag: errors=${sB.consoleErrors.length} warnings=${sB.consoleWarnings.length} pageErrors=${sB.pageErrors.length} failedReq=${sB.failedRequests.length}`);
    for (const e of sA.consoleErrors) ev(`  A ERROR: ${e}`);
    for (const w of sA.consoleWarnings) ev(`  A WARN : ${w}`);
    for (const e of sB.consoleErrors) ev(`  B ERROR: ${e}`);
    for (const w of sB.consoleWarnings) ev(`  B WARN : ${w}`);
    summary.aDiag = sA;
    summary.bDiag = sB;

    fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa12-realtime-lifecycle.json"), JSON.stringify(summary, null, 2), "utf8");
    writeLog("remediation-qa12-realtime-lifecycle.txt", LOG);
    console.log("Wrote evidence.");
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error("FATAL", e);
  try {
    writeLog("remediation-qa12-realtime-lifecycle.txt", LOG.concat([`FATAL: ${e?.stack || e}`]));
  } catch {}
  process.exit(1);
});