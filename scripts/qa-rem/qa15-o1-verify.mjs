// QA-15 Item 1: O1 fix verification (round 7, independent).
// Fixture: Div 26 + Div 23 packages, ZERO bids -> honest empty state (UI + backend).
// Then add ONE bid to Div 26 -> 2 double-buys + 2 scope voids (active=4), UI re-check.
// Also: demo project still shows its 4 active clashes.
// Usage: node scripts/qa-rem/qa15-o1-verify.mjs
import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { launchBrowser, EVIDENCE_DIR, BASE_URL, waitForAppReady, shot, delay } from "./qa1-lib.mjs";

const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(BACKEND);
const TAG = `QA-REM-QA15-O1-${Date.now()}`;

const LOG = [];
const OUT = {
  tag: TAG,
  site: BASE_URL,
  backend: BACKEND,
  startedAt: new Date().toISOString(),
  items: {},
  steps: {},
};
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};

async function dismissTour(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button[title]")].find((x) =>
      /Close Demo Tour|Close Teleprompter/i.test(x.getAttribute("title") || "")
    );
    if (b) b.click();
  });
  await delay(250);
}

async function scrapeCoordination(page) {
  return page.evaluate(() => {
    const txt = document.body.innerText;
    const countOcc = (needle) => txt.split(needle).length - 1;
    const kpi = (label) => {
      const cards = [...document.querySelectorAll("div.bg-slate-900")].filter(
        (c) => c.textContent.includes(label) && c.textContent.length < 320
      );
      if (!cards.length) return null;
      const c = cards[0];
      const value = c.querySelector("div.font-mono.font-bold")?.textContent?.trim() || null;
      return { value, full: c.textContent.replace(/\s+/g, " ").trim() };
    };
    const headerBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Scope Clash"));
    const headerSpans = headerBtn ? [...headerBtn.querySelectorAll("span")].map((s) => s.textContent.trim()) : null;
    const headerFull = headerBtn ? headerBtn.textContent.replace(/\s+/g, " ").trim() : null;
    return {
      urlTab: new URLSearchParams(window.location.search).get("tab"),
      headerSpans,
      headerFull,
      doubleBuyCards: countOcc("Redundant Double-Buy Detected") + countOcc("Credit Deducted & Leveled"),
      activeDoubleBuyDetected: countOcc("Redundant Double-Buy Detected"),
      deductedCards: countOcc("Credit Deducted & Leveled"),
      voidCards: countOcc("Critical Scope Void Detected") + countOcc("Scope Assigned & Covered"),
      activeVoidDetected: countOcc("Critical Scope Void Detected"),
      assignedCards: countOcc("Scope Assigned & Covered"),
      kpiDoubleBuy: kpi("Redundant Double-Buys"),
      kpiVoids: kpi("Unassigned Scope Voids"),
      kpiRisk: kpi("Coordination Risk Level"),
      hasUndefined: /undefined/.test(txt),
      hasNaN: /NaN/.test(txt),
      evaluatedLine: (txt.match(/Autonomous scan across CSI trade proposals \([^)]*\)/) || [null])[0],
      bodySample: txt.replace(/\s+/g, " ").slice(0, 3000),
    };
  });
}

async function waitRealtimeClashes(page, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const n = await page.evaluate(() => (document.body.innerText.split("Redundant Double-Buy Detected").length - 1));
    if (n >= 2) return (Date.now() - t0) / 1000;
    await delay(400);
  }
  return null;
}

