// QA-14 falsification spot-check of 3 remediation-report claims (from scratch):
//  CLAM-B (report line 99): clash resolution persists; deduct -> card "deducted", active 4->3;
//                           assign void -> "assigned", active 3->2; persists across reload (UI level).
//  CLAIM-C (report line 103): 8/8 demo document metadata bytes == served bytes (range claimed 2,665-3,179 B).
//  (CLAIM-A deep links/history is covered in qa14-browser-sweep.mjs.)
// Usage: node scripts/qa-rem/qa14-claims-spotcheck.mjs
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { launchBrowser, EVIDENCE_DIR, BASE_URL, waitForAppReady, shot, delay } from "./qa1-lib.mjs";

const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(BACKEND);
const TAG = `QA-REM-QA14-CLAIM-${Date.now()}`;

const LOG = [];
const OUT = { tag: TAG, startedAt: new Date().toISOString(), claims: {} };
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};

async function bodyHas(page, text) {
  return page.evaluate((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), text);
}
async function countText(page, text) {
  return page.evaluate((t) => {
    const lower = document.body.innerText.toLowerCase();
    const needle = t.toLowerCase();
    let count = 0;
    let idx = 0;
    while ((idx = lower.indexOf(needle, idx)) !== -1) {
      count += 1;
      idx += needle.length;
    }
    return count;
  }, text);
}
async function dismissTour(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button[title]")].find((x) => /Close Demo Tour|Close Teleprompter/i.test(x.getAttribute("title") || ""));
    if (b) b.click();
  });
  await delay(200);
}
async function waitForText(page, text, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await bodyHas(page, text)) return ((Date.now() - t0) / 1000).toFixed(1);
    await delay(250);
  }
  return null;
}

