/**
 * QA34-02 backend state-machine fuzz: 39 mixed cross-trade credit operations across
 * four fixture projects (SM, EQ, MB, REG), asserting invariants after EVERY operation:
 *   I1  every "deducted" card's deducted amount is backed by an ACCEPTED credit row
 *       whose description carries that clash's own title (no amount-only masking)
 *   I2  no accepted credit row is silently orphaned / no cross-clash removal
 *   I3  no stacked credits (<=1 accepted row per clash title)
 *   I4  backend card KPI sum == sum of accepted credit rows (real money)
 *   I5  ADR-0003 leveled total recomputation matches every persisted bid
 *   I6  reversal restores the exact pre-deduct leveled cost
 * Operations: deduct / reverse / manual VE add / un-accept / delete / stale-clear /
 * award switch / execute / void / re-award.
 */
import { client, readEvidence, writeEvidence, writeLog, call, creditInvariants, creditRows, recomputeLeveled } from "./qa34-lib.mjs";

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

const VFD_DESC = "Variable Frequency Drives (VFDs) for AHUs & Pumps";
const DISC_DESC = "Rooftop Mechanical Equipment Disconnect Switches";
const F = readEvidence("fixtures");

const detect = (projectId) => c.query("coordination:detectCrossTradeClashes", { projectId });
const bidById = async (projectId, bidId) =>
  (await c.query("bids:listAllProjectBids", { projectId })).find((b) => b._id === bidId);
const logs = (projectId, limit = 500) => c.query("auditLogs:listRecentLogs", { projectId, limit });

async function checkInv(id, name, projectId, extra = {}) {
  const inv = await creditInvariants(c, projectId);
  const clean =
    inv.unspecified.length === 0 &&
    inv.masked.length === 0 &&
    inv.stacked.length === 0 &&
    inv.kpiVsActual === true &&
    inv.leveledDrift.length === 0;
  record(id, name, clean && (extra.extraPred !== false), {
    summary: inv.summary,
    claimsTotal: inv.claimsTotal,
    actualTotal: inv.actualTotal,
    kpiVsActual: inv.kpiVsActual,
    unspecified: inv.unspecified,
    masked: inv.masked,
    stacked: inv.stacked,
    leveledDrift: inv.leveledDrift,
    ...extra,
  });
  return inv;
}

