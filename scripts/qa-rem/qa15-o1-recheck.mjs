// QA-15 Item 1 recheck (round 7): corrected case-insensitive scrape + clean realtime test.
// A) fresh zero-bid fixture -> UI Clear; add 1 bid -> poll (NO reload) for cards; screenshot.
// B) re-scrape existing O1 fixture + demo with corrected markers.
// Usage: node scripts/qa-rem/qa15-o1-recheck.mjs
import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { launchBrowser, EVIDENCE_DIR, BASE_URL, waitForAppReady, shot, delay } from "./qa1-lib.mjs";

const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(BACKEND);
const RT_TAG = `QA-REM-QA15-RT-${Date.now()}`;

const LOG = [];
const OUT = { rtTag: RT_TAG, startedAt: new Date().toISOString(), items: {}, steps: {} };
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
    const upper = txt.toUpperCase();
    const countOcc = (needle) => upper.split(needle.toUpperCase()).length - 1;
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
    return {
      urlTab: new URLSearchParams(window.location.search).get("tab"),
      headerSpans: headerBtn ? [...headerBtn.querySelectorAll("span")].map((s) => s.textContent.trim()) : null,
      headerFull: headerBtn ? headerBtn.textContent.replace(/\s+/g, " ").trim() : null,
      activeDoubleBuyCards: countOcc("REDUNDANT DOUBLE-BUY DETECTED"),
      deductedCards: countOcc("CREDIT DEDUCTED & LEVELED"),
      activeVoidCards: countOcc("CRITICAL SCOPE VOID DETECTED"),
      assignedCards: countOcc("SCOPE ASSIGNED & COVERED"),
      kpiDoubleBuy: kpi("Redundant Double-Buys"),
      kpiVoids: kpi("Unassigned Scope Voids"),
      kpiRisk: kpi("Coordination Risk Level"),
      hasUndefined: /undefined/.test(txt),
      hasNaN: /NaN/.test(txt),
    };
  });
}

