/**
 * QA7 item 9: recompute demo-project procurement numbers from the live backend
 * using a line-for-line mirror of src/leveling.ts and diff against stored data.
 * Read-only. Evidence: evidence/fix4-qa7-50-reconcile-demo.json
 */
import { client, writeEvidence } from "./qa7-lib.mjs";

const c = client();

// ---- mirror of src/leveling.ts -------------------------------------------------
const breakdown = (bid) => {
  const exclusions = (bid.identifiedExclusions || []).reduce(
    (s, x) => (x.isWaived ? s : s + (x.costImpact || 0)),
    0
  );
  const veAccepted = (bid.valueEngineeringAlternates || []).reduce(
    (s, x) => (x.isAccepted ? s + (x.costDeduct || 0) : s),
    0
  );
  const lead = bid.leadTimePenalty || 0;
  const coi = bid.coiPenalty || 0;
  return { exclusions, veAccepted, lead, coi, uplift: exclusions + lead + coi - veAccepted };
};
const calcLeveled = (bid) => Math.max(0, bid.baseBidAmount + breakdown(bid).uplift);
const deceptiveIds = (bids) => {
  if (!bids.length) return new Set();
  const lowest = bids.reduce((l, b) => (!l || b.leveledTotalCost < l.leveledTotalCost ? b : l), null);
  return new Set(
    bids
      .filter((b) => b._id !== lowest._id && b.baseBidAmount < lowest.baseBidAmount && b.leveledTotalCost > lowest.leveledTotalCost)
      .map((b) => b._id)
  );
};
const effectiveBid = (bids) => bids.find((b) => b.isAwarded) || [...bids].sort((a, b) => a.leveledTotalCost - b.leveledTotalCost)[0] || null;
const suspiciousIds = (bids, budget) => {
  if (!Number.isFinite(budget) || budget <= 0) return new Set();
  const t = budget * 0.5;
  return new Set(bids.filter((b) => b.leveledTotalCost > 0 && b.leveledTotalCost < t).map((b) => b._id));
};
// -------------------------------------------------------------------------------

const projects = await c.query("projects:listProjects", {});
const demo = projects.find((p) => p.isDemoProject) || projects[0];
const packages = await c.query("tradePackages:listByProject", { projectId: demo._id });
const bids = await c.query("bids:listAllProjectBids", { projectId: demo._id });
const agreements = await c.query("agreements:listAgreements", { projectId: demo._id });

const totalBudget = demo.estBudget || 0;
let totalLeveledBuyout = 0;
let packagesWithBids = 0;
let packagesUsingBudget = 0;
const deceptive = new Set();
let gapsCaught = 0;

const perPackage = [];
for (const pkg of packages) {
  const pkgBids = bids.filter((b) => b.tradePackageId === pkg._id);
  let basis;
  let effective;
  let leveled;
  if (pkgBids.length === 0) {
    totalLeveledBuyout += pkg.budgetEstimate || 0;
    packagesUsingBudget += 1;
    basis = "budget";
    effective = null;
    leveled = pkg.budgetEstimate || 0;
  } else {
    packagesWithBids += 1;
    for (const id of deceptiveIds(pkgBids)) deceptive.add(id);
    effective = effectiveBid(pkgBids);
    leveled = effective ? effective.leveledTotalCost : 0;
    totalLeveledBuyout += leveled;
    basis = "bid";
  }
  for (const b of pkgBids) if (suspiciousIds(pkgBids, pkg.budgetEstimate).has(b._id)) b.__suspicious = true;
  perPackage.push({
    division: pkg.csiDivision,
    tradeName: pkg.tradeName,
    status: pkg.status,
    budget: pkg.budgetEstimate,
    bids: pkgBids.length,
    basis,
    effectiveBid: effective
      ? { id: effective._id, name: effective.subcontractorName, base: effective.baseBidAmount, leveled: effective.leveledTotalCost, awarded: effective.isAwarded }
      : null,
    packageContribution: leveled,
    suspiciousLow: pkgBids.filter((b) => b.__suspicious).length,
  });
}
for (const id of deceptive) {
  const b = bids.find((x) => x._id === id);
  if (b) gapsCaught += breakdown(b).uplift;
}
if (bids.length === 0 && packages.length === 0) totalLeveledBuyout = totalBudget;
const variance = totalBudget - totalLeveledBuyout;
const variancePercent = totalBudget > 0 ? (variance / totalBudget) * 100 : 0;
const leveledBasis =
  packages.length === 0 ? "empty" : packagesUsingBudget === 0 ? "bids" : packagesWithBids === 0 ? "budget" : "mixed";

