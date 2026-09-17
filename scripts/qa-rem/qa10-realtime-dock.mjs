// QA-10 two-context realtime spot-check on the fixture project.
//  Context A: idle viewer (marker set to prove no reload).
//  Context B: opens Judge Dock and runs the full autonomous procurement lifecycle.
//  Assert: A's header badges/KPI update WITHOUT refresh; record B's message + backend counts.
// Usage: node scripts/qa-rem/qa10-realtime-dock.mjs
import { launchBrowser, attachDiagnostics, shot, waitForAppReady, delay, BASE_URL, writeLog, getSelectorState, selectProjectByTitle } from "./qa1-lib.mjs";
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const backend = new ConvexHttpClient(BACKEND);
const fixture = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa10-fixture.json"), "utf8"));

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
    auditLogs: logs.length,
    agreementStatuses: agreements.map((a) => a.status),
  };
  ev(`backend[${label}]: ${J(out, 400)}`);
  return out;
}

async function headerState(page) {
  return page.evaluate(() => {
    const header = document.querySelector("header");
    const main = document.querySelector("main");
    return {
      header: header ? header.innerText.replace(/\s+/g, " ").trim().slice(0, 700) : null,
      kpi: main ? (main.innerText.match(/Buyout:\s*\d+\/\d+\s*Awarded/) || [null])[0] : null,
      marker: window.__qa10Marker ?? null,
      url: location.href,
      activeStage: (() => {
        const sel = document.querySelector('select[aria-label="Navigate procurement stage"]');
        return sel ? sel.value : null;
      })(),
    };
  });
}

