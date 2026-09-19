/**
 * QA35-02 backend verification of FIX-NEW-75/76 (clash-keyed credit identity):
 *  REQ1 equal amounts: deduct VFD $12,000 + Disconnect $12,000 on one bid ->
 *       both cards deducted $12,000, KPI $24,000; un-accept ONLY VFD ->
 *       VFD card detected + staleResolution, disconnect stays deducted $12,000, KPI $12,000;
 *       reverse VFD stale -> record cleared, disconnect unchanged; leveled == recompute at every step.
 *  REQ2 over-reversal: two equal credits live, reverse one -> only that credit removed,
 *       audit/result reversedAmount equals the removed amount, other card still deducted.
 *  REQ3 legacy-format: no legacy rows exist on the deployment (probe), so one is synthesized
 *       in place (old-format description + existing note) and must still be recognized/reversible.
 * Live: https://brainy-skunk-440.convex.cloud. Never touches other fixtures.
 */
import { client, readEvidence, writeEvidence, writeLog, call, creditInvariants, creditRows, recomputeLeveled, creditClashId, sleep } from "./qa35-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const findings = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1700)}`);
};
const finding = (id, severity, title, evidence) => {
  findings.push({ id, severity, title, evidence });
  say(`FINDING ${id} [${severity}] ${title}`);
};

const VFD = "Variable Frequency Drives (VFDs) for AHUs & Pumps";
const DISC = "Rooftop Mechanical Equipment Disconnect Switches";
const F = readEvidence("fixtures");

const bidById = async (projectId, bidId) => (await c.query("bids:listAllProjectBids", { projectId })).find((b) => b._id === bidId);
const detect = (projectId) => c.query("coordination:detectCrossTradeClashes", { projectId });
const logs = (projectId, limit = 500) => c.query("auditLogs:listRecentLogs", { projectId, limit });
const rowState = (bid) => creditRows(bid).map((v) => ({ clashId: creditClashId(v.description), amount: v.costDeduct || 0, accepted: !!v.isAccepted, desc: String(v.description).slice(0, 90) }));

/** Structural + exact-value assertion for one observable step. */
function step(id, name, cond, detail) {
  record(id, name, cond, detail);
}