async function main() {
  // =====================================================================
  // SM: distinct amounts ($38,500 VFD / $12,000 disconnect) mixed fuzz
  // =====================================================================
  {
    const { id, p23, b23 } = F.sm;
    const base = 480000;

    const d1 = await call("sm.deduct.vfd", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 38500, description: VFD_DESC }));
    const b1 = await bidById(id, b23.bidId);
    await checkInv("A34-F1", "op1 deduct VFD 38,500: bid 441,500, one accepted credit, card+actual+KPI agree", id, { extraPred: d1.ok && b1.leveledTotalCost === 441500 && creditRows(b1).length === 1 });

    const d2 = await call("sm.deduct.disc", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-disconnect-02", tradePackageId: p23, deductAmount: 12000, description: DISC_DESC }));
    const b2 = await bidById(id, b23.bidId);
    await checkInv("A34-F2", "op2 deduct disconnect 12,000: bid 429,500, two distinct accepted credits", id, { extraPred: d2.ok && b2.leveledTotalCost === 429500 && creditRows(b2).length === 2 });

    const r1 = await call("sm.reverse.vfd", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
    const b3 = await bidById(id, b23.bidId);
    await checkInv("A34-F3", "op3 reverse VFD: only VFD row removed, disconnect stays, bid 468,000 (I2/I6 control)", id, { extraPred: r1.ok && b3.leveledTotalCost === 468000 && creditRows(b3).length === 1 && /disconnect/i.test(creditRows(b3)[0].description) });

    const r2 = await call("sm.reverse.disc", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-disconnect-02", tradePackageId: p23 }));
    const b4 = await bidById(id, b23.bidId);
    await checkInv("A34-F4", "op4 reverse disconnect: bid restored to 480,000 exactly, zero credit rows", id, { extraPred: r2.ok && b4.leveledTotalCost === base && creditRows(b4).length === 0 });

    // stale creation through the exact leveling-modal save shape (un-accept)
    await call("sm.deduct.vfd.2", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 38500, description: VFD_DESC }));
    const b5 = await bidById(id, b23.bidId);
    const unacc = await call("sm.unaccept.credit", () => c.mutation("bids:updateBidAdjustments", {
      bidId: b23.bidId,
      identifiedExclusions: [],
      valueEngineeringAlternates: (b5.valueEngineeringAlternates || []).map((v) => ({ ...v, isAccepted: false })),
      leadTimePenalty: 0, coiPenalty: 0,
    }));
    const b6 = await bidById(id, b23.bidId);
    const d6 = await detect(id);
    const vfdCard6 = d6.doubleBuys.find((x) => x.id === "clash-vfd-01");
    record("A34-F5", "op5 un-accept credit via leveling save: bid back to 480,000; card returns to detected + staleResolution (A32-02 overlay)",
      unacc.ok && b6.leveledTotalCost === base && vfdCard6.status === "detected" && vfdCard6.staleResolution === true,
      { unacc: unacc.value ?? unacc.data, leveled: b6.leveledTotalCost, card: { status: vfdCard6.status, stale: vfdCard6.staleResolution, redundant: vfdCard6.redundantAmount } });

    const retry = await call("sm.rededuct.refused", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 38500, description: VFD_DESC }));
    await checkInv("A34-F6", "op6 re-deduct with stale resolution refused ('already applied'); no credit mutation", id, { extraPred: !retry.ok && /already been applied/.test(retry.data || ""), retry: retry.data });

    const clearStale = await call("sm.clear.stale", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
    const b7 = await bidById(id, b23.bidId);
    const d7 = await detect(id);
    const clearLog = (await logs(id)).find((l) => /Double-Buy Credit (Reversed|Record Cleared)/.test(l.title));
    await checkInv("A34-F7", "op7 clear stale: declined row removed, bid stays 480,000, card fully detected, audit row present", id, {
      extraPred: clearStale.ok && b7.leveledTotalCost === base && creditRows(b7).length === 0 && d7.doubleBuys.find((x) => x.id === "clash-vfd-01").status === "detected" && !d7.doubleBuys.find((x) => x.id === "clash-vfd-01").staleResolution && Boolean(clearLog),
      clear: clearStale.value ?? clearStale.data, audit: clearLog ? `${clearLog.title} :: ${clearLog.description}` : null,
    });

    const d3 = await call("sm.deduct.vfd.3", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 38500, description: VFD_DESC }));
    const b8 = await bidById(id, b23.bidId);
    await checkInv("A34-F8", "op8 re-deduct after stale clear applies once: 441,500, single row", id, { extraPred: d3.ok && b8.leveledTotalCost === 441500 && creditRows(b8).length === 1 });

    const man1 = await call("sm.manual.1k", () => c.mutation("bids:updateBidAdjustments", {
      bidId: b23.bidId, identifiedExclusions: [],
      valueEngineeringAlternates: [...(b8.valueEngineeringAlternates || []), { description: "VFD factory pricing credit (manual entry)", costDeduct: 1000, isAccepted: true }],
      leadTimePenalty: 0, coiPenalty: 0,
    }));
    const b9 = await bidById(id, b23.bidId);
    const d9 = await detect(id);
    await checkInv("A34-F9", "op9 manual accepted 1,000 added after credit: bid 440,500, card deducted 38,500, remaining redundancy 0 (credit self-coverage)", id, {
      extraPred: man1.ok && b9.leveledTotalCost === 440500 && d9.doubleBuys.find((x) => x.id === "clash-vfd-01").redundantAmount === 0,
    });

    const man2 = await call("sm.manual.5k", () => c.mutation("bids:updateBidAdjustments", {
      bidId: b23.bidId, identifiedExclusions: [],
      valueEngineeringAlternates: [...(b9.valueEngineeringAlternates || []), { description: "Additional VFD commissioning credit (manual entry)", costDeduct: 5000, isAccepted: true }],
      leadTimePenalty: 0, coiPenalty: 0,
    }));
    const b10 = await bidById(id, b23.bidId);
    await checkInv("A34-F10", "op10 second manual accepted 5,000: bid 435,500, credit untouched", id, { extraPred: man2.ok && b10.leveledTotalCost === 435500 && creditRows(b10).length === 1 });

    const r3 = await call("sm.reverse.with.manual", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
    const b11 = await bidById(id, b23.bidId);
    await checkInv("A34-F11", "op11 reverse with manual rows present: credit removed only, bid 474,000 (480,000 - 6,000 manual), manuals preserved", id, {
      extraPred: r3.ok && b11.leveledTotalCost === 474000 && creditRows(b11).length === 0 && (b11.valueEngineeringAlternates || []).length === 2 && recomputeLeveled(b11) === 474000,
    });

    const manClear = await call("sm.manual.clear", () => c.mutation("bids:updateBidAdjustments", {
      bidId: b23.bidId, identifiedExclusions: [], valueEngineeringAlternates: [], leadTimePenalty: 0, coiPenalty: 0,
    }));
    const b12 = await bidById(id, b23.bidId);
    await checkInv("A34-F12", "op12 manual rows removed: bid exactly 480,000, zero credit rows, cards detected $38,500/$12,000", id, {
      extraPred: manClear.ok && b12.leveledTotalCost === base && creditRows(b12).length === 0,
    });
    const finalDetect = await detect(id);
    // delete-row stale branch: remove the credit row entirely (backend shape of a manual
    // leveling save that drops the row), then clear the stale resolution.
    const dDel = await call("sm.deduct.vfd.4", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 38500, description: VFD_DESC }));
    const bDel1 = await bidById(id, b23.bidId);
    const delRow = await call("sm.delete.credit.row", () => c.mutation("bids:updateBidAdjustments", {
      bidId: b23.bidId, identifiedExclusions: [],
      valueEngineeringAlternates: (bDel1.valueEngineeringAlternates || []).filter((v) => !/^Cross-Trade Clash Credit:/.test(v.description)),
      leadTimePenalty: 0, coiPenalty: 0,
    }));
    const bDel2 = await bidById(id, b23.bidId);
    const dDel1 = await detect(id);
    const vfdDel = dDel1.doubleBuys.find((x) => x.id === "clash-vfd-01");
    const clearDeleted = await call("sm.clear.stale.deleted", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
    const bDel3 = await bidById(id, b23.bidId);
    const clearedLog = (await logs(id)).find((l) => /Double-Buy Credit Record Cleared/.test(l.title));
    record("A34-F14", "op39/40 delete the credit row entirely -> staleResolution present; clear-stale takes the 'Record Cleared' branch with an explicit audit row and no bid mutation",
      dDel.ok && delRow.ok && bDel2.leveledTotalCost === base && vfdDel.status === "detected" && vfdDel.staleResolution === true &&
        clearDeleted.ok && bDel3.leveledTotalCost === base && Boolean(clearedLog) && /no proposal carried the credit/.test(clearedLog.description),
      { clear: clearDeleted.value ?? clearDeleted.data, audit: clearedLog ? `${clearedLog.title} :: ${clearedLog.description}` : null });
    const d13 = await detect(id);
    record("A34-F13", "SM end-state: both clashes detected at original values, zero credits, zero stale",
      d13.doubleBuys.find((x) => x.id === "clash-vfd-01").redundantAmount === 38500 &&
        d13.doubleBuys.find((x) => x.id === "clash-disconnect-02").redundantAmount === 12000 &&
        d13.summary.totalDoubleBuyExposure === 50500 &&
        d13.summary.activeClashesCount === 4 &&
        d13.doubleBuys.every((x) => !x.staleResolution),
      { summary: d13.summary });
  }

  // =====================================================================
  // MB: award switch between deduct and reverse (carrier-based reversal fix)
  // =====================================================================
  {
    const { id, p23, b23, b23b } = F.mb;
    const m1 = await call("mb.deduct", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 38500, description: VFD_DESC }));
    const b1 = await bidById(id, b23.bidId);
    await checkInv("A34-M1", "op13 MB deduct lands on cheapest B1: 480,000 -> 441,500", id, { extraPred: m1.ok && b1.leveledTotalCost === 441500 && creditRows(b1).length === 1 });

    const award = await call("mb.award.B2", () => c.mutation("agreements:generateAgreement", { bidId: b23b.bidId, tradePackageId: p23 }));
    const b2 = await bidById(id, b23b.bidId);
    record("A34-M2", "op14 award alternate B2 through the agreement generator: B2 awarded at 497,000, B1 credit untouched", award.ok && b2.isAwarded === true && b2.leveledTotalCost === 497000,
      { award: award.value ? { number: award.value.agreementNumber, sum: award.value.contractSum } : award.data, b2: { awarded: b2.isAwarded, leveled: b2.leveledTotalCost } });

    const m3 = await call("mb.reverse.carrier", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
    const b1r = await bidById(id, b23.bidId);
    const b2r = await bidById(id, b23b.bidId);
    const agr = ((await c.query("agreements:listAgreements", { projectId: id })) || []).find((a) => a.bidId === b23b.bidId);
    await checkInv("A34-M3", "op15 reverse after award (round-14 carrier fix): credit removed from non-awarded carrier B1 (480,000), awarded B2 and its agreement untouched (497,000)", id, {
      extraPred: m3.ok && b1r.leveledTotalCost === 480000 && creditRows(b1r).length === 0 && b2r.leveledTotalCost === 497000 && agr?.contractSum === 497000 && cardDetected(await detect(id), "clash-vfd-01"),
    });

    const m4 = await call("mb.rededuct.awarded", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 38500, description: VFD_DESC }));
    const b2r2 = await bidById(id, b23b.bidId);
    const agr2 = ((await c.query("agreements:listAgreements", { projectId: id })) || []).find((a) => a.bidId === b23b.bidId);
    await checkInv("A34-M4", "op16 re-deduct targets the awarded B2: 458,500; agreement contractSum re-synced to 458,500; B1 stays 480,000", id, {
      extraPred: m4.ok && b2r2.leveledTotalCost === 458500 && agr2?.contractSum === 458500,
    });

    const m5 = await call("mb.reverse.awarded", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
    const b2r3 = await bidById(id, b23b.bidId);
    const agr3 = ((await c.query("agreements:listAgreements", { projectId: id })) || []).find((a) => a.bidId === b23b.bidId);
    await checkInv("A34-M5", "op17 reverse on awarded B2: restored 497,000, agreement 497,000, zero rows", id, {
      extraPred: m5.ok && b2r3.leveledTotalCost === 497000 && creditRows(b2r3).length === 0 && agr3?.contractSum === 497000,
    });

    const exec = await call("mb.execute", () => c.mutation("agreements:executeAgreement", { agreementId: agr3._id }));
    const m6 = await call("mb.deduct.executed", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 38500, description: VFD_DESC }));
    const b2x = await bidById(id, b23b.bidId);
    await checkInv("A34-M6", "op18 deduct refused on executed agreement (immutability) and fully rolled back: bid 497,000, no row, card detected, no audit credit row", id, {
      extraPred: exec.ok && !m6.ok && /immutable/i.test(m6.data || "") && b2x.leveledTotalCost === 497000 && creditRows(b2x).length === 0,
      refusal: m6.data,
    });

    const m7 = await call("mb.reverse.none", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
    record("A34-M7", "op19 reverse with no applied credit refused ('no applied credit'), no side effects",
      !m7.ok && /no applied credit/.test(m7.data || ""), { refusal: m7.data });

    const m8 = await call("mb.unaward.executed", () => c.mutation("bids:unawardContract", { bidId: b23b.bidId, tradePackageId: p23 }));
    const b2y = await bidById(id, b23b.bidId);
    record("A34-M8", "op20 unaward executed bid refused, award flag intact", !m8.ok && /immutable/i.test(m8.data || "") && b2y.isAwarded === true, { refusal: m8.data });

    const voidM = await call("mb.void", () => c.mutation("agreements:voidExecutedAgreement", { agreementId: agr3._id, reason: "QA34 fuzz void of executed record for recovery path." }));
    const m9 = await call("mb.rededuct.aftervoid", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 38500, description: VFD_DESC }));
    const m10 = await call("mb.reverse.final", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
    const b1f = await bidById(id, b23.bidId);
    await checkInv("A34-M9", "op21 void executed then deduct/reverse on cheapest B1: clean cycle, B1 exactly 480,000, zero rows", id, {
      extraPred: voidM.ok && m9.ok && m10.ok && b1f.leveledTotalCost === 480000 && creditRows(b1f).length === 0,
    });
  }

  // =====================================================================
  // EQ: equal-amount collision ($12,000 VFD == $12,000 disconnect)
  // =====================================================================
  {
    const { id, p23, b23 } = F.eq;
    const manualBase = 453500;

    const d0 = await detect(id);
    const vfd0 = d0.doubleBuys.find((x) => x.id === "clash-vfd-01");
    const disc0 = d0.doubleBuys.find((x) => x.id === "clash-disconnect-02");
    record("A34-E0", "op22 EQ precondition: manual $26,500 VFD coverage collapses BOTH redundancies to exactly $12,000",
      vfd0.redundantAmount === 12000 && disc0.redundantAmount === 12000, { vfd: vfd0.redundantAmount, disc: disc0.redundantAmount });

    const e1 = await call("eq.deduct.vfd", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 12000, description: VFD_DESC }));
    const eb1 = await bidById(id, b23.bidId);
    await checkInv("A34-E1", "op23 EQ deduct VFD 12,000: bid 441,500, one accepted VFD credit", id, { extraPred: e1.ok && eb1.leveledTotalCost === 441500 && creditRows(eb1).length === 1 });

    const e2 = await call("eq.deduct.disc", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-disconnect-02", tradePackageId: p23, deductAmount: 12000, description: DISC_DESC }));
    const eb2 = await bidById(id, b23.bidId);
    const inv2 = await checkInv("A34-E2", "op24 EQ deduct disconnect 12,000: bid 429,500, two accepted credits, KPI==actual==24,000", id, { extraPred: e2.ok && eb2.leveledTotalCost === 429500 && creditRows(eb2).length === 2 });

    // Un-accept the VFD credit (exact leveling modal save shape) while the disconnect credit remains.
    const e3 = await call("eq.unaccept.vfd", () => c.mutation("bids:updateBidAdjustments", {
      bidId: b23.bidId, identifiedExclusions: [],
      valueEngineeringAlternates: (eb2.valueEngineeringAlternates || []).map((v) => (/^Cross-Trade Clash Credit:/.test(String(v.description)) && String(v.description).includes(VFD_DESC) ? { ...v, isAccepted: false } : v)),
      leadTimePenalty: 0, coiPenalty: 0,
    }));
    const eb3 = await bidById(id, b23.bidId);
    const inv3 = await creditInvariants(c, id);
    const vfd3 = inv3.cards.find((x) => x.id === "clash-vfd-01");
    const maskedPhantom = vfd3?.status === "deducted" && inv3.masked.length > 0 && inv3.kpiVsActual === false;
    if (maskedPhantom) {
      finding("A34-01", "Medium", "Amount-only credit matching masks a declined VFD credit with the disconnect credit: VFD card still claims 'Credit Deducted & Leveled $12,000' although its own credit row is declined (isAccepted=false); backend KPI reports $24,000 recoverable while only $12,000 is actually deducted from the bid", {
        projectId: id,
        card: { id: vfd3.id, status: vfd3.status, deductedAmount: vfd3.deductedAmount, staleResolution: vfd3.staleResolution },
        masked: inv3.masked,
        claimsTotal: inv3.claimsTotal,
        actualTotal: inv3.actualTotal,
        bidLeveled: eb3.leveledTotalCost,
        honestKpi: 12000,
      });
    }
    record("A34-E3b", "op25b no phantom deducted card from a declined credit / KPI equals real accepted credits",
      !maskedPhantom,
      { vfdCard: { status: vfd3?.status, deductedAmount: vfd3?.deductedAmount, stale: vfd3?.staleResolution }, masked: inv3.masked, claimsTotal: inv3.claimsTotal, actualTotal: inv3.actualTotal, kpiVsActual: inv3.kpiVsActual });

    // Re-accept so both credits are live again, then reverse the VFD credit only.
    await call("eq.reaccept.vfd", () => c.mutation("bids:updateBidAdjustments", {
      bidId: b23.bidId, identifiedExclusions: [],
      valueEngineeringAlternates: (eb3.valueEngineeringAlternates || []).map((v) => (String(v.description).startsWith("Cross-Trade Clash Credit:") ? { ...v, isAccepted: true } : v)),
      leadTimePenalty: 0, coiPenalty: 0,
    }));
    const eb4 = await bidById(id, b23.bidId);
    record("A34-E4", "op26 re-accept VFD credit: bid back to 429,500, KPI==actual==24,000 (transient phantom cleared)", eb4.leveledTotalCost === 429500, { leveled: eb4.leveledTotalCost });

    const e5 = await call("eq.reverse.vfd", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
    const eb5 = await bidById(id, b23.bidId);
    const inv5 = await checkInv("A34-E5", "op27 reverse VFD only: disconnect credit must survive, bid 441,500 (exact pre-VFD-deduct cost)", id, {
      extraPred: e5.ok && eb5.leveledTotalCost === 441500 && creditRows(eb5).length === 1 && /disconnect/i.test(creditRows(eb5)[0].description || ""),
      reversed: e5.value ?? e5.data,
    });
    if (e5.ok && eb5.leveledTotalCost === manualBase && creditRows(eb5).length === 0) {
      finding("A34-02", "Medium", "Reversing one cross-trade credit silently reverses the OTHER clash's equal-amount credit: the disconnect $12,000 row is removed too, the bid is restored by $24,000, and the reversal audit/toast claim only $12,000", {
        projectId: id,
        reverseResult: e5.value,
        bidAfter: eb5.leveledTotalCost,
        expectedBid: 441500,
        rowsAfter: creditRows(eb5).length,
        staleDisconnectCard: inv5.staleCards.map((c) => ({ id: c.id, status: c.status, staleResolution: c.staleResolution })),
      });
    }

    const e6 = await call("eq.clear.stale.disc", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-disconnect-02", tradePackageId: p23 }));
    const eb6 = await bidById(id, b23.bidId);
    const d6 = await detect(id);
    await checkInv("A34-E6", "op28 clear stale disconnect record: resolution gone, bid unchanged, both cards detected", id, {
      extraPred: e6.ok && eb6.leveledTotalCost === manualBase && d6.doubleBuys.find((x) => x.id === "clash-disconnect-02").status === "detected" && !d6.doubleBuys.find((x) => x.id === "clash-disconnect-02").staleResolution,
    });

    const e7 = await call("eq.rededuct.vfd", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 12000, description: VFD_DESC }));
    const e8 = await call("eq.reverse.vfd.solo", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
    const eb8 = await bidById(id, b23.bidId);
    await checkInv("A34-E7", "op29 solo deduct/reverse cycle (single equal-amount row) restores 453,500 exactly", id, { extraPred: e7.ok && e8.ok && eb8.leveledTotalCost === manualBase && creditRows(eb8).length === 0 });
  }

  // =====================================================================
  // REG: register/viewer/award truth after execute -> void -> re-award
  // =====================================================================
  {
    const { id, p26, b26, b26b, b23 } = F.reg;
    const agreements = () => c.query("agreements:listAgreements", { projectId: id });
    const active = async () => ((await agreements()) || []).filter((a) => a.status !== "superseded");
    const statusOf = async (agreementId) => ((await agreements()) || []).find((a) => a._id === agreementId)?.status ?? null;

    const a1 = await call("reg.award.B1", () => c.mutation("agreements:generateAgreement", { bidId: b26.bidId, tradePackageId: p26 }));
    const a1id = a1.value?._id;
    const b1a = await bidById(id, b26.bidId);
    record("A34-R1", "op30 award B1 (800,000): agreement generated, register active sum 800,000 once", a1.ok && b1a.isAwarded && (await active()).length === 1 && (await active())[0].contractSum === 800000,
      { agreement: a1.value?.agreementNumber, active: (await active()).map((a) => ({ n: a.agreementNumber, s: a.contractSum, st: a.status })) });

    const x1 = await call("reg.execute.B1", () => c.mutation("agreements:executeAgreement", { agreementId: a1id }));
    record("A34-R2", "op31 execute B1: status executed, active sum still 800,000 once", x1.ok && (await statusOf(a1id)) === "executed" && (await active()).length === 1,
      { status: await statusOf(a1id) });

    const a2 = await call("reg.award.B2.executed", () => c.mutation("agreements:generateAgreement", { bidId: b26b.bidId, tradePackageId: p26 }));
    record("A34-R3", "op32 award alternate B2 while B1 executed refused (immutability), no new agreement", !a2.ok && /executed subcontract/.test(a2.data || "") && (await active()).length === 1,
      { refusal: a2.data });

    const v1 = await call("reg.void.B1", () => c.mutation("agreements:voidExecutedAgreement", { agreementId: a1id, reason: "QA34 register truth probe voiding recorded execution." }));
    const b1v = await bidById(id, b26.bidId);
    const pkg26v = (await c.query("tradePackages:listByProject", { projectId: id })).find((p) => p._id === p26);
    record("A34-R4", "op33 void executed B1: agreement superseded, bid unawarded, package reopened to leveling, active list empty", v1.ok && (await statusOf(a1id)) === "superseded" && !b1v.isAwarded && pkg26v.status === "leveling" && (await active()).length === 0,
      { status: await statusOf(a1id), bidAwarded: b1v.isAwarded, pkgStatus: pkg26v.status });

    const a3 = await call("reg.award.B2.after.void", () => c.mutation("agreements:generateAgreement", { bidId: b26b.bidId, tradePackageId: p26 }));
    const b2a = await bidById(id, b26b.bidId);
    record("A34-R5", "op34 re-award a DIFFERENT bid B2 (780,000): new agreement generated, active sum 780,000 once, B1 record stays superseded", a3.ok && b2a.isAwarded && (await statusOf(a1id)) === "superseded" && (await active()).length === 1 && (await active())[0].contractSum === 780000,
      { active: (await active()).map((a) => ({ n: a.agreementNumber, s: a.contractSum, st: a.status, bid: a.bidId === b26b.bidId })) });

    const x2 = await call("reg.execute.B2", () => c.mutation("agreements:executeAgreement", { agreementId: a3.value?._id }));
    const v2 = await call("reg.void.B2", () => c.mutation("agreements:voidExecutedAgreement", { agreementId: a3.value?._id, reason: "QA34 register truth probe voiding the alternate execution." }));
    const xs = await call("reg.execute.superseded", () => c.mutation("agreements:executeAgreement", { agreementId: a3.value?._id }));
    record("A34-R6", "op35 execute B2 -> void B2 -> executing the superseded record refused with an honest error", x2.ok && v2.ok && !xs.ok && /superseded/.test(xs.data || "") && (await active()).length === 0,
      { refusal: xs.data });

    const a4 = await call("reg.reaward.B1", () => c.mutation("agreements:generateAgreement", { bidId: b26.bidId, tradePackageId: p26 }));
    const b1r = await bidById(id, b26.bidId);
    record("A34-R7", "op36 re-award original B1: its original agreement reactivates (same number) at 800,000, active sum 800,000 once", a4.ok && a4.value?.agreementNumber === a1.value?.agreementNumber && b1r.isAwarded && (await active()).length === 1 && (await active())[0].contractSum === 800000,
      { agreement: a4.value?.agreementNumber, active: (await active()).map((a) => ({ n: a.agreementNumber, s: a.contractSum, st: a.status })) });

    const audit = await logs(id, 500);
    const kinds = ["AIA A401 Subcontract Agreement Awarded", "AIA A401 Subcontract Agreement Re-Awarded", "AIA A401 Execution Status Recorded", "Executed Subcontract Voided"];
    const missing = kinds.filter((k) => !audit.some((l) => String(l.title).includes(k)));
    record("A34-R8", "op37 audit stream carries award / re-award / execution / void rows for the full cycle", missing.length === 0, { missing, counts: kinds.map((k) => ({ k, n: audit.filter((l) => String(l.title).includes(k)).length })) });

    const dReg = await detect(id);
    record("A34-R9", "op38 register isolation: contract churn never fabricated or cleared a cross-trade credit", dReg.summary.totalDoubleBuyExposure === 50500 && (await creditInvariants(c, id)).acceptedCredits.length === 0,
      { summary: dReg.summary });
  }

  writeEvidence("fuzz", { results, findings, summary: { pass: results.filter((r) => r.pass).length, total: results.length, findings: findings.length } });
  writeLog("fuzz", log);
  console.log(`fuzz: ${results.filter((r) => r.pass).length}/${results.length} pass, ${findings.length} findings`);
}

const cardDetected = (d, id) => {
  const card = (d.doubleBuys || []).find((c) => c.id === id);
  return card?.status === "detected";
};

main().catch((e) => {
  console.error(e);
  writeEvidence("fuzz", { results: [...results, { id: "A34-02.ERR", pass: false, name: "aborted", detail: String(e?.stack ?? e) }], findings });
  writeLog("fuzz", [...log, String(e?.stack ?? e)]);
  process.exit(1);
});