// QA-14 extras: dead-end CTA check, clash-content consistency observation, final demo baseline.
// Usage: node scripts/qa-rem/qa14-extras.mjs
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { launchBrowser, EVIDENCE_DIR, BASE_URL, waitForAppReady, shot, delay } from "./qa1-lib.mjs";

const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(BACKEND);
const EMPTY_TAG = `QA-REM-QA14-X-${Date.now()}`;

const LOG = [];
const OUT = { startedAt: new Date().toISOString(), items: {} };
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};
const delay250 = () => delay(250);

async function bodyHas(page, text) {
  return page.evaluate((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), text);
}
async function dismissTour(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button[title]")].find((x) => /Close Demo Tour|Close Teleprompter/i.test(x.getAttribute("title") || ""));
    if (b) b.click();
  });
  await delay(200);
}
async function clickTab(page, label) {
  const ok = await page.evaluate((lbl) => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim().includes(lbl));
    if (!btn) return false;
    btn.click();
    return true;
  }, label);
  await delay(500);
  return ok;
}

async function main() {
  ev("=== QA-14 EXTRAS ===");
  ev(`UTC: ${new Date().toISOString()}`);
  ev("");

  // ---- Observation O1: both-packages fixture with ZERO bids still shows 4 seeded clashes ----
  const o1 = await client.mutation("projects:createProject", {
    title: `${EMPTY_TAG}-noBids`, location: "Austin, TX", projectType: "commercial QA", estBudget: 2000000,
    targetCompletionWeeks: 30, specDocumentText: "QA-14 consistency observation fixture.", isDemoProject: false,
  });
  await client.mutation("tradePackages:createTradePackage", {
    projectId: o1, csiDivision: "26 00 00", tradeName: "QA-14 Obs Electrical", budgetEstimate: 900000,
    scopeSummary: "obs elec", mandatoryInclusions: [], bidDeadline: "2026-12-31",
  });
  await client.mutation("tradePackages:createTradePackage", {
    projectId: o1, csiDivision: "23 00 00", tradeName: "QA-14 Obs HVAC", budgetEstimate: 700000,
    scopeSummary: "obs hvac", mandatoryInclusions: [], bidDeadline: "2026-12-31",
  });
  const bidsO1 = await client.query("bids:listAllProjectBids", { projectId: o1 });
  const clashO1 = await client.query("coordination:detectCrossTradeClashes", { projectId: o1 });
  OUT.observation = {
    projectWithBothPackagesAndZeroBids: { bidCount: bidsO1.length, activeClashes: clashO1.summary.activeClashesCount, doubleBuys: clashO1.doubleBuys.length, scopeVoids: clashO1.scopeVoids.length, sampleCard: clashO1.doubleBuys[0]?.title, sampleDivisions: [clashO1.doubleBuys[0]?.primaryTradeDivision, clashO1.doubleBuys[0]?.secondaryTradeDivision] },
  };
  ev(`[O1] 26+23 packages with 0 bids -> active=${clashO1.summary.activeClashesCount} (${clashO1.doubleBuys.length} double-buys, ${clashO1.scopeVoids.length} voids); cards claim both trades priced although bidCount=${bidsO1.length}`);
  ev("");

  // ---- Observation O2: empty-project CTA (report line 97) ----
  const o2 = await client.mutation("projects:createProject", {
    title: EMPTY_TAG, location: "Austin, TX", projectType: "commercial QA", estBudget: 1200000,
    targetCompletionWeeks: 26, specDocumentText: "QA-14 empty CTA fixture.", isDemoProject: false,
  });
  const { browser } = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto(`${BASE_URL}/?project=${o2}&tab=discovery`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page, 45000);
    await dismissTour(page);
    await delay(800);
    const ctaPresent = await bodyHas(page, "Go to CSI Scoping");
    await shot(page, "remediation-qa14-cta-empty-discovery.png");
    let ctaNavigated = null;
    if (ctaPresent) {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Go to CSI Scoping"));
        if (b) b.click();
      });
      await delay(700);
      ctaNavigated = await page.evaluate(() => new URLSearchParams(window.location.search).get("tab"));
    }
    OUT.cta = { ctaPresent, ctaNavigatedTab: ctaNavigated };
    OUT.items.empty_state_cta = Boolean(ctaPresent && ctaNavigated === "packages");
    ev(`[O2] discovery empty state CTA present=${ctaPresent}; after click tab=${ctaNavigated}`);
  } finally {
    await browser.close();
    await client.mutation("projects:deleteProject", { projectId: o2 }).catch(() => {});
    await client.mutation("projects:deleteProject", { projectId: o1 }).catch(() => {});
  }
  ev("");

  // ---- Final demo baseline re-check ----
  const baseline = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa14-baseline.json"), "utf8"));
  const demoId = baseline.demoSnapshot.id;
  const snap = async (projectId) => {
    const project = await client.query("projects:getProject", { projectId });
    const packages = await client.query("tradePackages:listByProject", { projectId });
    const bids = await client.query("bids:listAllProjectBids", { projectId });
    const agreements = await client.query("agreements:listAgreements", { projectId });
    const logs = await client.query("auditLogs:listRecentLogs", { projectId, limit: 1000 });
    const contractors = await client.query("contractors:listByProject", { projectId });
    const files = await client.query("files:listFilesByProject", { projectId });
    return {
      id: projectId, title: project?.title, location: project?.location, estBudget: project?.estBudget,
      targetCompletionWeeks: project?.targetCompletionWeeks, isDemoProject: project?.isDemoProject,
      packageCount: packages.length, bidCount: bids.length, agreementCount: agreements.length,
      auditLogCount: logs.length, contractorCount: contractors.length, fileCount: files.length,
      packageIds: packages.map((p) => p._id).sort(), bidIds: bids.map((b) => b._id).sort(),
      agreementIds: agreements.map((a) => a._id).sort(), contractorIds: contractors.map((c) => c._id).sort(),
      fileNames: files.map((f) => f.fileName).sort(),
    };
  };
  const demoNow = await snap(demoId);
  const keys = ["title", "location", "estBudget", "targetCompletionWeeks", "isDemoProject", "packageCount", "bidCount", "agreementCount", "auditLogCount", "contractorCount", "fileCount"];
  const mismatches = keys.filter((k) => demoNow[k] !== baseline.demoSnapshot[k]);
  const idsChanged =
    JSON.stringify(demoNow.packageIds) !== JSON.stringify(baseline.demoSnapshot.packages.map((p) => p.id).sort()) ||
    JSON.stringify(demoNow.bidIds) !== JSON.stringify(baseline.demoSnapshot.bidIds) ||
    JSON.stringify(demoNow.agreementIds) !== JSON.stringify(baseline.demoSnapshot.agreementIds) ||
    JSON.stringify(demoNow.contractorIds) !== JSON.stringify(baseline.demoSnapshot.contractorIds);
  const clashNow = await client.query("coordination:detectCrossTradeClashes", { projectId: demoId });
  const demoOk = mismatches.length === 0 && !idsChanged && clashNow.summary.activeClashesCount === baseline.demoClash.summary.activeClashesCount;
  OUT.finalDemo = { mismatches, idsChanged, clashActiveNow: clashNow.summary.activeClashesCount, baselineClashActive: baseline.demoClash.summary.activeClashesCount, ok: demoOk };
  OUT.items.final_demo_baseline = demoOk;
  ev(`[final] demo mismatches=${JSON.stringify(mismatches)} idsChanged=${idsChanged} clashes now=${clashNow.summary.activeClashesCount} baseline=${baseline.demoClash.summary.activeClashesCount}`);

  const projects = await client.query("projects:listProjects", {});
  OUT.finalProjects = projects.map((p) => p.title);
  const mine = projects.filter((p) => p.title.startsWith("QA-REM-QA14"));
  OUT.items.my_fixtures_gone = mine.length === 0;
  ev(`[final] projects=${JSON.stringify(OUT.finalProjects)}; my QA14 fixtures left=${mine.length}`);

  const failed = Object.entries(OUT.items).filter(([, v]) => !v).map(([k]) => k);
  OUT.finishedAt = new Date().toISOString();
  OUT.overall = failed.length === 0 ? "PASS" : "FAIL";
  ev(`ITEMS: ${Object.entries(OUT.items).map(([k, v]) => `${k}=${v ? "PASS" : "FAIL"}`).join(" | ")}`);
  ev(`OVERALL: ${OUT.overall}`);

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa14-extras.txt"), LOG.join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa14-extras.json"), JSON.stringify(OUT, null, 2), "utf8");
  console.log("Wrote extras evidence.");
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("FATAL", e);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa14-extras.txt"), LOG.join("\n") + `\nFATAL: ${e?.stack || e?.message}\n`, "utf8");
  process.exit(1);
});