async function main() {
  // =========================================================================
  // REQ1/REQ2 on FIXEQ (manual $26,500 -> both redundancies exactly $12,000)
  // =========================================================================
  const { id, p23, b23 } = F.eq;
  const BID = b23.bidId;
  const manualBase = 453500;

  const d0 = await detect(id);
  const vfd0 = d0.doubleBuys.find((x) => x.id === "clash-vfd-01");
  const disc0 = d0.doubleBuys.find((x) => x.id === "clash-disconnect-02");
  record("A35-FIX.0", "EQ precondition: accepted manual VFD $26,500 collapses BOTH redundancies to exactly $12,000; bid leveled 453,500",
    vfd0.redundantAmount === 12000 && disc0.redundantAmount === 12000, { vfd: vfd0.redundantAmount, disc: disc0.redundantAmount });

  // --- step 1: deduct VFD 12,000 ---
  const d1 = await call("eq.deduct.vfd", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 12000, description: VFD }));
  const b1 = await bidById(id, BID);
  const inv1 = await creditInvariants(c, id);
  const vfd1 = inv1.cards.find((x) => x.id === "clash-vfd-01");
  const marker1 = rowState(b1)[0];
  step("A35-FIX.1", "deduct VFD $12,000: new clash-keyed marker minted; bid 441,500; card deducted 12,000; KPI 12,000 == actual 12,000; leveled == recompute",
    d1.ok && b1.leveledTotalCost === 441500 && recomputeLeveled(b1) === b1.leveledTotalCost &&
      vfd1.status === "deducted" && vfd1.deductedAmount === 12000 && inv1.claimsTotal === 12000 && inv1.actualTotal === 12000 &&
      marker1?.clashId === "clash-vfd-01" && marker1.amount === 12000 && marker1.accepted === true,
    { result: d1.value ?? d1.data, leveled: b1.leveledTotalCost, card: { status: vfd1.status, amount: vfd1.deductedAmount }, kpi: { claims: inv1.claimsTotal, actual: inv1.actualTotal }, marker: marker1 });

  // --- step 2: deduct Disconnect 12,000 (equal amount) ---
  const d2 = await call("eq.deduct.disc", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-disconnect-02", tradePackageId: p23, deductAmount: 12000, description: DISC }));
  const b2 = await bidById(id, BID);
  const inv2 = await creditInvariants(c, id);
  const vfd2 = inv2.cards.find((x) => x.id === "clash-vfd-01");
  const disc2 = inv2.cards.find((x) => x.id === "clash-disconnect-02");
  const rows2 = rowState(b2);
  step("A35-FIX.2", "equal-amount credits: both cards deducted $12,000; two distinct markers; bid 429,500; KPI $24,000 == actual $24,000; no masked/stacked/drift",
    d2.ok && b2.leveledTotalCost === 429500 && recomputeLeveled(b2) === b2.leveledTotalCost &&
      vfd2.status === "deducted" && vfd2.deductedAmount === 12000 && disc2.status === "deducted" && disc2.deductedAmount === 12000 &&
      inv2.claimsTotal === 24000 && inv2.actualTotal === 24000 && inv2.kpiVsActual === true && inv2.masked.length === 0 && inv2.stacked.length === 0 && inv2.leveledDrift.length === 0 &&
      rows2.length === 2 && new Set(rows2.map((r) => r.clashId)).size === 2,
    { result: d2.value ?? d2.data, leveled: b2.leveledTotalCost, vfd: { status: vfd2.status, amount: vfd2.deductedAmount }, disc: { status: disc2.status, amount: disc2.deductedAmount }, kpi: { claims: inv2.claimsTotal, actual: inv2.actualTotal, masked: inv2.masked, stacked: inv2.stacked, drift: inv2.leveledDrift }, rows: rows2 });

  // --- step 3: un-accept ONLY the VFD credit (exact leveling-save shape) ---
  const unacc = await call("eq.unaccept.vfd", () => c.mutation("bids:updateBidAdjustments", {
    bidId: BID,
    identifiedExclusions: [],
    valueEngineeringAlternates: (b2.valueEngineeringAlternates || []).map((v) => (String(v.description).includes(VFD) ? { ...v, isAccepted: false } : v)),
    leadTimePenalty: 0,
    coiPenalty: 0,
  }));
  const b3 = await bidById(id, BID);
  const inv3 = await creditInvariants(c, id);
  const vfd3 = inv3.cards.find((x) => x.id === "clash-vfd-01");
  const disc3 = inv3.cards.find((x) => x.id === "clash-disconnect-02");
  const staleVfd = vfd3.status === "deducted" && inv3.masked.length > 0 && !inv3.kpiVsActual;
  if (staleVfd) {
    finding("A35-01", "Medium", "Equal-amount masking persists: VFD card still claims deducted $12,000 while its own credit is declined (disconnect credit masks it)", { vfd: vfd3, masked: inv3.masked, kpi: { claims: inv3.claimsTotal, actual: inv3.actualTotal } });
  }
  step("A35-FIX.3", "un-accept ONLY VFD: VFD card detected + staleResolution=true; disconnect stays deducted $12,000; bid 441,500; KPI $12,000 == actual $12,000; leveled == recompute",
    unacc.ok && b3.leveledTotalCost === 441500 && recomputeLeveled(b3) === b3.leveledTotalCost &&
      vfd3.status === "detected" && vfd3.staleResolution === true && (vfd3.deductedAmount === undefined || vfd3.deductedAmount === null) &&
      disc3.status === "deducted" && disc3.deductedAmount === 12000 &&
      inv3.claimsTotal === 12000 && inv3.actualTotal === 12000 && inv3.kpiVsActual === true && inv3.masked.length === 0 && inv3.stacked.length === 0 && inv3.leveledDrift.length === 0,
    { leveled: b3.leveledTotalCost, vfd: { status: vfd3.status, stale: vfd3.staleResolution, amount: vfd3.deductedAmount }, disc: { status: disc3.status, amount: disc3.deductedAmount }, kpi: { claims: inv3.claimsTotal, actual: inv3.actualTotal }, rows: rowState(b3) });

  // --- step 4: reverse the stale VFD record -> record cleared, disconnect unchanged ---
  const r1 = await call("eq.reverse.vfd.stale", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
  const b4 = await bidById(id, BID);
  const inv4 = await creditInvariants(c, id);
  const vfd4 = inv4.cards.find((x) => x.id === "clash-vfd-01");
  const disc4 = inv4.cards.find((x) => x.id === "clash-disconnect-02");
  const logs4 = await logs(id);
  // The declined VFD row still exists, so reverse takes the regular branch (removes the row,
  // clears the resolution); if the row had been deleted it takes the "Record Cleared" branch.
  const audit4 = logs4.find((l) => /Double-Buy Credit Reversed: \$12,000/.test(l.title) || /Double-Buy Credit Record Cleared: clash-vfd-01/.test(l.title));
  const overReversedOnStale = b4.leveledTotalCost === manualBase || creditRows(b4).length === 0;
  if (overReversedOnStale) {
    finding("A35-02", "High", "Stale-clear over-reversal: reversing the stale VFD record removed the disconnect credit or restored the bid by $24,000", { leveled: b4.leveledTotalCost, rows: rowState(b4) });
  }
  step("A35-FIX.4", "reverse stale VFD (declined row removed + resolution cleared, audit recorded): disconnect card stays deducted $12,000; bid unchanged 441,500; VFD fully detected (no stale)",
    r1.ok && b4.leveledTotalCost === 441500 && recomputeLeveled(b4) === b4.leveledTotalCost &&
      disc4.status === "deducted" && disc4.deductedAmount === 12000 && vfd4.status === "detected" && !vfd4.staleResolution &&
      creditRows(b4).length === 1 && creditRows(b4)[0].isAccepted === true && Boolean(audit4) &&
      !(await detect(id)).doubleBuys.find((x) => x.id === "clash-vfd-01").staleResolution,
    { result: r1.value ?? r1.data, leveled: b4.leveledTotalCost, disc: { status: disc4.status, amount: disc4.deductedAmount }, vfd: { status: vfd4.status, stale: vfd4.staleResolution }, audit: audit4 ? `${audit4.title} :: ${audit4.description}` : null, rows: rowState(b4) });

  // =========================================================================
  // REQ2: two equal credits live again, reverse ONE -> only that credit removed
  // =========================================================================
  const d3 = await call("eq.rededuct.vfd", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 12000, description: VFD }));
  const b5 = await bidById(id, BID);
  const twoLive = creditRows(b5).filter((v) => v.isAccepted);
  step("A35-FIX.5", "re-deduct VFD: two equal live credits again (429,500), distinct markers, KPI 24,000 == actual 24,000",
    d3.ok && b5.leveledTotalCost === 429500 && twoLive.length === 2 && new Set(twoLive.map((v) => creditClashId(v.description))).size === 2,
    { leveled: b5.leveledTotalCost, rows: rowState(b5) });

  const r2 = await call("eq.reverse.vfd.one", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
  const b6 = await bidById(id, BID);
  const inv6 = await creditInvariants(c, id);
  const disc6 = inv6.cards.find((x) => x.id === "clash-disconnect-02");
  const rem6 = creditRows(b6);
  const revLog6 = (await logs(id)).find((l) => /Double-Buy Credit Reversed: \$12,000/.test(l.title));
  const overReversal = r2.ok && (r2.value?.reversedAmount !== 12000 || b6.leveledTotalCost !== 441500 || rem6.length !== 1);
  if (overReversal) {
    finding("A35-03", "Medium", "Over-reversal with equal-amount credits: reversing VFD removed more than the VFD credit", { result: r2.value, leveled: b6.leveledTotalCost, rows: rowState(b6) });
  }
  step("A35-FIX.6", "reverse VFD only: reversedAmount==12000, audit 'Reversed: $12,000', disconnect row survives accepted, bid 441,500, no drift",
    r2.ok && r2.value?.reversedAmount === 12000 && r2.value?.newLeveledCost === 441500 &&
      b6.leveledTotalCost === 441500 && recomputeLeveled(b6) === b6.leveledTotalCost &&
      rem6.length === 1 && rem6[0].isAccepted === true && String(rem6[0].description).includes("[clash-disconnect-02]") &&
      disc6.status === "deducted" && disc6.deductedAmount === 12000 && inv6.kpiVsActual === true && inv6.leveledDrift.length === 0 &&
      Boolean(revLog6) && /restored to \$441,500/.test(revLog6.description),
    { result: r2.value, leveled: b6.leveledTotalCost, rows: rowState(b6), disc: { status: disc6.status, amount: disc6.deductedAmount }, audit: revLog6?.description });

  // clean finish: reverse disconnect -> full restore to manual base
  const r3 = await call("eq.reverse.disc.final", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-disconnect-02", tradePackageId: p23 }));
  const b7 = await bidById(id, BID);
  const inv7 = await creditInvariants(c, id);
  step("A35-FIX.7", "final reverse disconnect: bid restored to exactly 453,500 (manual $26,500 only), both cards detected, zero credits/stale",
    r3.ok && r3.value?.reversedAmount === 12000 && b7.leveledTotalCost === manualBase && recomputeLeveled(b7) === manualBase &&
      creditRows(b7).length === 0 && (b7.valueEngineeringAlternates || []).length === 1 && String((b7.valueEngineeringAlternates || [])[0]?.description).includes("manual entry") &&
      inv7.deductedCards.length === 0 && inv7.staleCards.length === 0,
    { result: r3.value, leveled: b7.leveledTotalCost, ve: (b7.valueEngineeringAlternates || []).map((v) => ({ d: String(v.description).slice(0, 60), a: v.costDeduct, ok: v.isAccepted })) });

  // deleted-row stale branch: deduct again, delete the row entirely (manual leveling save that
  // drops it), then reverse -> "Record Cleared" audit, no bid mutation, card fully detected.
  const dDel = await call("eq.deduct.vfd.deleted", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 12000, description: VFD }));
  const bDel1 = await bidById(id, BID);
  const delRow = await call("eq.delete.vfd.row", () => c.mutation("bids:updateBidAdjustments", {
    bidId: BID,
    identifiedExclusions: [],
    valueEngineeringAlternates: (bDel1.valueEngineeringAlternates || []).filter((v) => creditClashId(v.description) !== "clash-vfd-01"),
    leadTimePenalty: 0,
    coiPenalty: 0,
  }));
  const bDel2 = await bidById(id, BID);
  const vfdDel = (await detect(id)).doubleBuys.find((x) => x.id === "clash-vfd-01");
  const clearDeleted = await call("eq.clear.stale.deleted", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
  const bDel3 = await bidById(id, BID);
  const clearedLog = (await logs(id)).find((l) => /Double-Buy Credit Record Cleared: clash-vfd-01/.test(l.title));
  step("A35-FIX.9", "deleted-row stale branch: row removed entirely -> staleResolution; reverse clears the record via 'Record Cleared' audit, bid untouched at 453,500, card fully detected",
    dDel.ok && delRow.ok && bDel2.leveledTotalCost === manualBase && vfdDel.status === "detected" && vfdDel.staleResolution === true &&
      clearDeleted.ok && /no longer carried|no proposal carried/.test(String(clearDeleted.value?.note || "")) && bDel3.leveledTotalCost === manualBase &&
      Boolean(clearedLog) && !(await detect(id)).doubleBuys.find((x) => x.id === "clash-vfd-01").staleResolution,
    { clear: clearDeleted.value ?? clearDeleted.data, audit: clearedLog ? `${clearedLog.title} :: ${clearedLog.description}` : null, leveleds: { afterDelete: bDel2.leveledTotalCost, afterClear: bDel3.leveledTotalCost }, dDel: dDel.ok ? dDel.value : dDel.data, delRow: delRow.ok ? delRow.value : delRow.data, vfdDel: { status: vfdDel?.status, stale: vfdDel?.staleResolution, redundant: vfdDel?.redundantAmount }, clearOk: clearDeleted.ok, afterStale: (await detect(id)).doubleBuys.find((x) => x.id === "clash-vfd-01")?.staleResolution });

  // =========================================================================
  // REQ3: legacy-format recognition (synthesized; none exist in any fixture)
  // =========================================================================
  {
    const L = F.legacy;
    const ld = await call("legacy.deduct", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: L.id, clashId: "clash-vfd-01", tradePackageId: L.p23, deductAmount: 38500, description: VFD }));
    const lb1 = await bidById(L.id, L.b23.bidId);
    const legacyDesc = `Cross-Trade Clash Credit: Deduct redundant ${VFD}`;
    const rewrite = await call("legacy.rewrite.row", () => c.mutation("bids:updateBidAdjustments", {
      bidId: L.b23.bidId,
      identifiedExclusions: [],
      valueEngineeringAlternates: (lb1.valueEngineeringAlternates || []).map((v) => (String(v.description).startsWith("Cross-Trade Clash Credit [clash-vfd-01]:") ? { ...v, description: legacyDesc } : v)),
      leadTimePenalty: 0,
      coiPenalty: 0,
    }));
    const ld2 = await detect(L.id);
    const legacyCard = ld2.doubleBuys.find((x) => x.id === "clash-vfd-01");
    const recognized = legacyCard.status === "deducted" && legacyCard.deductedAmount === 38500;
    const lr = await call("legacy.reverse", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: L.id, clashId: "clash-vfd-01", tradePackageId: L.p23 }));
    const lb2 = await bidById(L.id, L.b23.bidId);
    const ld3 = await detect(L.id);
    step("A35-FIX.8", "legacy-format credit (synthesized old-format description + existing note): still recognized as deducted, reversible with reversedAmount 38,500, bid restored 480,000",
      ld.ok && rewrite.ok && recognized && lr.ok && lr.value?.reversedAmount === 38500 && lb2.leveledTotalCost === 480000 && creditRows(lb2).length === 0 && ld3.doubleBuys.find((x) => x.id === "clash-vfd-01").status === "detected",
      { recognized, legacyCard: { status: legacyCard?.status, amount: legacyCard?.deductedAmount }, reverse: lr.value ?? lr.data, leveled: lb2.leveledTotalCost });
  }

  writeEvidence("fix-backend", { results, findings, summary: { pass: results.filter((r) => r.pass).length, total: results.length, findings: findings.length } });
  writeLog("fix-backend", log);
  console.log(`fix-backend: ${results.filter((r) => r.pass).length}/${results.length} pass, ${findings.length} findings`);
  if (findings.length) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeEvidence("fix-backend", { results: [...results, { id: "A35-02.ERR", pass: false, name: "aborted", detail: String(e?.stack ?? e) }], findings });
  writeLog("fix-backend", [...log, String(e?.stack ?? e)]);
  process.exit(1);
});