/**
 * AUDIT7-CONV-B step 6/7: demo project stability (UI + backend) and cleanup of
 * all AUDIT7-CONV-B-* fixture projects. Read-only against the demo project.
 */
import { openApp, q, selectProject, poll, delay, writeEvidence, deleteProject, PREFIX, bodyText, closeTour } from "./lib.mjs";

// ---------- backend truth ----------
const projects = (await q("projects:listProjects", {})) || [];
const demo = projects.find((p) => p.isDemoProject) || projects.find((p) => /The Domain Tower B/.test(p.title));
if (!demo) throw new Error("demo project not found");
const pkgs = (await q("tradePackages:listByProject", { projectId: demo._id })) || [];
const ctrs = (await q("contractors:listByProject", { projectId: demo._id })) || [];
const bids = (await q("bids:listAllProjectBids", { projectId: demo._id })) || [];
const agreements = (await q("agreements:listAgreements", { projectId: demo._id })) || [];
const clash = (await q("coordination:detectCrossTradeClashes", { projectId: demo._id }).catch((e) => ({ error: String(e.message) }))) || {};
const convsByPkg = {};
let conversations = 0;
for (const p of pkgs) {
  const convs = (await q("rfq:listConversations", { tradePackageId: p._id }).catch(() => [])) || [];
  convsByPkg[p.csiDivision] = convs.length;
  conversations += convs.length;
}

const deceptiveIds = new Set();
let gapsCaught = 0;
let leveledBuyout = 0;
for (const pkg of pkgs) {
  const pkgBids = bids.filter((b) => b.tradePackageId === pkg._id);
  if (pkgBids.length === 0) {
    leveledBuyout += pkg.budgetEstimate || 0;
    continue;
  }
  const lowest = pkgBids.reduce((m, b) => (!m || b.leveledTotalCost < m.leveledTotalCost ? b : m), null);
  const effective = pkgBids.find((b) => b.isAwarded) || lowest;
  leveledBuyout += effective?.leveledTotalCost || 0;
  for (const b of pkgBids) {
    if (b._id !== lowest._id && b.baseBidAmount < lowest.baseBidAmount && b.leveledTotalCost > lowest.leveledTotalCost) deceptiveIds.add(b._id);
  }
}
for (const id of deceptiveIds) {
  const b = bids.find((x) => x._id === id);
  if (!b) continue;
  const exclusions = (b.identifiedExclusions || []).reduce((s, e) => s + (e.isWaived ? 0 : e.costImpact || 0), 0);
  const veAccepted = (b.valueEngineeringAlternates || []).reduce((s, v) => s + (v.isAccepted ? v.costDeduct : 0), 0);
  gapsCaught += exclusions + (b.leadTimePenalty || 0) + (b.coiPenalty || 0) - veAccepted;
}
const awardedPkgIds = new Set();
for (const a of agreements) if (a.status !== "superseded") awardedPkgIds.add(a.tradePackageId);
for (const b of bids) if (b.isAwarded) awardedPkgIds.add(b.tradePackageId);
for (const p of pkgs) if (p.status === "awarded") awardedPkgIds.add(p._id);
const awardedPackages = pkgs.filter((p) => awardedPkgIds.has(p._id)).length;

const backend = {
  projectId: demo._id,
  title: demo.title,
  estBudget: demo.estBudget,
  packageCount: pkgs.length,
  contractorCount: ctrs.length,
  contractorsPerPackage: pkgs.map((p) => ({ csi: p.csiDivision, count: ctrs.filter((c) => c.tradePackageId === p._id).length })),
  conversationCount: conversations,
  conversationsPerPackage: convsByPkg,
  bidCount: bids.length,
  bidsPerPackage: pkgs.map((p) => ({ csi: p.csiDivision, count: bids.filter((b) => b.tradePackageId === p._id).length })),
  clashCountTotal: (clash.doubleBuys || []).length + (clash.scopeVoids || []).length,
  clashDoubleBuys: (clash.doubleBuys || []).length,
  clashScopeVoids: (clash.scopeVoids || []).length,
  clashError: clash.error ?? null,
  awardedPackages,
  totalPackages: pkgs.length,
  levelingAwardFormula: "sum(awarded else lowest-leveled bid per package; budget where no bid)",
  leveledBuyout,
  variance: (demo.estBudget || 0) - leveledBuyout,
  variancePercent: demo.estBudget ? (((demo.estBudget || 0) - leveledBuyout) / demo.estBudget) * 100 : 0,
  deceptiveBidIds: [...deceptiveIds],
  deceptiveBids: bids.filter((b) => deceptiveIds.has(b._id)).map((b) => ({
    sub: b.subcontractorName, base: b.baseBidAmount, leveled: b.leveledTotalCost,
    exclusions: (b.identifiedExclusions || []).map((e) => ({ desc: e.description, cost: e.costImpact, waived: !!e.isWaived })),
    lead: b.leadTimePenalty, coi: b.coiPenalty, ve: (b.valueEngineeringAlternates || []).map((v) => ({ deduct: v.costDeduct, accepted: v.isAccepted })),
  })),
  gapsCaught,
  packageStatuses: pkgs.map((p) => ({ csi: p.csiDivision, status: p.status })),
  agreements: agreements.map((a) => ({ num: a.agreementNumber, sub: a.subcontractorName, status: a.status, sum: a.contractSum })),
  legacyBidsMissingTargetWeeks: bids.filter((b) => b.leadTimeTargetWeeks === undefined).map((b) => b.subcontractorName),
};

