// QA-12 final integrity probe (pre-cleanup):
//  - double-execute idempotency on the fixture agreement (server returns success, no duplicate audit log)
//  - demo UI numbers vs backend (KPI/badges/clashes) consistency
//  - selection durability across reload (SEL-A re-verify)
// Usage: node scripts/qa-rem/qa12-final-integrity.mjs
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
const baseline = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa12-baseline.json"), "utf8"));

const LOG = [];
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};
const J = (o, max = 800) => {
  const s = JSON.stringify(o);
  return s.length > max ? s.slice(0, max) + "…" : s;
};

async function mainText(page, max = 3000) {
  return page.evaluate((max) => {
    const m = document.querySelector("main");
    return m ? m.innerText.replace(/\s+/g, " ").trim().slice(0, max) : "";
  }, max);
}

async function run() {
  const { browser } = await launchBrowser();
  const summary = { at: new Date().toISOString() };
  try {
    ev("=== QA-12 FINAL INTEGRITY (pre-cleanup) ===");
    ev(`UTC: ${new Date().toISOString()}`);
    ev("");

    // ---- A. double-execute idempotency ----
    const agreements = await backend.query("agreements:listAgreements", { projectId: fixture.projectId });
    const logsBefore = await backend.query("auditLogs:listRecentLogs", { projectId: fixture.projectId, limit: 500 });
    ev(`fixture agreements: ${J(agreements.map((a) => ({ id: a._id, status: a.status, num: a.agreementNumber })))}`);
    const executedAgr = agreements.find((a) => a.status === "executed");
    let doubleExec = null;
    if (executedAgr) {
      try {
        const r = await backend.mutation("agreements:executeAgreement", { agreementId: executedAgr._id });
        const logsAfter = await backend.query("auditLogs:listRecentLogs", { projectId: fixture.projectId, limit: 500 });
        doubleExec = { ok: true, result: r, logsBefore: logsBefore.length, logsAfter: logsAfter.length, noDuplicateLog: logsAfter.length === logsBefore.length };
      } catch (err) {
        doubleExec = { ok: false, message: err?.message, data: err?.data };
      }
      ev(`double-execute: ${J(doubleExec, 400)}`);
    } else {
      ev("double-execute SKIPPED: no executed agreement found");
    }
    summary.doubleExecute = doubleExec;

    // ---- B. demo UI vs backend consistency ----
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.setDefaultTimeout(30000);
    const d = attachDiagnostics(page);
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(2600);
    const selDemo = await getSelectorState(page);
    ev(`demo landing selected: "${selDemo?.selectedText}"`);
    const demoUi = await page.evaluate(() => {
      const header = document.querySelector("header");
      const main = document.querySelector("main");
      const ht = header ? header.innerText.replace(/\s+/g, " ") : "";
      const mt = main ? main.innerText.replace(/\s+/g, " ") : "";
      const badge = (label) => {
        const m = ht.match(new RegExp("(\\d+)\\s*" + label, "i"));
        return m ? Number(m[1]) : null;
      };
      return {
        pkgBadge: badge("Pkg"),
        subBadge: badge("Sub"),
        rfiBadge: badge("RFI"),
        bidBadge: badge("Bid"),
        clashBadge: /(\\d+)\\s*Clashes?/.test(ht) ? Number(ht.match(/(\d+)\s*Clashes?/)[1]) : 0,
        clashClear: /Clear/.test(ht),
        kpi: (mt.match(/Buyout:\s*\d+\/\d+\s*Awarded/) || [null])[0],
        headerSample: ht.slice(0, 500),
      };
    });
    ev(`demo UI: ${J(demoUi, 700)}`);
    await shot(page, "remediation-qa12-16-demo-landing.png");

    const demoBackend = await backend.query("projects:getDemoProject", {});
    const demoPkgs = await backend.query("tradePackages:listByProject", { projectId: demoBackend._id });
    let demoBids = 0;
    for (const p of demoPkgs) {
      demoBids += (await backend.query("bids:listByPackage", { tradePackageId: p._id })).length;
    }
    const demoAgreements = await backend.query("agreements:listAgreements", { projectId: demoBackend._id });
    const demoClash = await backend.query("coordination:detectCrossTradeClashes", { projectId: demoBackend._id });
    const demoBackendCounts = {
      packages: demoPkgs.length,
      bids: demoBids,
      agreements: demoAgreements.length,
      clashes: (demoClash?.doubleBuys?.length ?? 0) + (demoClash?.scopeVoids?.length ?? 0),
    };
    ev(`demo backend: ${J(demoBackendCounts)}`);
    const consistent = {
      pkg: demoUi.pkgBadge === demoBackendCounts.packages,
      bid: demoUi.bidBadge === demoBackendCounts.bids,
      award: demoUi.kpi === `Buyout: ${demoAgreements.length}/${demoPkgs.length} Awarded`,
      clash: demoUi.clashBadge === demoBackendCounts.clashes,
    };
    ev(`demo UI-vs-backend consistency: ${J(consistent)}`);
    summary.demoConsistency = { ui: demoUi, backend: demoBackendCounts, checks: consistent };

    // ---- C. selection durability across reload (SEL-A re-verify) ----
    await selectProjectByTitle(page, fixture.tag);
    await delay(2600);
    const selBefore = await getSelectorState(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(2800);
    const selAfter = await getSelectorState(page);
    const durable = Boolean(selAfter?.selectedText?.includes(fixture.tag));
    const urlAfter = page.url();
    ev(`selection before reload: "${selBefore?.selectedText}" -> after reload: "${selAfter?.selectedText}" durable=${durable} url=${urlAfter}`);
    await shot(page, "remediation-qa12-17-selection-after-reload.png");
    summary.selectionDurability = { before: selBefore?.selectedText, after: selAfter?.selectedText, durable };

    const diag = {
      consoleErrors: d.consoleLogs.filter((l) => l.type === "error").map((l) => l.text),
      consoleWarnings: d.consoleLogs.filter((l) => l.type === "warning").map((l) => l.text),
      pageErrors: d.pageErrors,
      failedRequests: d.failedRequests,
    };
    ev(`diag: ${J(diag, 500)}`);
    summary.diag = diag;

    // ---- D. fixtures present before cleanup ----
    const projects = await backend.query("projects:listProjects", {});
    summary.projectsBeforeCleanup = projects.map((p) => ({ title: p.title, isDemo: Boolean(p.isDemoProject) }));
    ev(`projects before cleanup: ${J(summary.projectsBeforeCleanup.map((p) => p.title))}`);

    fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa12-final-integrity.json"), JSON.stringify(summary, null, 2), "utf8");
    writeLog("remediation-qa12-final-integrity.txt", LOG);
    await browser.close();
    console.log("Wrote evidence.");
  } catch (e) {
    writeLog("remediation-qa12-final-integrity.txt", LOG.concat([`FATAL: ${e?.stack || e}`]));
    await browser.close();
    process.exit(1);
  }
}

run();