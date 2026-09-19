/**
 * QA28-02 cross-trade credit attack matrix on the round-11 fixes:
 *  - evidence gate (A25-01), known-clash allowlist (A25-02/A25-03), duplicate guards
 *  - every reachable parameter combination via the public API
 *  - zero / oversized / wrong-trade amounts and the manual-VE detector collision
 * Fixtures: AUDIT-QA28-CRED / ZERO / OVER / MANUAL.
 */
import { client, readEvidence, writeEvidence, writeLog, call } from "./qa28-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const findings = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1500)}`);
};
const finding = (id, name, detail) => {
  findings.push({ id, name, detail });
  say(`FINDING  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1500)}`);
};

const GATE_MSG = /at least one priced proposal in both Division 26 .* and Division 23/i;
const UNKNOWN_BUY = /Unknown clash id/i;
const UNKNOWN_VOID = /Unknown scope void id/i;
const ALREADY_BUY = /already been applied/i;
const ALREADY_VOID = /already been assigned/i;

async function bidsOf(pkgId) {
  return (await c.query("bids:listByPackage", { tradePackageId: pkgId })) || [];
}
async function detect(projectId) {
  return c.query("coordination:detectCrossTradeClashes", { projectId });
}
async function logs(projectId, limit = 400) {
  return (await c.query("auditLogs:listRecentLogs", { projectId, limit })) || [];
}
async function pkg(pkgId) {
  return c.query("tradePackages:getPackage", { tradePackageId: pkgId });
}
const veDeductSum = (bid) => (bid?.valueEngineeringAlternates || []).filter((v) => v.isAccepted).reduce((s, v) => s + v.costDeduct, 0);