const expected = {
  tradePackages: 3,
  contractors: 4,
  rfis: 3,
  bids: 2,
  clashItems: 4,
  awarded: "1 of 3",
  budget: 4250000,
  leveledBuyout: 3918500,
  variance: 331500,
  variancePercent: 7.8,
  gapsExposed: 186000,
};

// ---------- UI truth ----------
const { browser, page } = await openApp(1440, 900);
const ui = { raw: null, kpi: {}, badges: {}, matches: {} };
try {
  await selectProject(page, demo._id);
  await delay(2500);
  await closeTour(page);
  await delay(800);
  ui.raw = (await bodyText(page)).slice(0, 12000);
  ui.kpi = await page.evaluate(() => {
    const t = document.body.innerText;
    const grab = (re) => (t.match(re) || [])[0] || null;
    return {
      budget: grab(/Budget:\s*\$[\d,]+/),
      leveledBuyout: grab(/Leveled Buyout:\s*\$[\d,]+/),
      variance: grab(/Variance:\s*[+-]\$[\d,]+/),
      variancePct: grab(/\([\d.]+%\)/),
      gapsExposed: grab(/Gaps Exposed:\s*\+\$[\d,]+/),
      subcontracts: grab(/Subcontracts:\s*\d+\/\d+\s*Awarded/),
      deceptive: grab(/\d+\s*Deceptive Bid/),
    };
  });
  ui.badges = await page.evaluate(() => {
    const t = document.body.innerText;
    const grab = (re) => (t.match(re) || [])[0] || null;
    return {
      pkgs: grab(/\d+\s*Pkgs/),
      subs: grab(/\d+\s*Subs/),
      rfis: grab(/\d+\s*RFIs/),
      bids: grab(/\d+\s*Bids/),
      clashes: grab(/\d+\s*Clashes/),
      awarded: grab(/\d+\/\d+\s*Awarded/),
    };
  });
  const flat = (ui.raw || "").replace(/\s+/g, " ");
  ui.matches = {
    budget: flat.includes("Budget: $4,250,000"),
    leveledBuyout: flat.includes("Leveled Buyout: $3,918,500"),
    variance: flat.includes("Variance: +$331,500"),
    variancePct: flat.includes("(7.8%)"),
    gapsExposed: flat.includes("Gaps Exposed: +$186,000"),
    awarded: flat.includes("1/3 Awarded"),
  };
} catch (e) {
  ui.error = String(e?.stack ?? e);
} finally {
  await browser.close();
}

// ---------- cleanup AUDIT7-CONV-B-* fixtures ----------
const cleanup = { deleted: [], remaining: [] };
for (const p of ((await q("projects:listProjects", {})) || []).filter((x) => x.title.startsWith(`${PREFIX}CONV-B-`))) {
  const ok = await deleteProject(p._id);
  cleanup.deleted.push({ id: p._id, title: p.title, ok });
}
// second sweep to confirm
for (const p of ((await q("projects:listProjects", {})) || []).filter((x) => x.title.startsWith(`${PREFIX}CONV-B-`))) {
  cleanup.remaining.push({ id: p._id, title: p.title });
}

const out = {
  mission: "audit7-conv-b-demo",
  startedAt: new Date().toISOString(),
  note: "Demo project is read-only in this script; only AUDIT7-CONV-B-* fixtures are deleted.",
  backend,
  expected,
  backendVsExpected: {
    packageCount: { backend: backend.packageCount, expected: expected.tradePackages, equal: backend.packageCount === expected.tradePackages },
    contractorCount: { backend: backend.contractorCount, expected: expected.contractors, equal: backend.contractorCount === expected.contractors },
    conversationCount: { backend: backend.conversationCount, expected: expected.rfis, equal: backend.conversationCount === expected.rfis },
    bidCount: { backend: backend.bidCount, expected: expected.bids, equal: backend.bidCount === expected.bids },
    clashCount: { backend: backend.clashCountTotal, expected: expected.clashItems, equal: backend.clashCountTotal === expected.clashItems },
    awarded: { backend: `${awardedPackages}/${pkgs.length}`, expected: expected.awarded, equal: awardedPackages === 1 && pkgs.length === 3 },
    budget: { backend: backend.estBudget, expected: expected.budget, equal: backend.estBudget === expected.budget },
    leveledBuyout: { backend: backend.leveledBuyout, expected: expected.leveledBuyout, equal: backend.leveledBuyout === expected.leveledBuyout },
    variance: { backend: backend.variance, expected: expected.variance, equal: backend.variance === expected.variance },
    variancePercent: { backend: Number(backend.variancePercent.toFixed(1)), expected: expected.variancePercent, equal: Math.abs(backend.variancePercent - expected.variancePercent) < 0.05 },
    gapsExposed: { backend: backend.gapsCaught, expected: expected.gapsExposed, equal: backend.gapsCaught === expected.gapsExposed },
  },
  ui,
  cleanup,
  finishedAt: new Date().toISOString(),
};
const p = writeEvidence("fix6-conv-b-demo.json", out);
console.log(JSON.stringify({ backendVsExpected: out.backendVsExpected, uiMatches: ui.matches, uiKpi: ui.kpi, uiBadges: ui.badges, cleanup, legacyBidsMissingTargetWeeks: backend.legacyBidsMissingTargetWeeks }, null, 2));
console.log("evidence:", p);