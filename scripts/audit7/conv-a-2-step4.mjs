/**
 * AUDIT7 CONV-A round 1 — Step 4:
 * Ingest a deceptive bid (low base, big exclusions, 20 weeks) from a second contractor and
 * verify the ranking flips to the true cheapest plus the "Deceptive Low Bid Flagged" banner.
 */
import fs from "node:fs";
import path from "node:path";
import {
  delay, openApp, q, clickTab, selectProject, selectRibbonPackage, clickText, addContractor, ingestQuote, poll,
  writeEvidence, PREFIX, DAILY,
} from "./lib.mjs";

/** Same predicate as src/leveling.ts getDeceptiveBidIds (inlined; no TS import from node). */
function getDeceptiveBidIds(bids) {
  const lowestLeveledBid = bids.reduce((lowest, bid) => (!lowest || bid.leveledTotalCost < lowest.leveledTotalCost ? bid : lowest), null);
  if (!lowestLeveledBid) return new Set();
  return new Set(
    bids
      .filter(
        (bid) =>
          bid._id !== lowestLeveledBid._id &&
          bid.baseBidAmount < lowestLeveledBid.baseBidAmount &&
          bid.leveledTotalCost > lowestLeveledBid.leveledTotalCost
      )
      .map((bid) => bid._id)
  );
}

const TITLE = `${PREFIX}CONV-A-${DAILY}`;
const CTR2 = "QuickFlow Plumbing LLC";
const CTR2_EMAIL = "bids@quickflow-plumbing.example";
const CTR2_LIC = "OR-CCB-118342";
const CTR1 = "Cascade Mechanical Contractors LLC";

const QUOTE_B = [
  "PROPOSAL AND QUOTATION",
  `Subcontractor: ${CTR2}`,
  `Project: ${TITLE}`,
  "Base Bid Price: $489,500.00",
  "Scope: complete Division 22 plumbing scope including domestic water, sanitary waste and vent piping.",
  "Exclusions: crane rigging and hoisting excluded ($96,250); UL firestopping penetrations excluded ($44,800); seismic bracing and snubbers excluded ($33,900).",
  "Schedule: equipment procurement lead time is 20 weeks from notice to proceed; the project target is 12 weeks.",
  "Insurance: umbrella liability endorsement excluded.",
  "Value Engineering: none offered.",
].join("\n");

const EXPECT_B = {
  base: 489500.0,
  exclusions: [96250, 44800, 33900],
  exclusionsSum: 176950,
  leadWeeks: 20,
  leadTarget: 16,
  leadPenalty: 24000,
  coiPenalty: 15000,
  leveled: 489500 + 176950 + 24000 + 15000,
};

const out = {
  startedAt: new Date().toISOString(),
  title: TITLE,
  quoteB: QUOTE_B,
  expectedB: EXPECT_B,
  assertions: {},
  bids: null,
  bannerText: null,
  tableHeader: null,
  cardTexts: {},
};

const evidenceDir = path.join(process.cwd(), "evidence");
fs.mkdirSync(evidenceDir, { recursive: true });

const proj = ((await q("projects:listProjects", {})) || []).find((p) => p.title === TITLE);
if (!proj) throw new Error("CONV-A fixture missing — run conv-a-1-step123 first");
const pkgs = (await q("tradePackages:listByProject", { projectId: proj._id })) || [];
const pkg = pkgs.find((p) => String(p.csiDivision).startsWith("22"));
if (!pkg) throw new Error("Div 22 package missing");

function projection(b) {
  return {
    subcontractorName: b.subcontractorName,
    baseBidAmount: b.baseBidAmount,
    exclusions: (b.identifiedExclusions || []).map((e) => ({
      code: e.canonicalCode ?? null, desc: e.description, cost: e.costImpact, waived: Boolean(e.isWaived),
    })),
    exclusionsSum: (b.identifiedExclusions || []).reduce((s, e) => s + (e.isWaived ? 0 : e.costImpact), 0),
    longLeadEquipmentWeeks: b.longLeadEquipmentWeeks,
    leadTimeTargetWeeks: b.leadTimeTargetWeeks ?? null,
    leadTimePenalty: b.leadTimePenalty,
    coiComplianceStatus: b.coiComplianceStatus,
    coiPenalty: b.coiPenalty,
    ve: (b.valueEngineeringAlternates || []).map((v) => ({ desc: v.description, deduct: v.costDeduct, accepted: Boolean(v.isAccepted) })),
    leveledTotalCost: b.leveledTotalCost,
  };
}