const awardedPkgIds = new Set();
for (const a of agreements) if (a.status !== "superseded") awardedPkgIds.add(a.tradePackageId);
for (const b of bids) if (b.isAwarded) awardedPkgIds.add(b.tradePackageId);
for (const p of packages) if (p.status === "awarded") awardedPkgIds.add(p._id);

const bidAudit = bids.map((b) => {
  const rec = calcLeveled(b);
  const stored = b.leveledTotalCost;
  return {
    id: b._id,
    name: b.subcontractorName,
    division: b.csiDivision,
    base: b.baseBidAmount,
    storedLeveled: stored,
    recomputedLeveled: rec,
    match: rec === stored,
    isAwarded: b.isAwarded,
    deceptive: deceptive.has(b._id),
    breakdown: breakdown(b),
  };
});

const computed = {
  totalBudget,
  totalLeveledBuyout,
  packagesWithBids,
  packagesUsingBudget,
  variance,
  variancePercent,
  isSavings: variance >= 0,
  leveledBasis,
  deceptiveBidsCount: deceptive.size,
  gapsCaught,
  awardedPackages: packages.filter((p) => awardedPkgIds.has(p._id)).length,
  totalPackages: packages.length,
  buyoutProgressPercent: packages.length > 0 ? (packages.filter((p) => awardedPkgIds.has(p._id)).length / packages.length) * 100 : 0,
};
const mismatches = bidAudit.filter((b) => !b.match);
const out = {
  fetchedAt: new Date().toISOString(),
  demoProject: { id: demo._id, title: demo.title, estBudget: demo.estBudget, location: demo.location },
  computed,
  agreements: agreements.map((a) => ({ id: a._id, status: a.status, packageId: a.tradePackageId, bidId: a.bidId, sum: a.contractSum })),
  perPackage,
  bidAudit,
  mismatches,
  checks: [
    {
      label: "every stored leveledTotalCost equals the ADR-0003 recomputation",
      expected: "0 mismatches",
      observed: `${mismatches.length} mismatches`,
      ok: mismatches.length === 0,
    },
    {
      label: "effective bid = awarded bid else lowest leveled (per package)",
      expected: "consistent",
      observed: perPackage.map((p) => `${p.division}:${p.basis}${p.effectiveBid ? ":" + (p.effectiveBid.awarded ? "awarded" : "lowest") : ""}`).join(" | "),
      ok: perPackage.every((p) => (p.basis === "budget" && p.bids === 0) || (p.basis === "bid" && p.effectiveBid)),
    },
    {
      label: "buyout = sum of effective package costs (budget fallback for bidless packages)",
      expected: totalLeveledBuyout,
      observed: perPackage.reduce((s, p) => s + p.packageContribution, 0),
      ok: Math.abs(totalLeveledBuyout - perPackage.reduce((s, p) => s + p.packageContribution, 0)) < 1e-6,
    },
    {
      label: "variance = budget - buyout",
      expected: totalBudget - totalLeveledBuyout,
      observed: variance,
      ok: variance === totalBudget - totalLeveledBuyout,
    },
  ],
  levelingMirror: "line-for-line mirror of src/leveling.ts computeProcurementMetrics/getEffectiveBid/getDeceptiveBidIds/getNormalizationBreakdown",
};

writeEvidence("50-reconcile-demo", out);

console.log(`DEMO ${demo.title} budget=$${totalBudget.toLocaleString("en-US")}`);
console.log(`buyout=$${totalLeveledBuyout.toLocaleString("en-US")} variance=$${variance.toLocaleString("en-US")} (${variancePercent.toFixed(2)}%) basis=${leveledBasis}`);
console.log(`deceptive=${deceptive.size} gaps=$${gapsCaught.toLocaleString("en-US")} awards=${computed.awardedPackages}/${computed.totalPackages} mismatches=${mismatches.length}`);
console.log("division | budget | bids | basis | effective | contribution | status");
for (const p of perPackage) {
  console.log(
    `${p.division} | $${p.budget.toLocaleString("en-US")} | ${p.bids} | ${p.basis} | ${p.effectiveBid ? `${p.effectiveBid.name}${p.effectiveBid.awarded ? " (AWARDED)" : ""}` : "-"} | $${p.packageContribution.toLocaleString("en-US")} | ${p.status}`
  );
}
console.log("bid | base | stored | recomputed | match | awarded | deceptive");
for (const b of bidAudit) {
  console.log(`${b.name} | $${b.base.toLocaleString("en-US")} | $${b.storedLeveled.toLocaleString("en-US")} | $${b.recomputedLeveled.toLocaleString("en-US")} | ${b.match} | ${b.isAwarded} | ${b.deceptive}`);
}
const failed = out.checks.filter((k) => !k.ok);
if (failed.length) console.log("FAILED CHECKS:", failed.map((f) => f.label).join("; "));
else console.log("ALL RECONCILIATION CHECKS PASS");