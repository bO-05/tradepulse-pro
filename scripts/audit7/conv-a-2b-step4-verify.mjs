/**
 * AUDIT7 CONV-A round 1 — Step 4b: corrected-constant verification of the deceptive-bid flip.
 * Re-reads persisted bids and the live banner text; asserts the exact arithmetic.
 */
import { openApp, q, clickTab, selectProject, writeEvidence, PREFIX, DAILY, delay } from "./lib.mjs";

const TITLE = `${PREFIX}CONV-A-${DAILY}`;
const CTR1 = "Cascade Mechanical Contractors LLC";
const CTR2 = "QuickFlow Plumbing LLC";
const EXPECT = {
  cascade: { base: 613777.13, statedExclusions: [18600, 9950, 7400], phantom: 12000, lead: 6000, coi: 15000, leveled: 682727.13 },
  quickflow: { base: 489500.0, exclusions: [96250, 44800, 33900], sum: 174950, lead: 24000, coi: 15000, leveled: 703450 },
};

const proj = ((await q("projects:listProjects", {})) || []).find((p) => p.title === TITLE);
if (!proj) throw new Error("CONV-A fixture missing");
const pkgs = (await q("tradePackages:listByProject", { projectId: proj._id })) || [];
const pkg = pkgs.find((p) => String(p.csiDivision).startsWith("22"));

const bids = ((await q("bids:listByPackage", { tradePackageId: pkg._id })) || []).map((b) => ({
  name: b.subcontractorName,
  base: b.baseBidAmount,
  exclusionCosts: (b.identifiedExclusions || []).map((e) => e.costImpact),
  exclusionSum: (b.identifiedExclusions || []).reduce((s, e) => s + (e.isWaived ? 0 : e.costImpact), 0),
  lead: b.leadTimePenalty,
  coi: b.coiPenalty,
  leveled: b.leveledTotalCost,
}));
const sorted = [...bids].sort((a, b) => a.leveled - b.leveled);
const paper = [...bids].sort((a, b) => a.base - b.base);
const cascade = bids.find((b) => b.name === CTR1);
const quick = bids.find((b) => b.name === CTR2);
const expectedVariance = EXPECT.quickflow.leveled - EXPECT.cascade.leveled;

const { browser, page } = await openApp(1440, 900);
let bannerText = null;
try {
  await selectProject(page, proj._id);
  await clickTab(page, "04:");
  await delay(2500);
  bannerText = await page.evaluate(() => {
    const t = (document.querySelector("main") || document.body).innerText;
    const i = t.indexOf("Deceptive Low Bid Flagged");
    return i === -1 ? null : t.slice(Math.max(0, i - 200), i + 700).replace(/\n+/g, " | ");
  });
} catch (err) {
  bannerText = `ERROR: ${err?.message ?? err}`;
} finally {
  await browser.close();
}

const out = {
  checkedAt: new Date().toISOString(),
  persisted: { cascade, quickflow: quick, sortedOrder: sorted.map((b) => `${b.name} $${b.leveled}`), paperOrder: paper.map((b) => `${b.name} base $${b.base}`) },
  expectedVariance,
  bannerText,
  assertions: {
    quickflowExclusionsExactlyStated:
      JSON.stringify(quick.exclusionCosts) === JSON.stringify(EXPECT.quickflow.exclusions),
    quickflowSum: quick.exclusionSum === EXPECT.quickflow.sum,
    quickflowLead: quick.lead === EXPECT.quickflow.lead,
    quickflowCoi: quick.coi === EXPECT.quickflow.coi,
    quickflowLeveled: quick.leveled === EXPECT.quickflow.leveled,
    rank1IsCascade: sorted[0].name === CTR1,
    rank2IsQuickflow: sorted[1].name === CTR2,
    paperCheapestIsQuickflow: paper[0].name === CTR2,
    rankingFlipped: sorted[0].name !== paper[0].name,
    bannerVisible: Boolean(bannerText && bannerText.includes("Deceptive Low Bid Flagged")),
    bannerTrueVarianceExact: Boolean(bannerText && bannerText.includes(`+$${expectedVariance.toLocaleString("en-US")} True Variance`)),
    bannerNamesQuickflowAsPaperLow: Boolean(bannerText && bannerText.includes(`${CTR2} ($${EXPECT.quickflow.base.toLocaleString("en-US")} base)`)),
    bannerStatesHigherNormalized: Boolean(bannerText && bannerText.includes(`$${EXPECT.quickflow.leveled.toLocaleString("en-US")}`) && bannerText.includes(`${CTR1} ($${EXPECT.cascade.leveled.toLocaleString("en-US")})`)),
  },
};
await writeEvidence("a7conv-a-step4b.json", out);
console.log(JSON.stringify(out, null, 2));