async function sliceAround(page, needle, radius = 900) {
  return page.evaluate((n, r) => {
    const t = (document.querySelector("main") || document.body).innerText;
    const i = t.indexOf(n);
    return i === -1 ? null : t.slice(Math.max(0, i - 200), i + r).replace(/\n+/g, " | ");
  }, needle, radius);
}

const { browser, page } = await openApp(1440, 900);
try {
  await selectProject(page, proj._id);
  await clickTab(page, "Discovery");
  await delay(1200);
  await selectRibbonPackage(page, pkg.tradeName);
  await delay(600);
  await addContractor(page, pkg.tradeName, CTR2, CTR2_EMAIL, CTR2_LIC);
  const ctrs = (await q("contractors:listByPackage", { tradePackageId: pkg._id })) || [];
  const ctr2 = ctrs.find((c) => c.companyName === CTR2);
  out.contractor2 = ctr2 ? { _id: ctr2._id, companyName: ctr2.companyName, contactEmail: ctr2.contactEmail } : null;
  if (!ctr2) throw new Error("contractor 2 not added");

  const ingest = await ingestQuote(page, ctr2._id, QUOTE_B);
  out.assertions.ingestSubmitted = ingest.ok;
  const bidB = await poll(
    () => q("bids:listByPackage", { tradePackageId: pkg._id }).then((bs) => (bs || []).find((b) => b.contractorId === ctr2._id)),
    (b) => Boolean(b),
    180000,
    2500
  );
  await delay(1500);
  const bids = (await q("bids:listByPackage", { tradePackageId: pkg._id })) || [];
  out.bids = bids.map(projection).sort((a, b) => a.leveledTotalCost - b.leveledTotalCost);
  out.bidB = projection(bidB);

  // backend ranking + deceptive flag using the same predicate as the UI
  const sorted = [...bids].sort((a, b) => a.leveledTotalCost - b.leveledTotalCost);
  const deceptive = getDeceptiveBidIds(bids);
  out.assertions.ranking = {
    order: sorted.map((b) => ({ name: b.subcontractorName, base: b.baseBidAmount, leveled: b.leveledTotalCost })),
    rank1Name: sorted[0]?.subcontractorName ?? null,
    paperCheapestName: [...bids].sort((a, b) => a.baseBidAmount - b.baseBidAmount)[0]?.subcontractorName ?? null,
    deceptiveIds: [...deceptive],
    deceptiveName: bids.filter((b) => deceptive.has(b._id)).map((b) => b.subcontractorName),
    rank1IsPaperCheapest: sorted[0]?._id === [...bids].sort((a, b) => a.baseBidAmount - b.baseBidAmount)[0]?._id,
  };

  // UI: spread table ranking + banner
  const tableToggle = await clickText(page, "Spread Table View");
  out.assertions.tableToggle = tableToggle.ok;
  await delay(1000);
  out.tableHeader = await sliceAround(page, "Forensic Leveling Factor", 700);
  out.bannerText = await sliceAround(page, "Deceptive Low Bid Flagged", 800);
  out.assertions.bannerVisible = Boolean(out.bannerText && out.bannerText.includes("Deceptive Low Bid Flagged"));
  out.assertions.bannerShowsTrueVariance = Boolean(
    out.bannerText && out.bannerText.includes(`+$${(EXPECT_B.leveled - out.bids[0].leveledTotalCost).toLocaleString("en-US")}`)
  );
  out.assertions.bannerNamesDeceptiveVsCompliant = Boolean(
    out.bannerText && out.bannerText.includes(CTR2) && out.bannerText.includes(CTR1)
  );
  out.assertions.rank1IsTrueCheapest = out.assertions.ranking.rank1Name === CTR1;
  out.assertions.paperCheapestIsDeceptive = out.assertions.ranking.paperCheapestName === CTR2;
  await page.screenshot({ path: path.join(evidenceDir, "a7conv-a-step4-banner.png") });

  // card texts for both bidders
  for (const name of [CTR1, CTR2]) {
    out.cardTexts[name] = await sliceAround(page, name, 1600);
  }
  await clickText(page, "Card View");
  await delay(600);
} catch (err) {
  out.error = String(err?.stack ?? err);
  console.error(err);
} finally {
  await browser.close();
}
await writeEvidence("a7conv-a-step4.json", out);
console.log(JSON.stringify({ contractor2: out.contractor2, assertions: out.assertions, bids: out.bids, bannerText: out.bannerText, tableHeader: out.tableHeader, cardTexts: out.cardTexts }, null, 2));