async function main() {
  const VFD = "Variable Frequency Drives (VFDs) for AHUs & Pumps";
  const BAS = "Low-Voltage 24V BAS Control & Interlock Wiring";
  const SMOKE = "Duct Smoke Detector Installation & FACP Tie-In";
  const cred = F.cred;

  // ================= A. zero-bid state =================
  const d0 = await detect(cred.id);
  record("A28-02.1", "CRED zero bids: detect returns honest empty", d0.doubleBuys.length === 0 && d0.scopeVoids.length === 0, { summary: d0.summary });

  const ded0 = await call("deduct zero-bid", () =>
    c.mutation("coordination:deductDoubleBuyCredit", { projectId: cred.id, clashId: "clash-vfd-01", tradePackageId: cred.p23, deductAmount: 38500, description: VFD }));
  const asg0 = await call("assign zero-bid", () =>
    c.mutation("coordination:assignScopeVoidToTrade", { projectId: cred.id, voidId: "void-bas-wiring-01", tradePackageId: cred.p26, additionalCost: 28000, description: BAS }));
  const logs0 = await logs(cred.id);
  record("A28-02.2", "CRED zero bids: deduct+assign refused by evidence gate; no intent/credit audit rows",
    ded0.ok === false && GATE_MSG.test(String(ded0.data ?? "")) && asg0.ok === false && GATE_MSG.test(String(asg0.data ?? "")) &&
      logs0.filter((l) => /Double-Buy Credit|Scope Void Assigned/.test(l.title)).length === 0,
    { deduct: ded0.data, assign: asg0.data, auditRows: logs0.filter((l) => /Credit|Void/.test(l.title)).map((l) => l.title) });

  // ================= B. one-sided pricing =================
  const b23 = await c.mutation("bids:submitDirectBid", {
    tradePackageId: cred.p23, contractorId: cred.contractors.c23,
    subcontractorName: "AUDIT-QA28 CRED Mechanical", baseBidAmount: 480000, coiComplianceStatus: "compliant", coiPenalty: 0,
  });
  const d1 = await detect(cred.id);
  const ded1 = await call("deduct one-sided", () =>
    c.mutation("coordination:deductDoubleBuyCredit", { projectId: cred.id, clashId: "clash-vfd-01", tradePackageId: cred.p23, deductAmount: 38500, description: VFD }));
  const asg1 = await call("assign one-sided", () =>
    c.mutation("coordination:assignScopeVoidToTrade", { projectId: cred.id, voidId: "void-bas-wiring-01", tradePackageId: cred.p26, additionalCost: 28000, description: BAS }));
  const b23after1 = (await bidsOf(cred.p23)).find((b) => b._id === b23.bidId);
  const p26after1 = await pkg(cred.p26);
  record("A28-02.3", "CRED one-sided (HVAC only): detect empty; deduct+assign refused; bid/inclusions untouched",
    d1.doubleBuys.length === 0 && ded1.ok === false && GATE_MSG.test(String(ded1.data ?? "")) && asg1.ok === false && GATE_MSG.test(String(asg1.data ?? "")) &&
      b23after1?.leveledTotalCost === 480000 && (b23after1?.valueEngineeringAlternates || []).length === 0 &&
      !(p26after1?.mandatoryInclusions || []).includes(BAS),
    { detect: { buys: d1.doubleBuys.length, voids: d1.scopeVoids.length }, deduct: ded1.data, assign: asg1.data, hvacLeveled: b23after1?.leveledTotalCost });

  // ================= C. both priced =================
  const b26 = await c.mutation("bids:submitDirectBid", {
    tradePackageId: cred.p26, contractorId: cred.contractors.c26,
    subcontractorName: "AUDIT-QA28 CRED Electric", baseBidAmount: 800000, coiComplianceStatus: "compliant", coiPenalty: 0,
  });
  const d2 = await detect(cred.id);
  const scan = await call("scan", () => c.action("coordination:scanCrossTradeClashes", { projectId: cred.id }));
  const buyTotal = d2.doubleBuys.reduce((s, x) => s + x.redundantAmount, 0);
  const voidTotal = d2.scopeVoids.reduce((s, x) => s + x.estimatedVoidCost, 0);
  record("A28-02.4", "CRED both priced: detect 2+2; scan message reconciles with cards",
    d2.doubleBuys.length === 2 && d2.scopeVoids.length === 2 && scan.ok && scan.value?.analyzed === true &&
      scan.value?.message.includes("2 double-buy") && scan.value?.message.includes(`$${buyTotal.toLocaleString("en-US")}`) &&
      scan.value?.message.includes(`$${voidTotal.toLocaleString("en-US")}`),
    { buys: d2.doubleBuys.map((x) => ({ id: x.id, amt: x.redundantAmount, status: x.status })), scan: scan.value?.message });

  // --- parameter attacks ---
  const before = {
    p23: (await bidsOf(cred.p23)).find((b) => b._id === b23.bidId),
    p26: (await bidsOf(cred.p26)).find((b) => b._id === b26.bidId),
  };
  const unknownBuy = await call("unknown clash id", () =>
    c.mutation("coordination:deductDoubleBuyCredit", { projectId: cred.id, clashId: "clash-vfd-01-qa28-alias", tradePackageId: cred.p23, deductAmount: 38500, description: "QA28 alias" }));
  const wrongKindBuy = await call("void id used on deduct", () =>
    c.mutation("coordination:deductDoubleBuyCredit", { projectId: cred.id, clashId: "void-bas-wiring-01", tradePackageId: cred.p23, deductAmount: 38500, description: BAS }));
  const wrongKindAssign = await call("clash id used on assign", () =>
    c.mutation("coordination:assignScopeVoidToTrade", { projectId: cred.id, voidId: "clash-vfd-01", tradePackageId: cred.p26, additionalCost: 28000, description: VFD }));
  const afterAttacks = {
    p23: (await bidsOf(cred.p23)).find((b) => b._id === b23.bidId),
    p26: (await bidsOf(cred.p26)).find((b) => b._id === b26.bidId),
  };
  record("A28-02.5", "allowlist: rotated clash id and cross-kind ids all refused; no bid mutated",
    unknownBuy.ok === false && UNKNOWN_BUY.test(String(unknownBuy.data ?? "")) &&
      wrongKindBuy.ok === false && UNKNOWN_BUY.test(String(wrongKindBuy.data ?? "")) &&
      wrongKindAssign.ok === false && UNKNOWN_VOID.test(String(wrongKindAssign.data ?? "")) &&
      afterAttacks.p23?.leveledTotalCost === before.p23?.leveledTotalCost &&
      (afterAttacks.p23?.valueEngineeringAlternates || []).length === 0 &&
      (afterAttacks.p26?.lineItems || []).length === (before.p26?.lineItems || []).length,
    { unknownBuy: unknownBuy.data, wrongKindBuy: wrongKindBuy.data, wrongKindAssign: wrongKindAssign.data });

  const negBuy = await call("negative deduct", () =>
    c.mutation("coordination:deductDoubleBuyCredit", { projectId: cred.id, clashId: "clash-vfd-01", tradePackageId: cred.p23, deductAmount: -500, description: VFD }));
  const hugeBuy = await call("over-max deduct", () =>
    c.mutation("coordination:deductDoubleBuyCredit", { projectId: cred.id, clashId: "clash-vfd-01", tradePackageId: cred.p23, deductAmount: 2_000_000_000, description: VFD }));
  const negAsg = await call("negative assign", () =>
    c.mutation("coordination:assignScopeVoidToTrade", { projectId: cred.id, voidId: "void-bas-wiring-01", tradePackageId: cred.p26, additionalCost: -1, description: BAS }));
  record("A28-02.6", "bounds: negative/over-max amounts refused on deduct and assign",
    negBuy.ok === false && hugeBuy.ok === false && negAsg.ok === false,
    { negBuy: negBuy.data, hugeBuy: hugeBuy.data, negAsg: negAsg.data });

  const crossPkg = await call("package from another project", () =>
    c.mutation("coordination:deductDoubleBuyCredit", { projectId: cred.id, clashId: "clash-vfd-01", tradePackageId: F.zero.p23, deductAmount: 38500, description: VFD }));
  const crossBid = await call("bid from another package", () =>
    c.mutation("coordination:deductDoubleBuyCredit", { projectId: cred.id, clashId: "clash-vfd-01", tradePackageId: cred.p23, bidId: b26.bidId, deductAmount: 38500, description: VFD }));
  const ghostBid = await call("nonexistent bid id", () =>
    c.mutation("coordination:deductDoubleBuyCredit", { projectId: cred.id, clashId: "clash-vfd-01", tradePackageId: cred.p23, bidId: "jx0000000000000000000000000000", deductAmount: 38500, description: VFD }));
  record("A28-02.7", "scoping: foreign project package, foreign package bid, ghost bid all refused",
    crossPkg.ok === false && /does not belong to the selected project/i.test(String(crossPkg.data ?? "")) &&
      crossBid.ok === false && /does not belong to the target trade package/i.test(String(crossBid.data ?? "")) &&
      ghostBid.ok === false,
    { crossPkg: crossPkg.data, crossBid: crossBid.data, ghostBid: ghostBid.data });

  const unpricedTarget = await call("unpriced target package", () =>
    c.mutation("coordination:deductDoubleBuyCredit", { projectId: cred.id, clashId: "clash-vfd-01", tradePackageId: cred.p03, deductAmount: 38500, description: VFD }));
  const d3 = await detect(cred.id);
  const vfdCard3 = d3.doubleBuys.find((x) => x.id === "clash-vfd-01");
  const logs3 = await logs(cred.id);
  record("A28-02.8", "A25-01 convergence: unpriced target refused; no resolution/audit row written",
    unpricedTarget.ok === false && /no priced proposal yet/i.test(String(unpricedTarget.data ?? "")) &&
      vfdCard3?.status === "detected" && logs3.filter((l) => /Double-Buy Credit/.test(l.title)).length === 0,
    { refusal: unpricedTarget.data, card: vfdCard3 ? { status: vfdCard3.status, deductedAmount: vfdCard3.deductedAmount ?? null } : null });

  // --- sanctioned deduct + duplicate ---
  const ded2 = await call("deduct vfd", () =>
    c.mutation("coordination:deductDoubleBuyCredit", { projectId: cred.id, clashId: "clash-vfd-01", tradePackageId: cred.p23, bidId: b23.bidId, deductAmount: 38500, description: VFD }));
  const b23v = (await bidsOf(cred.p23)).find((b) => b._id === b23.bidId);
  const d4 = await detect(cred.id);
  const vfdCard4 = d4.doubleBuys.find((x) => x.id === "clash-vfd-01");
  const dupe = await call("duplicate deduct", () =>
    c.mutation("coordination:deductDoubleBuyCredit", { projectId: cred.id, clashId: "clash-vfd-01", tradePackageId: cred.p23, bidId: b23.bidId, deductAmount: 38500, description: "QA28 dup" }));
  const b23v2 = (await bidsOf(cred.p23)).find((b) => b._id === b23.bidId);
  const vfdLogs = (await logs(cred.id)).filter((l) => /Double-Buy Credit Deducted/.test(l.title));
  record("A28-02.9", "deduct applies exactly one credit; duplicate refused; overlay reports the applied amount",
    ded2.ok && b23v?.leveledTotalCost === 441500 && veDeductSum(b23v) === 38500 &&
      vfdCard4?.status === "deducted" && vfdCard4?.deductedAmount === 38500 && vfdCard4?.resolution === undefined &&
      dupe.ok === false && ALREADY_BUY.test(String(dupe.data ?? "")) &&
      b23v2?.leveledTotalCost === 441500 && veDeductSum(b23v2) === 38500 && vfdLogs.length === 1,
    { newLeveled: ded2.value?.newLeveledCost, card: vfdCard4, dupe: dupe.data, auditRows: vfdLogs.map((l) => l.title) });

  // second clash remains independently deductible
  const ded3 = await call("deduct disconnect", () =>
    c.mutation("coordination:deductDoubleBuyCredit", { projectId: cred.id, clashId: "clash-disconnect-02", tradePackageId: cred.p23, deductAmount: 12000, description: "Rooftop Mechanical Equipment Disconnect Switches" }));
  const b23v3 = (await bidsOf(cred.p23)).find((b) => b._id === b23.bidId);
  record("A28-02.10", "second known clash deducts independently (429,500 total; 50,500 VE combined)",
    ded3.ok && b23v3?.leveledTotalCost === 429500 && veDeductSum(b23v3) === 50500,
    { leveled: b23v3?.leveledTotalCost, ve: (b23v3?.valueEngineeringAlternates || []).map((v) => ({ d: v.description, amt: v.costDeduct })) });

  // --- assign voids ---
  const asg2 = await call("assign bas", () =>
    c.mutation("coordination:assignScopeVoidToTrade", { projectId: cred.id, voidId: "void-bas-wiring-01", tradePackageId: cred.p26, additionalCost: 28000, description: BAS }));
  const b26a = (await bidsOf(cred.p26)).find((b) => b._id === b26.bidId);
  const p26a = await pkg(cred.p26);
  const d5 = await detect(cred.id);
  const asgDup = await call("re-assign bas", () =>
    c.mutation("coordination:assignScopeVoidToTrade", { projectId: cred.id, voidId: "void-bas-wiring-01", tradePackageId: cred.p26, additionalCost: 28000, description: BAS }));
  const b26a2 = (await bidsOf(cred.p26)).find((b) => b._id === b26.bidId);
  const voidAudit1 = (await logs(cred.id)).filter((l) => /Scope Void Assigned/.test(l.title));
  record("A28-02.11", "A25-03 convergence: assign once (line+inclusion+overlay), identical re-assign refused, no double cost",
    asg2.ok && b26a?.baseBidAmount === 828000 && (b26a?.lineItems || []).filter((i) => /Assigned Scope Void/.test(i.item)).length === 1 &&
      (p26a?.mandatoryInclusions || []).includes(BAS) &&
      d5.scopeVoids.find((v) => v.id === "void-bas-wiring-01")?.status === "assigned" &&
      asgDup.ok === false && ALREADY_VOID.test(String(asgDup.data ?? "")) &&
      b26a2?.baseBidAmount === 828000 && (b26a2?.lineItems || []).filter((i) => /Assigned Scope Void/.test(i.item)).length === 1 &&
      voidAudit1.length === 1,
    { refusal: asgDup.data, base: b26a2?.baseBidAmount, inclusion: (p26a?.mandatoryInclusions || []).includes(BAS), auditRows: voidAudit1.length });

  const asg3 = await call("assign smoke", () =>
    c.mutation("coordination:assignScopeVoidToTrade", { projectId: cred.id, voidId: "void-smoke-detectors-02", tradePackageId: cred.p26, additionalCost: 18500, description: SMOKE }));
  const b26b = (await bidsOf(cred.p26)).find((b) => b._id === b26.bidId);
  const asg3dup = await call("re-assign smoke", () =>
    c.mutation("coordination:assignScopeVoidToTrade", { projectId: cred.id, voidId: "void-smoke-detectors-02", tradePackageId: cred.p26, additionalCost: 18500, description: SMOKE }));
  const b26b2 = (await bidsOf(cred.p26)).find((b) => b._id === b26.bidId);
  record("A28-02.12", "second void assigns independently; duplicate refused; base 846,500",
    asg3.ok && b26b?.baseBidAmount === 846500 && asg3dup.ok === false && b26b2?.baseBidAmount === 846500 &&
      (b26b2?.lineItems || []).filter((i) => /Assigned Scope Void/.test(i.item)).length === 2,
    { base: b26b2?.baseBidAmount, refusal: asg3dup.data });

  // ================= D. ZERO-amount credit =================
  const zeroRowBefore = (await bidsOf(F.zero.p23)).find((b) => /ZERO Mechanical/.test(b.subcontractorName));
  const zeroTry = await call("zero deduct", () =>
    c.mutation("coordination:deductDoubleBuyCredit", { projectId: F.zero.id, clashId: "clash-vfd-01", tradePackageId: F.zero.p23, deductAmount: 0, description: VFD }));
  const zeroRowAfter = (await bidsOf(F.zero.p23)).find((b) => b._id === zeroRowBefore?._id);
  const zeroRetry = await call("zero then real retry", () =>
    c.mutation("coordination:deductDoubleBuyCredit", { projectId: F.zero.id, clashId: "clash-vfd-01", tradePackageId: F.zero.p23, deductAmount: 38500, description: VFD }));
  const dZero = await detect(F.zero.id);
  const zeroCard = dZero.doubleBuys.find((x) => x.id === "clash-vfd-01");
  if (zeroTry.ok) {
    finding("A28-02.Z1", "zero-value deduct is accepted: clash is persisted as 'deducted' with $0, never applies the real credit, and the sanctioned $38,500 retry is permanently blocked",
      {
        call: zeroTry.value, leveledBefore: zeroRowBefore?.leveledTotalCost, leveledAfter: zeroRowAfter?.leveledTotalCost,
        retry: { ok: zeroRetry.ok, data: zeroRetry.data },
        cardAfter: zeroCard ? { status: zeroCard.status, deductedAmount: zeroCard.deductedAmount ?? null, resolution: zeroCard.resolution ?? null } : null,
      });
    record("A28-02.13", "zero-amount deduct probe (see finding A28-02.Z1)", false, { accepted: true });
  } else {
    record("A28-02.13", "zero-amount deduct refused", true, { refusal: zeroTry.data });
  }

  // ================= E. oversized credit =================
  const overRowBefore = (await bidsOf(F.over.p23)).find((b) => /OVER Mechanical/.test(b.subcontractorName));
  const overTry = await call("oversized deduct", () =>
    c.mutation("coordination:deductDoubleBuyCredit", { projectId: F.over.id, clashId: "clash-vfd-01", tradePackageId: F.over.p23, deductAmount: 1000000, description: VFD }));
  const overRowAfter = (await bidsOf(F.over.p23)).find((b) => b._id === overRowBefore?._id);
  const dOver = await detect(F.over.id);
  const overCard = dOver.doubleBuys.find((x) => x.id === "clash-vfd-01");
  if (overTry.ok) {
    const actualReduction = (overRowBefore?.leveledTotalCost ?? 0) - (overRowAfter?.leveledTotalCost ?? 0);
    if (overCard?.deductedAmount !== actualReduction) {
      finding("A28-02.Z2", "oversized credit overstates the buyout recovery: deductAmount is recorded as applied even when the leveled cost floors at $0",
        {
          requested: 1000000, leveledBefore: overRowBefore?.leveledTotalCost, leveledAfter: overRowAfter?.leveledTotalCost,
          actualReduction, reportedByCard: overCard?.deductedAmount ?? null, result: overTry.value,
        });
      record("A28-02.14", "oversized credit probe (see finding A28-02.Z2)", false, { actualReduction, reported: overCard?.deductedAmount });
    }
  } else {
    record("A28-02.14", "oversized credit refused", true, { refusal: overTry.data });
  }

  // ================= F. MANUAL-VE detector collision =================
  const m = F.manual;
  const mBids = await c.query("bids:listByPackage", { tradePackageId: m.p26 });
  const mBid26 = mBids.find((b) => b._id === m.bids.b26.bidId);
  const actualVfdVe = veDeductSum(mBid26);
  const dM = await detect(m.id);
  const mCard = dM.doubleBuys.find((x) => x.id === "clash-vfd-01");
  const uiComputedCredit = dM.doubleBuys.filter((d) => d.status === "deducted").reduce((s, d) => s + (typeof d.deductedAmount === "number" ? d.deductedAmount : d.redundantAmount), 0);
  if (mCard?.status === "deducted" && actualVfdVe === 1000) {
    finding("A28-02.Z3", "manual accepted VE containing 'VFD' flips the double-buy to fully responded: UI/KPI claim the static $38,500 while only $1,000 was actually accepted, and the 1-click credit button is hidden",
      {
        manualVe: (mBid26?.valueEngineeringAlternates || []).map((v) => ({ d: v.description, amt: v.costDeduct, accepted: v.isAccepted })),
        actualAcceptedVfdVe: actualVfdVe, card: { status: mCard.status, deductedAmount: mCard.deductedAmount ?? null, resolution: mCard.resolution ?? null, redundantAmount: mCard.redundantAmount },
        uiComputedRecoverableCredits: uiComputedCredit,
      });
    record("A28-02.15", "manual-VE detector collision (see finding A28-02.Z3)", false, { actualVfdVe, uiComputedCredit, resolution: mCard.resolution });
  } else {
    record("A28-02.15", "manual-VE detector collision absent", true, { actualVfdVe, card: mCard?.status });
  }
  // latent stacking: no persisted resolution exists, so the API still accepts the real credit
  const mReal = await call("real deduct after manual VE", () =>
    c.mutation("coordination:deductDoubleBuyCredit", { projectId: m.id, clashId: "clash-vfd-01", tradePackageId: m.p23, deductAmount: 38500, description: VFD }));
  const mBid26After = (await bidsOf(m.p26)).find((b) => b._id === m.bids.b26.bidId);
  const mBid23After = (await bidsOf(m.p23)).find((b) => b._id === m.bids.b23.bidId);
  const dM2 = await detect(m.id);
  const mCard2 = dM2.doubleBuys.find((x) => x.id === "clash-vfd-01");
  record("A28-02.16", "latent stacking probe: with a manual VFD VE already accepted the real credit is still applicable; card then reports only the persisted $38,500 although $39,500 total VE deducts exist",
    mReal.ok && (mBid23After?.valueEngineeringAlternates || []).length === 1 && veDeductSum(mBid26After) + veDeductSum(mBid23After) === 39500 &&
      mCard2?.deductedAmount === 38500,
    { real: mReal.value ?? mReal.data, totalVeAfter: veDeductSum(mBid26After) + veDeductSum(mBid23After), card: mCard2 ? { deductedAmount: mCard2.deductedAmount, status: mCard2.status } : null });

  writeEvidence("credit-matrix", {
    results,
    findings,
    summary: { pass: results.filter((r) => r.pass).length, total: results.length },
  });
  writeLog("credit-matrix", log);
  console.log(`credit-matrix: ${results.filter((r) => r.pass).length}/${results.length}, findings=${findings.length}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("credit-matrix-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});