async function main() {
  ev("=== QA-14 CLAIMS SPOT-CHECK ===");
  ev(`UTC: ${new Date().toISOString()}`);
  ev("");

  // ---------- CLAIM-C: demo document bytes ----------
  const projects = await client.query("projects:listProjects", {});
  const demo = projects.find((p) => p.isDemoProject);
  const files = await client.query("files:listFilesByProject", { projectId: demo._id });
  const results = [];
  for (const f of files) {
    if (!f.storageId || !String(f.storageId).startsWith("/")) {
      results.push({ fileName: f.fileName, storageId: f.storageId, skipped: true, metadataBytes: f.fileSize });
      continue;
    }
    const url = `${BASE_URL}${f.storageId}`;
    const resp = await fetch(url);
    const bytes = new Uint8Array(await resp.arrayBuffer());
    results.push({
      fileName: f.fileName, storageId: f.storageId, status: resp.status,
      contentType: resp.headers.get("content-type"), servedBytes: bytes.length,
      metadataBytes: f.fileSize, match: bytes.length === f.fileSize,
    });
    ev(`[C] ${f.fileName}: served=${bytes.length} metadata=${f.fileSize} match=${bytes.length === f.fileSize} status=${resp.status} type=${resp.headers.get("content-type")}`);
  }
  const served = results.filter((r) => !r.skipped);
  const allMatch = served.length === 8 && served.every((r) => r.match);
  const sizes = served.map((r) => r.servedBytes);
  const inClaimedRange = sizes.every((s) => s >= 2665 && s <= 3179);
  ev(`[C] 8/8 metadata==served: ${allMatch}; served range ${Math.min(...sizes)}-${Math.max(...sizes)} (claim 2,665-3,179 => ${inClaimedRange ? "within" : "OUTSIDE"})`);
  OUT.claims.documentBytes = { held: allMatch, inClaimedRange, files: results };
  ev("");

  // ---------- CLAIM-B: clash resolution UI persistence ----------
  const fixtureId = await client.mutation("projects:createProject", {
    title: TAG, location: "Austin, TX", projectType: "commercial QA", estBudget: 3200000,
    targetCompletionWeeks: 40, specDocumentText: "QA-14 claims-fixture (Div 26 + 23).", isDemoProject: false,
  });
  const elecPkgId = await client.mutation("tradePackages:createTradePackage", {
    projectId: fixtureId, csiDivision: "26 00 00", tradeName: "QA-14 Claims Electrical", budgetEstimate: 1300000,
    scopeSummary: "claims fixture elec", mandatoryInclusions: ["Switchgear"], bidDeadline: "2026-12-31",
  });
  await client.mutation("tradePackages:createTradePackage", {
    projectId: fixtureId, csiDivision: "23 00 00", tradeName: "QA-14 Claims HVAC", budgetEstimate: 950000,
    scopeSummary: "claims fixture hvac", mandatoryInclusions: ["RTUs"], bidDeadline: "2026-12-31",
  });

  const { browser } = await launchBrowser();
  const claimB = { fixtureId };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto(`${BASE_URL}/?project=${fixtureId}&tab=coordination`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page, 45000);
    await dismissTour(page);
    await delay(1000);
    claimB.initial = {
      detectedBadges: await countText(page, "Redundant Double-Buy Detected"),
      voidBadges: await countText(page, "Critical Scope Void Detected"),
      hasFresh500: await bodyHas(page, "$50,500"),
      hasVoid46500: await bodyHas(page, "$46,500"),
      badge: await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => /Clashes|Clear/.test(x.textContent || "") && /Clash/.test(x.title || ""));
        return b ? b.textContent.trim() : null;
      }),
    };
    await shot(page, "remediation-qa14-claimB-1-initial.png");
    ev(`[B] initial: doubleBuyBadges=${claimB.initial.detectedBadges} voidBadges=${claimB.initial.voidBadges} exposure50500=${claimB.initial.hasFresh500} void46500=${claimB.initial.hasVoid46500} badge="${claimB.initial.badge}"`);

    // Deduct via backend while page is open (realtime claim)
    const tDeduct = Date.now();
    const deduct = await client.mutation("coordination:deductDoubleBuyCredit", {
      projectId: fixtureId, clashId: "clash-vfd-01", tradePackageId: elecPkgId, deductAmount: 38500, description: "VFD double-buy (QA-14 claim B)",
    });
    const deductSeconds = await waitForText(page, "Credit Deducted & Leveled", 60000);
    claimB.afterDeduct = {
      mutationOk: deduct.success === true,
      realtimeSeconds: deductSeconds !== null ? Number(deductSeconds) : null,
      deductedBadges: await countText(page, "Credit Deducted & Leveled"),
      hasExposure12000: await bodyHas(page, "$12,000"),
      badge: await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => /Clashes|Clear/.test(x.textContent || "") && /Clash/.test(x.title || ""));
        return b ? b.textContent.trim() : null;
      }),
    };
    await shot(page, "remediation-qa14-claimB-2-after-deduct.png");
    ev(`[B] after deduct: realtime=${deductSeconds}s deductedBadges=${claimB.afterDeduct.deductedBadges} exposure12000=${claimB.afterDeduct.hasExposure12000} badge="${claimB.afterDeduct.badge}"`);

    // Assign void via backend
    const assign = await client.mutation("coordination:assignScopeVoidToTrade", {
      projectId: fixtureId, voidId: "void-bas-wiring-01", tradePackageId: elecPkgId, additionalCost: 28000, description: "BAS wiring void (QA-14 claim B)",
    });
    const assignSeconds = await waitForText(page, "Scope Assigned & Covered", 60000);
    claimB.afterAssign = {
      mutationOk: assign.success === true,
      realtimeSeconds: assignSeconds !== null ? Number(assignSeconds) : null,
      assignedBadges: await countText(page, "Scope Assigned & Covered"),
      hasVoid18500: await bodyHas(page, "$18,500"),
      badge: await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => /Clashes|Clear/.test(x.textContent || "") && /Clash/.test(x.title || ""));
        return b ? b.textContent.trim() : null;
      }),
    };
    await shot(page, "remediation-qa14-claimB-3-after-assign.png");
    ev(`[B] after assign: realtime=${assignSeconds}s assignedBadges=${claimB.afterAssign.assignedBadges} void18500=${claimB.afterAssign.hasVoid18500} badge="${claimB.afterAssign.badge}"`);

    // Reload persistence
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForAppReady(page, 45000);
    await dismissTour(page);
    await delay(1000);
    claimB.afterReload = {
      deductedBadges: await countText(page, "Credit Deducted & Leveled"),
      assignedBadges: await countText(page, "Scope Assigned & Covered"),
      badge: await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => /Clashes|Clear/.test(x.textContent || "") && /Clash/.test(x.title || ""));
        return b ? b.textContent.trim() : null;
      }),
    };
    await shot(page, "remediation-qa14-claimB-4-after-reload.png");
    ev(`[B] after reload: deductedBadges=${claimB.afterReload.deductedBadges} assignedBadges=${claimB.afterReload.assignedBadges} badge="${claimB.afterReload.badge}"`);

    claimB.held =
      claimB.initial.detectedBadges === 2 && claimB.initial.voidBadges === 2 &&
      claimB.afterDeduct.mutationOk && claimB.afterDeduct.realtimeSeconds !== null &&
      claimB.afterDeduct.deductedBadges === 1 && claimB.afterDeduct.hasExposure12000 &&
      claimB.afterAssign.mutationOk && claimB.afterAssign.realtimeSeconds !== null &&
      claimB.afterAssign.assignedBadges === 1 && claimB.afterAssign.hasVoid18500 &&
      claimB.afterReload.deductedBadges === 1 && claimB.afterReload.assignedBadges === 1 &&
      String(claimB.afterReload.badge).includes("2");
  } finally {
    await browser.close();
    await client.mutation("projects:deleteProject", { projectId: fixtureId }).catch(() => {});
  }
  OUT.claims.clashResolutionUI = claimB;
  ev(`[B] CLAIM-B held: ${claimB.held}`);
  ev("");

  // CLAIM-A reference (tested in browser sweep)
  OUT.claims.deepLinks = { held: true, evidence: "remediation-qa14-browser-sweep.json -> items.deep_link" };

  const after = await client.query("projects:listProjects", {});
  OUT.cleanup = {
    remaining: after.map((p) => p.title),
    myFixtureGone: !after.some((p) => p._id === fixtureId),
    demoPresent: after.some((p) => p.isDemoProject === true),
    onlyDemo: after.length === 1 && after[0].isDemoProject === true,
  };
  OUT.finishedAt = new Date().toISOString();
  OUT.overall = OUT.claims.documentBytes.held && claimB.held ? "PASS" : "FAIL";
  ev(`[cleanup] myFixtureGone=${OUT.cleanup.myFixtureGone} demoPresent=${OUT.cleanup.demoPresent} onlyDemo=${OUT.cleanup.onlyDemo} remaining=${JSON.stringify(OUT.cleanup.remaining)}`);
  ev(`OVERALL: ${OUT.overall}`);

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa14-claims-spotcheck.txt"), LOG.join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa14-claims-spotcheck.json"), JSON.stringify(OUT, null, 2), "utf8");
  console.log("Wrote claims spot-check evidence.");
  process.exitCode = OUT.overall === "PASS" ? 0 : 1;
}

main().catch((e) => {
  console.error("FATAL", e);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa14-claims-spotcheck.txt"), LOG.join("\n") + `\nFATAL: ${e?.stack || e?.message}\n`, "utf8");
  process.exit(1);
});