async function main() {
  ev("=== QA-15 ITEM 1 RECHECK ===");
  ev(`UTC: ${new Date().toISOString()}`);
  ev("");

  // ---- A) realtime: fresh zero-bid fixture ----
  const projectId = await client.mutation("projects:createProject", {
    title: RT_TAG,
    location: "Austin, TX",
    projectType: "QA round 7 realtime",
    estBudget: 2600000,
    targetCompletionWeeks: 36,
    specDocumentText: "QA-15 realtime fixture (Div 26 + 23, zero bids).",
    isDemoProject: false,
  });
  const elecPkgId = await client.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision: "26 00 00",
    tradeName: "QA-15 RT Electrical",
    budgetEstimate: 1000000,
    scopeSummary: "QA-15 RT electrical",
    mandatoryInclusions: ["Code compliance"],
    bidDeadline: "2026-10-31",
  });
  await client.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision: "23 00 00",
    tradeName: "QA-15 RT HVAC",
    budgetEstimate: 1200000,
    scopeSummary: "QA-15 RT mechanical",
    mandatoryInclusions: ["Code compliance"],
    bidDeadline: "2026-10-31",
  });
  const clash0 = await client.query("coordination:detectCrossTradeClashes", { projectId });
  ev(`[A setup] project=${projectId}; backend zero-bid active=${clash0.summary.activeClashesCount} provider=${clash0.provider}`);
  OUT.steps.rtZeroBid = { projectId, elecPkgId, active: clash0.summary.activeClashesCount, provider: clash0.provider };

  const { browser, executablePath } = await launchBrowser();
  ev(`[browser] ${executablePath}`);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto(`${BASE_URL}/?project=${projectId}&tab=coordination`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page, 45000);
    await dismissTour(page);
    await delay(1200);
    const before = await scrapeCoordination(page);
    ev(
      `[A before] header="${before.headerFull}" activeDoubleBuy=${before.activeDoubleBuyCards} activeVoid=${before.activeVoidCards} risk=${before.kpiRisk?.value}`
    );

    const contractorId = await client.mutation("contractors:createContractor", {
      tradePackageId: elecPkgId,
      companyName: "QA-15 RT Electric",
      contactEmail: "qa15.rt@tradepulse-pro.test",
      phone: "+1 (512) 555-0116",
      licenseNumber: "QA15-RT-01",
      licenseStatus: "Active / Verified",
      sourceUrl: "https://tradepulse-pro.test/qa15rt",
      rfqStatus: "invited",
    });
    const t0 = Date.now();
    await client.mutation("bids:submitDirectBid", {
      tradePackageId: elecPkgId,
      contractorId,
      subcontractorName: "QA-15 RT Electric",
      baseBidAmount: 980000,
    });
    let updated = null;
    let secs = null;
    while ((Date.now() - t0) / 1000 < 25) {
      const s = await scrapeCoordination(page);
      if (s.activeDoubleBuyCards >= 2 && s.activeVoidCards >= 2) {
        secs = (Date.now() - t0) / 1000;
        updated = s;
        break;
      }
      await delay(400);
    }
    await shot(page, "remediation-qa15-o1-04-realtime-after-bid.png");
    if (updated) {
      ev(
        `[A realtime] cards appeared in ${secs.toFixed(1)}s (no reload): doubleBuy=${updated.activeDoubleBuyCards} void=${updated.activeVoidCards} header="${updated.headerFull}" KPI=${updated.kpiDoubleBuy?.value}/${updated.kpiVoids?.value}/${updated.kpiRisk?.value}`
      );
    } else {
      const now = await scrapeCoordination(page);
      ev(
        `[A realtime] NOT observed within 25s; current: doubleBuy=${now.activeDoubleBuyCards} void=${now.activeVoidCards} header="${now.headerFull}" KPI=${now.kpiDoubleBuy?.value}/${now.kpiVoids?.value}`
      );
      OUT.steps.rtAfterTimeout = now;
    }
    OUT.steps.rtBefore = before;
    OUT.steps.rtAfter = updated;
    OUT.steps.rtSeconds = secs;
    OUT.items.realtime_cards_without_reload = Boolean(updated);
    ev("");

    // ---- B) re-scrape the O1 fixture (existing, 1 bid) ----
    const allProjects = await client.query("projects:listProjects", {});
    const o1 = allProjects.find((p) => p.title.startsWith("QA-REM-QA15-O1-"));
    if (o1) {
      await page.goto(`${BASE_URL}/?project=${o1._id}&tab=coordination`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await waitForAppReady(page, 45000);
      await dismissTour(page);
      await delay(1200);
      const s = await scrapeCoordination(page);
      await shot(page, "remediation-qa15-o1-05-fixture-corrected.png");
      ev(
        `[B O1 fixture] header="${s.headerFull}" activeDoubleBuy=${s.activeDoubleBuyCards} activeVoid=${s.activeVoidCards} KPI=${s.kpiDoubleBuy?.value}/${s.kpiVoids?.value}/${s.kpiRisk?.value} undefined=${s.hasUndefined} NaN=${s.hasNaN}`
      );
      OUT.steps.o1FixtureCorrected = s;
      OUT.items.o1_fixture_2plus2 =
        s.activeDoubleBuyCards === 2 &&
        s.activeVoidCards === 2 &&
        (s.headerSpans || []).includes("4 Clashes") &&
        s.kpiDoubleBuy?.value === "$50,500" &&
        s.kpiVoids?.value === "$46,500" &&
        /4 items awaiting resolution/.test(s.kpiRisk?.full || "");
    } else {
      ev("[B] O1 fixture not found!");
      OUT.items.o1_fixture_2plus2 = false;
    }
    ev("");

    // ---- C) re-scrape demo ----
    const demo = allProjects.find((p) => p.isDemoProject);
    const demoClash = await client.query("coordination:detectCrossTradeClashes", { projectId: demo._id });
    await page.goto(`${BASE_URL}/?project=${demo._id}&tab=coordination`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page, 45000);
    await dismissTour(page);
    await delay(1200);
    const d = await scrapeCoordination(page);
    await shot(page, "remediation-qa15-o1-06-demo-corrected.png");
    ev(
      `[C demo] backend active=${demoClash.summary.activeClashesCount}; UI header="${d.headerFull}" activeDoubleBuy=${d.activeDoubleBuyCards} activeVoid=${d.activeVoidCards} KPI=${d.kpiDoubleBuy?.value}/${d.kpiVoids?.value}/${d.kpiRisk?.value}`
    );
    OUT.steps.demoCorrected = {
      backendActive: demoClash.summary.activeClashesCount,
      backendStatuses: [
        ...demoClash.doubleBuys.map((x) => `${x.id}:${x.status}`),
        ...demoClash.scopeVoids.map((x) => `${x.id}:${x.status}`),
      ],
      ui: d,
    };
    OUT.items.demo_still_4_active =
      demoClash.summary.activeClashesCount === 4 &&
      d.activeDoubleBuyCards === 2 &&
      d.activeVoidCards === 2 &&
      (d.headerSpans || []).includes("4 Clashes") &&
      /4 items awaiting resolution/.test(d.kpiRisk?.full || "");
  } finally {
    await browser.close();
  }

  OUT.rtFixtureKeptForCleanup = projectId;
  const failed = Object.entries(OUT.items).filter(([, v]) => !v).map(([k]) => k);
  OUT.finishedAt = new Date().toISOString();
  OUT.overall = failed.length === 0 ? "PASS" : "FAIL";
  ev("");
  ev(`ITEMS: ${Object.entries(OUT.items).map(([k, v]) => `${k}=${v ? "PASS" : "FAIL"}`).join(" | ")}`);
  ev(`OVERALL: ${OUT.overall}${failed.length ? ` (failed: ${failed.join(", ")})` : ""}`);

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa15-o1-recheck.txt"), LOG.join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa15-o1-recheck.json"), JSON.stringify(OUT, null, 2), "utf8");
  console.log("Wrote O1 recheck evidence.");
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("FATAL", e);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "remediation-qa15-o1-recheck.txt"),
    LOG.join("\n") + `\nFATAL: ${e?.stack || e?.message}\n`,
    "utf8"
  );
  process.exit(1);
});