async function run() {
  const { browser } = await launchBrowser();
  try {
    ev("=== QA-10 TWO-CONTEXT REALTIME DOCK SPOT-CHECK ===");
    ev(`Base URL: ${BASE_URL}`);
    ev(`Fixture: ${fixture.tag} (${fixture.projectId})`);
    ev(`UTC: ${new Date().toISOString()}`);
    ev("");

    const before = await counts("before");

    const ctxA = await browser.createBrowserContext();
    const ctxB = await browser.createBrowserContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    pageA.setDefaultTimeout(25000);
    pageB.setDefaultTimeout(25000);
    const dA = attachDiagnostics(pageA);
    const dB = attachDiagnostics(pageB);

    await pageA.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(pageA);
    await delay(1500);
    await selectProjectByTitle(pageA, fixture.tag);
    await delay(3000);
    await pageA.evaluate(() => {
      window.__qa10Marker = "alive-" + Date.now();
    });
    const aBefore = await headerState(pageA);
    ev(`A selected: "${(await getSelectorState(pageA))?.selectedText}"`);
    ev(`A before: kpi="${aBefore.kpi}" marker=${aBefore.marker}`);
    ev(`A before header: ${J(aBefore.header, 600)}`);

    await pageB.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(pageB);
    await delay(1500);
    await selectProjectByTitle(pageB, fixture.tag);
    await delay(3000);
    ev(`B selected: "${(await getSelectorState(pageB))?.selectedText}"`);

    // B opens the dock
    const opened = await pageB.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("60s Judge Dock"));
      if (!b) return { ok: false };
      b.click();
      return { ok: true, text: b.textContent.trim() };
    });
    ev(`B dock open: ${J(opened, 200)}`);
    await pageB.waitForSelector('[role="dialog"]', { timeout: 15000 });
    await delay(800);
    await shot(pageB, "remediation-qa10-13-dock-open-B.png");
    const targetPkg = await pageB.evaluate(() => {
      const t = document.body.innerText.match(/Target CSI Trade Package:?\s*([^\n]+)/);
      return t ? t[1].trim() : null;
    });
    ev(`B dock target package: "${targetPkg}"`);

    // B triggers full cycle
    const clicked = await pageB.evaluate(() => {
      const btns = [...document.querySelectorAll("button")];
      const b = btns.find((x) => (x.textContent || "").includes("1-Click Run Full Autonomous Procurement Lifecycle"));
      if (!b) return { ok: false, available: btns.map((x) => (x.textContent || "").trim()).slice(0, 40) };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, disabled: b.disabled };
    });
    ev(`B full cycle click: ${J(clicked, 300)}`);

    // A polls for reactive change; B waits for completion message
    const t0 = Date.now();
    let aChange = null;
    let bMessage = null;
    let bRunning = false;
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
      bRunning = Boolean(await pageB.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Executing Full Autonomous Procurement Loop"));
        return Boolean(b);
      }));
      await delay(2000);
    }
    if (!aChange) {
      const state = await headerState(pageA);
      aChange = { atMs: Date.now() - t0, state, timedOut: true };
      ev(`A NO UPDATE observed within ${aChange.atMs}ms (timed out)`);
    }

    const msgMatch = bMessage ? bMessage.match(/[✓✗]?[^]*?(Full Autonomous Lifecycle Complete!|Lifecycle simulation failed:)[^]*?(?=Close Dock|$)/) : null;
    const bResult = bMessage
      ? bMessage
          .split(/(?=✓|Lifecycle simulation failed)/)
          .find((s) => /Full Autonomous Lifecycle Complete|Lifecycle simulation failed/.test(s)) ?? bMessage
      : null;
    ev("");
    ev(`B dock result message: ${J(bResult, 700)}`);
    await shot(pageB, "remediation-qa10-14-dock-result-B.png");

    const aAfter = await headerState(pageA);
    ev(`A after full state: kpi="${aAfter.kpi}" marker=${aAfter.marker} url=${aAfter.url} stage=${aAfter.activeStage}`);
    ev(`A header after: ${J(aAfter.header, 700)}`);
    await shot(pageA, "remediation-qa10-15-A-after-no-refresh.png");

    const after = await counts("after");

    const changed = aAfter.header !== aBefore.header || aAfter.kpi !== aBefore.kpi;
    const noReload = aAfter.marker === aBefore.marker;
    ev("");
    ev(`VERDICT: A changed=${changed} A no-reload(marker preserved)=${noReload} A change latency=${aChange?.atMs}ms`);
    ev(`backend deltas: bids ${before.bids}->${after.bids}, agreements ${before.agreements}->${after.agreements}, contractors ${before.contractors}->${after.contractors}, logs ${before.auditLogs}->${after.auditLogs}, packages ${before.packages}->${after.packages}`);
    ev(`A console errors=${dA.consoleLogs.filter((l) => l.type === "error").length} warnings=${dA.consoleLogs.filter((l) => l.type === "warning").length} pageErrors=${dA.pageErrors.length} failedReq=${dA.failedRequests.length}`);
    ev(`B console errors=${dB.consoleLogs.filter((l) => l.type === "error").length} warnings=${dB.consoleLogs.filter((l) => l.type === "warning").length} pageErrors=${dB.pageErrors.length} failedReq=${dB.failedRequests.length}`);
    for (const e of dA.consoleLogs.filter((l) => l.type === "error")) ev(`  A ERROR: ${e.text}`);
    for (const e of dB.consoleLogs.filter((l) => l.type === "error")) ev(`  B ERROR: ${e.text}`);

    const summary = {
      fixture: fixture.tag,
      targetPkg,
      bResult: bResult || null,
      aBefore: { kpi: aBefore.kpi, marker: aBefore.marker, header: aBefore.header },
      aAfter: { kpi: aAfter.kpi, marker: aAfter.marker, header: aAfter.header },
      aChangeAtMs: aChange?.atMs ?? null,
      aChanged: changed,
      aNoReload: noReload,
      backendBefore: before,
      backendAfter: after,
      aDiag: { errors: dA.consoleLogs.filter((l) => l.type === "error").map((l) => l.text), warnings: dA.consoleLogs.filter((l) => l.type === "warning").map((l) => l.text), pageErrors: dA.pageErrors, failedReq: dA.failedRequests },
      bDiag: { errors: dB.consoleLogs.filter((l) => l.type === "error").map((l) => l.text), warnings: dB.consoleLogs.filter((l) => l.type === "warning").map((l) => l.text), pageErrors: dB.pageErrors, failedReq: dB.failedRequests },
    };
    fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa10-realtime-dock.json"), JSON.stringify(summary, null, 2), "utf8");
    writeLog("remediation-qa10-realtime-dock.txt", LOG);
    console.log("Wrote evidence.");
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error("FATAL", e);
  writeLog("remediation-qa10-realtime-dock.txt", LOG.concat([`FATAL: ${e?.stack || e}`]));
  process.exit(1);
});