async function main() {
  ev("=== QA-15 ITEM 1: O1 VERIFICATION ===");
  ev(`UTC: ${new Date().toISOString()}`);
  ev(`Fixture: ${TAG}`);
  ev("");

  // --- fixture: both packages, zero bids ---
  const projectId = await client.mutation("projects:createProject", {
    title: TAG,
    location: "Austin, TX",
    projectType: "QA round 7 O1",
    estBudget: 3000000,
    targetCompletionWeeks: 40,
    specDocumentText: "QA-15 O1 verification fixture (Div 26 + 23, zero bids).",
    isDemoProject: false,
  });
  const elecPkgId = await client.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision: "26 00 00",
    tradeName: "QA-15 Electrical",
    budgetEstimate: 1250000,
    scopeSummary: "QA-15 electrical scope",
    mandatoryInclusions: ["Code compliance"],
    bidDeadline: "2026-10-31",
  });
  const hvacPkgId = await client.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision: "23 00 00",
    tradeName: "QA-15 HVAC",
    budgetEstimate: 1500000,
    scopeSummary: "QA-15 mechanical scope",
    mandatoryInclusions: ["Code compliance"],
    bidDeadline: "2026-10-31",
  });
  const bids0 = await client.query("bids:listAllProjectBids", { projectId });
  const clash0 = await client.query("coordination:detectCrossTradeClashes", { projectId });
  ev(`[setup] project=${projectId} elec=${elecPkgId} hvac=${hvacPkgId} bids=${bids0.length}`);
  ev(
    `[backend zero-bid] doubleBuys=${clash0.doubleBuys.length} scopeVoids=${clash0.scopeVoids.length} active=${clash0.summary.activeClashesCount} provider=${clash0.provider} model=${clash0.model}`
  );
  OUT.steps.backendZeroBid = {
    doubleBuys: clash0.doubleBuys.length,
    scopeVoids: clash0.scopeVoids.length,
    active: clash0.summary.activeClashesCount,
    provider: clash0.provider,
    model: clash0.model,
  };
  OUT.items.backend_zero_bid_empty =
    clash0.doubleBuys.length === 0 && clash0.scopeVoids.length === 0 && clash0.summary.activeClashesCount === 0;

  const { browser, executablePath } = await launchBrowser();
  ev(`[browser] ${executablePath}`);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto(`${BASE_URL}/?project=${projectId}&tab=coordination`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page, 45000);
    await dismissTour(page);
    await delay(1200);
    const ui0 = await scrapeCoordination(page);
    await shot(page, "remediation-qa15-o1-01-ui-empty.png");
    ev(`[UI zero-bid] urlTab=${ui0.urlTab} header="${ui0.headerFull}"`);
    ev(
      `[UI zero-bid] cards: doubleBuy=${ui0.doubleBuyCards} void=${ui0.voidCards} | KPI double=${ui0.kpiDoubleBuy?.value} voids=${ui0.kpiVoids?.value} risk=${ui0.kpiRisk?.value}`
    );
    ev(
      `[UI zero-bid] kpi detail: "${ui0.kpiDoubleBuy?.full}" | "${ui0.kpiVoids?.full}" | "${ui0.kpiRisk?.full}"`
    );
    ev(`[UI zero-bid] undefined=${ui0.hasUndefined} NaN=${ui0.hasNaN} evaluated="${ui0.evaluatedLine}"`);
    OUT.steps.uiZeroBid = ui0;
    OUT.items.ui_zero_bid_honest_empty =
      ui0.urlTab === "coordination" &&
      ui0.doubleBuyCards === 0 &&
      ui0.voidCards === 0 &&
      (ui0.headerSpans || []).includes("Clear") &&
      /0 items awaiting resolution/.test(ui0.kpiRisk?.full || "") &&
      ui0.kpiDoubleBuy?.value === "$0" &&
      ui0.kpiVoids?.value === "$0" &&
      !ui0.hasUndefined &&
      !ui0.hasNaN;
    ev("");

    // --- add ONE bid to Div 26 ---
    const contractorId = await client.mutation("contractors:createContractor", {
      tradePackageId: elecPkgId,
      companyName: "QA-15 Electric",
      contactEmail: "qa15.o1@tradepulse-pro.test",
      phone: "+1 (512) 555-0115",
      licenseNumber: "QA15-O1-01",
      licenseStatus: "Active / Verified",
      sourceUrl: "https://tradepulse-pro.test/qa15",
      rfqStatus: "invited",
    });
    const bidId = await client.mutation("bids:submitDirectBid", {
      tradePackageId: elecPkgId,
      contractorId,
      subcontractorName: "QA-15 Electric",
      baseBidAmount: 1180000,
    });
    const bids1 = await client.query("bids:listAllProjectBids", { projectId });
    const clash1 = await client.query("coordination:detectCrossTradeClashes", { projectId });
    ev(
      `[bid added] bid=${bidId} totalBids=${bids1.length}; backend clash: doubleBuys=${clash1.doubleBuys.length} voids=${clash1.scopeVoids.length} active=${clash1.summary.activeClashesCount}`
    );
    OUT.steps.backendAfterBid = {
      bidId,
      totalBids: bids1.length,
      doubleBuys: clash1.doubleBuys.length,
      scopeVoids: clash1.scopeVoids.length,
      active: clash1.summary.activeClashesCount,
      doubleBuyStatuses: clash1.doubleBuys.map((d) => `${d.id}:${d.status}`),
      voidStatuses: clash1.scopeVoids.map((v) => `${v.id}:${v.status}`),
      totalDoubleBuyExposure: clash1.summary.totalDoubleBuyExposure,
      totalScopeVoidExposure: clash1.summary.totalScopeVoidExposure,
    };
    OUT.items.backend_after_bid_clashes =
      clash1.doubleBuys.length === 2 &&
      clash1.scopeVoids.length === 2 &&
      clash1.summary.activeClashesCount === 4;

    // realtime (no reload) first
    const secs = await waitRealtimeClashes(page, 15000);
    let ui1realtime = null;
    if (secs !== null) {
      ui1realtime = await scrapeCoordination(page);
      ev(
        `[UI after bid - REALTIME] updated in ${secs?.toFixed?.(1)}s; cards doubleBuy=${ui1realtime.doubleBuyCards} void=${ui1realtime.voidCards} header="${ui1realtime.headerFull}" risk=${ui1realtime.kpiRisk?.value}`
      );
    } else {
      ev("[UI after bid] realtime update NOT observed within 15s; reloading");
    }
    OUT.steps.uiAfterBidRealtime = ui1realtime ? { seconds: secs, ui: ui1realtime } : { seconds: null, ui: null };

    // reload for deterministic final scrape + screenshot
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForAppReady(page, 45000);
    await dismissTour(page);
    await delay(1200);
    const ui1 = await scrapeCoordination(page);
    await shot(page, "remediation-qa15-o1-02-ui-clashes.png");
    ev(`[UI after bid - reload] urlTab=${ui1.urlTab} header="${ui1.headerFull}"`);
    ev(
      `[UI after bid - reload] cards: doubleBuy=${ui1.doubleBuyCards} void=${ui1.voidCards} | KPI double=${ui1.kpiDoubleBuy?.value} voids=${ui1.kpiVoids?.value} risk=${ui1.kpiRisk?.value}`
    );
    ev(`[UI after bid - reload] kpi detail: "${ui1.kpiDoubleBuy?.full}" | "${ui1.kpiVoids?.full}" | "${ui1.kpiRisk?.full}"`);
    OUT.steps.uiAfterBidReload = ui1;
    OUT.items.ui_after_bid_clashes =
      ui1.doubleBuyCards === 2 &&
      ui1.voidCards === 2 &&
      (ui1.headerSpans || []).includes("4 Clashes") &&
      /4 items awaiting resolution/.test(ui1.kpiRisk?.full || "") &&
      ui1.kpiDoubleBuy?.value === "$50,500" &&
      ui1.kpiVoids?.value === "$46,500" &&
      !ui1.hasUndefined &&
      !ui1.hasNaN;
    OUT.items.ui_realtime_after_bid = secs !== null;
    ev("");

    // --- demo project regression ---
    const projects = await client.query("projects:listProjects", {});
    const demo = projects.find((p) => p.isDemoProject);
    const demoClash = await client.query("coordination:detectCrossTradeClashes", { projectId: demo._id });
    await page.goto(`${BASE_URL}/?project=${demo._id}&tab=coordination`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page, 45000);
    await dismissTour(page);
    await delay(1200);
    const uiDemo = await scrapeCoordination(page);
    await shot(page, "remediation-qa15-o1-03-demo-clashes.png");
    ev(
      `[demo] backend doubleBuys=${demoClash.doubleBuys.length} voids=${demoClash.scopeVoids.length} active=${demoClash.summary.activeClashesCount}`
    );
    ev(
      `[demo] UI cards doubleBuy=${uiDemo.doubleBuyCards} void=${uiDemo.voidCards} header="${uiDemo.headerFull}" risk=${uiDemo.kpiRisk?.value}`
    );
    OUT.steps.demo = {
      backend: {
        doubleBuys: demoClash.doubleBuys.length,
        scopeVoids: demoClash.scopeVoids.length,
        active: demoClash.summary.activeClashesCount,
        statuses: [
          ...demoClash.doubleBuys.map((d) => `${d.id}:${d.status}`),
          ...demoClash.scopeVoids.map((v) => `${v.id}:${v.status}`),
        ],
      },
      ui: uiDemo,
    };
    OUT.items.demo_still_4_active =
      demoClash.doubleBuys.length === 2 &&
      demoClash.scopeVoids.length === 2 &&
      demoClash.summary.activeClashesCount === 4 &&
      uiDemo.doubleBuyCards === 2 &&
      uiDemo.voidCards === 2 &&
      (uiDemo.headerSpans || []).includes("4 Clashes");
  } finally {
    await browser.close();
  }

  // NOTE: fixture intentionally kept for regression pass (item 2); deleted in qa15-final.
  OUT.cleanup = "deferred to qa15-final";
  ev("");
  ev(`fixture projectId kept for regression: ${projectId}`);
  ev(`fixture elecPackageId: ${elecPkgId}`);
  ev(`fixture hvacPackageId: ${hvacPkgId}`);

  const failed = Object.entries(OUT.items).filter(([, v]) => !v).map(([k]) => k);
  OUT.finishedAt = new Date().toISOString();
  OUT.failedItems = failed;
  OUT.overall = failed.length === 0 ? "PASS" : "FAIL";
  ev("");
  ev(`ITEMS: ${Object.entries(OUT.items).map(([k, v]) => `${k}=${v ? "PASS" : "FAIL"}`).join(" | ")}`);
  ev(`OVERALL: ${OUT.overall}${failed.length ? ` (failed: ${failed.join(", ")})` : ""}`);

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa15-o1-verify.txt"), LOG.join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa15-o1-verify.json"), JSON.stringify(OUT, null, 2), "utf8");
  console.log("Wrote O1 evidence.");
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("FATAL", e);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "remediation-qa15-o1-verify.txt"),
    LOG.join("\n") + `\nFATAL: ${e?.stack || e?.message}\n`,
    "utf8"
  );
  process.exit(1);
});