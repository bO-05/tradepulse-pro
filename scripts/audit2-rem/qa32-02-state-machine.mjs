/**
 * QA32-02 backend: cross-trade credit state machine + manual-alternate manipulations.
 *  SM    - deduct -> reverse -> deduct -> reverse alternating on BOTH known clashes;
 *          exact leveled / VE / card / audit reconciliation, no duplicate or stacked rows,
 *          idempotent double-reverse, package-mismatch and edited-credit reversal probes.
 *  MB    - deduct targets the cheapest bid; awarding a different bid and reversing from the
 *          card targets the awarded bid -> does the applied credit move or get stranded?
 *  MAN   - manual alternates before/after the credit; alias must not cover disconnect;
 *          un-accept and delete of the credited row; card/KPI truth; no phantom.
 */
import { client, readEvidence, writeEvidence, writeLog, call } from "./qa32-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1900)}`);
};
const F = readEvidence("fixtures");

const VFD_DESC = "Variable Frequency Drives (VFDs) for AHUs & Pumps";
const DISC_DESC = "Rooftop Mechanical Equipment Disconnect Switches";

const detect = (projectId) => c.query("coordination:detectCrossTradeClashes", { projectId });
const card = (d, id) => d.doubleBuys.find((x) => x.id === id);
const voidCard = (d, id) => d.scopeVoids.find((x) => x.id === id);
const bidById = async (pkgId, bidId) => (await c.query("bids:listByPackage", { tradePackageId: pkgId })).find((b) => b._id === bidId);
const bidsByPkg = (pkgId) => c.query("bids:listByPackage", { tradePackageId: pkgId });
const creditRows = (bid) => (bid?.valueEngineeringAlternates || []).filter((v) => /^Cross-Trade Clash Credit:/.test(v.description || ""));
const logs = (projectId, limit = 400) => c.query("auditLogs:listRecentLogs", { projectId, limit });
const deductRows = async (p) => (await logs(p)).filter((l) => /Double-Buy Credit Deducted/.test(l.title));
const reverseRows = async (p) => (await logs(p)).filter((l) => /Double-Buy Credit Reversed/.test(l.title));
const lastLeveled = async (p) => (await logs(p)).find((l) => /Normalized leveled cost updated to \$/.test(l.description || ""));

async function main() {
  // ================= SM: state machine =================
  {
    const { id, p23, b23, b26 } = F.sm;
    const d0 = await detect(id);
    const b0 = await bidById(p23, b23.bidId);
    record("A32-SM.1", "SM initial: both clashes detected (VFD $38,500 / disconnect $12,000), bids 800k/480k, zero credits, zero audit rows",
      card(d0, "clash-vfd-01")?.status === "detected" && card(d0, "clash-vfd-01")?.redundantAmount === 38500 &&
        card(d0, "clash-disconnect-02")?.status === "detected" && card(d0, "clash-disconnect-02")?.redundantAmount === 12000 &&
        b0?.leveledTotalCost === 480000 && (await deductRows(id)).length === 0 && (await reverseRows(id)).length === 0,
      { vfd: card(d0, "clash-vfd-01"), disc: card(d0, "clash-disconnect-02"), b23: b0?.leveledTotalCost });

    // deduct #1 -> reverse #1
    const ded1 = await call("sm-deduct-vfd-1", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 38500, description: VFD_DESC }));
    const b1 = await bidById(p23, b23.bidId);
    const d1 = await detect(id);
    record("A32-SM.2", "SM deduct#1: HVAC 480,000 -> 441,500; exactly one credit VE row; card deducted $38,500; one deduct audit row",
      ded1.ok && ded1.value?.newLeveledCost === 441500 && b1?.leveledTotalCost === 441500 &&
        creditRows(b1).length === 1 && creditRows(b1)[0].costDeduct === 38500 && creditRows(b1)[0].isAccepted === true &&
        card(d1, "clash-vfd-01")?.status === "deducted" && card(d1, "clash-vfd-01")?.deductedAmount === 38500 &&
        (await deductRows(id)).length === 1,
      { result: ded1.value ?? ded1.data, ve: b1?.valueEngineeringAlternates, card: card(d1, "clash-vfd-01"), deducts: (await deductRows(id)).length });

    const rev1 = await call("sm-reverse-vfd-1", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
    const b2 = await bidById(p23, b23.bidId);
    const d2 = await detect(id);
    const revAudit1 = (await reverseRows(id))[0];
    record("A32-SM.3", "SM reverse#1: HVAC restored to 480,000; zero VE rows; card back to detected $38,500; one reverse audit row stating restored $480,000; no new deduct row",
      rev1.ok && b2?.leveledTotalCost === 480000 && creditRows(b2).length === 0 &&
        card(d2, "clash-vfd-01")?.status === "detected" && card(d2, "clash-vfd-01")?.redundantAmount === 38500 &&
        (await reverseRows(id)).length === 1 && /restored to \$480,000/.test(revAudit1?.description || "") &&
        (await deductRows(id)).length === 1,
      { result: rev1.value ?? rev1.data, veAfter: b2?.valueEngineeringAlternates, card: card(d2, "clash-vfd-01"), audit: revAudit1?.description });

    // deduct #2 -> reverse #2 (no stacking)
    const ded2 = await call("sm-deduct-vfd-2", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 38500, description: VFD_DESC }));
    const b3 = await bidById(p23, b23.bidId);
    const rev2 = await call("sm-reverse-vfd-2", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
    const b4 = await bidById(p23, b23.bidId);
    const d4 = await detect(id);
    record("A32-SM.4", "SM deduct#2 -> reverse#2 alternates cleanly: 441,500 -> 480,000, one VE row at the peak, zero after; 2 deduct + 2 reverse audit rows, no duplicates",
      ded2.ok && b3?.leveledTotalCost === 441500 && creditRows(b3).length === 1 &&
        rev2.ok && b4?.leveledTotalCost === 480000 && creditRows(b4).length === 0 &&
        card(d4, "clash-vfd-01")?.status === "detected" &&
        (await deductRows(id)).length === 2 && (await reverseRows(id)).length === 2,
      { peakLeveled: b3?.leveledTotalCost, peakVe: creditRows(b3).length, finalLeveled: b4?.leveledTotalCost, finalVe: creditRows(b4).length, deducts: (await deductRows(id)).length, reverses: (await reverseRows(id)).length });

    // disconnect clash alternation
    const dedD = await call("sm-deduct-disc-1", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-disconnect-02", tradePackageId: p23, deductAmount: 12000, description: DISC_DESC }));
    const b5 = await bidById(p23, b23.bidId);
    const d5 = await detect(id);
    const revD = await call("sm-reverse-disc-1", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-disconnect-02", tradePackageId: p23 }));
    const b6 = await bidById(p23, b23.bidId);
    const d6 = await detect(id);
    record("A32-SM.5", "SM disconnect clash: deduct 12,000 -> 468,000 card deducted $12,000, reverse -> 480,000 card detected $12,000; VFD card stays detected throughout",
      dedD.ok && b5?.leveledTotalCost === 468000 && creditRows(b5).length === 1 &&
        card(d5, "clash-disconnect-02")?.status === "deducted" && card(d5, "clash-disconnect-02")?.deductedAmount === 12000 &&
        card(d5, "clash-vfd-01")?.status === "detected" &&
        revD.ok && b6?.leveledTotalCost === 480000 && creditRows(b6).length === 0 &&
        card(d6, "clash-disconnect-02")?.status === "detected" && card(d6, "clash-disconnect-02")?.redundantAmount === 12000,
      { afterDeduct: { leveled: b5?.leveledTotalCost, card: card(d5, "clash-disconnect-02") }, afterReverse: { leveled: b6?.leveledTotalCost, card: card(d6, "clash-disconnect-02") } });

    // stacked credits on one bid
    const s1 = await call("sm-stack-disc", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-disconnect-02", tradePackageId: p23, deductAmount: 12000, description: DISC_DESC }));
    const s2 = await call("sm-stack-vfd", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 38500, description: VFD_DESC }));
    const b7 = await bidById(p23, b23.bidId);
    const d7 = await detect(id);
    const rV = await call("sm-unstack-vfd", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
    const b8 = await bidById(p23, b23.bidId);
    const d8 = await detect(id);
    const rD = await call("sm-unstack-disc", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-disconnect-02", tradePackageId: p23 }));
    const b9 = await bidById(p23, b23.bidId);
    const d9 = await detect(id);
    record("A32-SM.6", "SM stacked credits: disconnect + VFD -> 429,500 with exactly 2 distinct credit rows; reversing VFD removes only the VFD row (468,000, disconnect card stays deducted); reversing disconnect restores 480,000 with zero rows",
      s1.ok && s2.ok && b7?.leveledTotalCost === 429500 && creditRows(b7).length === 2 &&
        card(d7, "clash-vfd-01")?.status === "deducted" && card(d7, "clash-disconnect-02")?.status === "deducted" &&
        rV.ok && b8?.leveledTotalCost === 468000 && creditRows(b8).length === 1 && /disconnect/i.test(creditRows(b8)[0].description) &&
        !creditRows(b8).some((v) => /VFD|Variable Frequency/i.test(v.description)) &&
        card(d8, "clash-vfd-01")?.status === "detected" && card(d8, "clash-disconnect-02")?.status === "deducted" &&
        rD.ok && b9?.leveledTotalCost === 480000 && creditRows(b9).length === 0 &&
        card(d9, "clash-vfd-01")?.status === "detected" && card(d9, "clash-disconnect-02")?.status === "detected",
      { stacked: { leveled: b7?.leveledTotalCost, rows: creditRows(b7).map((v) => v.description) }, afterVfd: { leveled: b8?.leveledTotalCost, rows: creditRows(b8).map((v) => v.description) }, afterDisc: { leveled: b9?.leveledTotalCost, rows: creditRows(b9).length } });

    // idempotency: double reverse refused, no side effects
    const dBefore = (await deductRows(id)).length;
    const rBefore = (await reverseRows(id)).length;
    const dbl = await call("sm-double-reverse", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
    const b10 = await bidById(p23, b23.bidId);
    record("A32-SM.7", "SM double reverse refused ('no applied credit'); bid, VE rows and audit counts unchanged",
      !dbl.ok && /no applied credit/.test(dbl.data || "") && b10?.leveledTotalCost === 480000 && creditRows(b10).length === 0 &&
        (await deductRows(id)).length === dBefore && (await reverseRows(id)).length === rBefore,
      { data: dbl.data, deductsBefore: dBefore, deductsAfter: (await deductRows(id)).length, reversesBefore: rBefore, reversesAfter: (await reverseRows(id)).length });

    // package mismatch probe
    const pmDed = await call("sm-pm-deduct", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 38500, description: VFD_DESC }));
    const pmRev = await call("sm-pm-reverse-wrong-pkg", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: F.sm.p26 }));
    const bPm1 = await bidById(p23, b23.bidId);
    const bPm2 = await bidById(F.sm.p26, b26.bidId);
    const dPm = await detect(id);
    record("A32-SM.8", "SM package-mismatch reverse refused or credit-preserving (defect if the resolution is cleared while the HVAC credit remains)",
      pmDed.ok && !pmRev.ok,
      { deduct: pmDed.value ?? pmDed.data, wrongPkgReverse: pmRev.value ?? pmRev.data, hvacLeveled: bPm1?.leveledTotalCost, hvacCreditRows: creditRows(bPm1).length, elecLeveled: bPm2?.leveledTotalCost, card: card(dPm, "clash-vfd-01"), note: "wrong-package isolation probe (not UI-reachable: the card passes the secondary package)" });

    // edited credit amount probe (re-apply first: the mismatch probe above cleared the resolution)
    if (pmDed.ok) {
      const reApply = await call("sm-edit-reapply", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 38500, description: VFD_DESC }));
      const edit = await call("sm-edit-credit", () => c.mutation("bids:updateBidAdjustments", {
        bidId: b23.bidId,
        identifiedExclusions: [],
        valueEngineeringAlternates: [{ description: `Cross-Trade Clash Credit: Deduct redundant ${VFD_DESC}`, costDeduct: 20000, isAccepted: true }],
        leadTimePenalty: 0, coiPenalty: 0,
      }));
      const eRev = await call("sm-reverse-edited", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
      const bE = await bidById(p23, b23.bidId);
      const dE = await detect(id);
      record("A32-SM.9", "SM edited-credit reverse: recorded (does the $20,000 edited credit survive while the resolution is cleared?)",
        eRev.ok && bE?.leveledTotalCost === 460000 && creditRows(bE).length === 1 && creditRows(bE)[0].costDeduct === 20000 &&
          card(dE, "clash-vfd-01")?.status === "detected",
        { editLeveled: edit.value?.leveledTotalCost ?? edit.data, reverse: eRev.value ?? eRev.data, leveled: bE?.leveledTotalCost, rows: creditRows(bE).map((v) => ({ d: v.description, a: v.costDeduct })), card: { status: card(dE, "clash-vfd-01")?.status, redundant: card(dE, "clash-vfd-01")?.redundantAmount } });
      // restore for later checks
      await c.mutation("bids:updateBidAdjustments", { bidId: b23.bidId, identifiedExclusions: [], valueEngineeringAlternates: [], leadTimePenalty: 0, coiPenalty: 0 });
    } else {
      await c.mutation("bids:updateBidAdjustments", { bidId: b23.bidId, identifiedExclusions: [], valueEngineeringAlternates: [], leadTimePenalty: 0, coiPenalty: 0 });
    }
  }

  // ================= MB: award switch between deduct and reverse =================
  {
    const { id, p23, b23, b23b, c23b } = F.mb;
    const ded = await call("mb-deduct", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 38500, description: VFD_DESC }));
    const b1 = (await bidsByPkg(p23)).find((b) => b._id === b23.bidId);
    const b2before = (await bidsByPkg(p23)).find((b) => b._id === b23b.bidId);
    const award = await call("mb-award-alt", () => c.mutation("agreements:generateAgreement", { bidId: b23b.bidId, tradePackageId: p23 }));
    const b2after = (await bidsByPkg(p23)).find((b) => b._id === b23b.bidId);
    record("A32-MB.1", "MB setup: credit lands on cheapest B1 ($441,500); awarding the alternate B2 through the agreement generator moves the award to B2 ($497,000, no credit)",
      ded.ok && b1?.leveledTotalCost === 441500 && creditRows(b1).length === 1 &&
        award.ok && b2after?.isAwarded === true && b2before?.isAwarded === false && b2after?.leveledTotalCost === 497000,
      { b1: { leveled: b1?.leveledTotalCost, rows: creditRows(b1).length, awarded: b1?.isAwarded }, b2: { leveled: b2after?.leveledTotalCost, awarded: b2after?.isAwarded, agreementSum: award.value?.contractSum }, b2beforeAwarded: b2before?.isAwarded });

    const rev = await call("mb-reverse-after-award", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
    const b1f = (await bidsByPkg(p23)).find((b) => b._id === b23.bidId);
    const b2f = (await bidsByPkg(p23)).find((b) => b._id === b23b.bidId);
    const dF = await detect(id);
    const awardAgr = (await c.query("agreements:listAgreements", { projectId: id }))?.find((a) => a.bidId === b23b.bidId);
    const revRows = (await logs(id)).filter((l) => /Double-Buy Credit Reversed/.test(l.title));
    // Truthful outcome: the applied credit is restored on B1 or the reverse refuses while the awarded B2 lacks it.
    const creditStranded = rev.ok && creditRows(b1f).length === 1 && b1f?.leveledTotalCost === 441500 &&
      b2f?.leveledTotalCost === 497000 && awardAgr?.contractSum === 497000;
    record("A32-MB.2", "MB reverse after award: does NOT touch the awarded B2; the $38,500 credit stays stranded on the non-awarded B1; card flips to 'covered' (redundant $0) and no reversal audit row is written",
      !creditStranded,
      { reverseResult: rev.value ?? rev.data, b1After: { leveled: b1f?.leveledTotalCost, rows: creditRows(b1f).map((v) => v.costDeduct), awarded: b1f?.isAwarded }, b2After: { leveled: b2f?.leveledTotalCost, rows: creditRows(b2f).length, awarded: b2f?.isAwarded, agreementSum: awardAgr?.contractSum }, card: { status: card(dF, "clash-vfd-01")?.status, redundant: card(dF, "clash-vfd-01")?.redundantAmount, deductedAmount: card(dF, "clash-vfd-01")?.deductedAmount }, reversalAuditRows: revRows.length });
  }

  // ================= MAN: manual alternates =================
  {
    const { id, p23, b23, p26 } = F.man;
    const d0 = await detect(id);
    record("A32-MAN.1", "MAN pre-credit: manual accepted VFD $1,000 reduces only the VFD redundancy (37,500); the $5,000 'Switchgear arc-flash study credit' alias does NOT reduce the disconnect clash ($12,000 unchanged)",
      card(d0, "clash-vfd-01")?.redundantAmount === 37500 && card(d0, "clash-disconnect-02")?.redundantAmount === 12000 &&
        card(d0, "clash-vfd-01")?.status === "detected" && card(d0, "clash-disconnect-02")?.status === "detected",
      { vfd: card(d0, "clash-vfd-01"), disc: card(d0, "clash-disconnect-02") });

    const ded = await call("man-deduct", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 37500, description: VFD_DESC }));
    const b1 = await bidById(p23, b23.bidId);
    const d1 = await detect(id);
    record("A32-MAN.2", "MAN deduct reduced credit 37,500: HVAC 479,000 -> 441,500; credit row carries exactly $37,500 alongside the manual $1,000 row; card deducted $37,500",
      ded.ok && ded.value?.newLeveledCost === 441500 && b1?.leveledTotalCost === 441500 &&
        creditRows(b1).length === 1 && creditRows(b1)[0].costDeduct === 37500 &&
        (b1?.valueEngineeringAlternates || []).some((v) => /VFD factory pricing credit/.test(v.description) && v.costDeduct === 1000 && v.isAccepted) &&
        card(d1, "clash-vfd-01")?.status === "deducted" && card(d1, "clash-vfd-01")?.deductedAmount === 37500,
      { result: ded.value ?? ded.data, ve: b1?.valueEngineeringAlternates, card: card(d1, "clash-vfd-01") });

    // add a second accepted manual VFD row AFTER the credit
    const add5k = await call("man-add-5k", () => c.mutation("bids:updateBidAdjustments", {
      bidId: b23.bidId,
      identifiedExclusions: [],
      valueEngineeringAlternates: [
        { description: "VFD factory pricing credit (manual entry)", costDeduct: 1000, isAccepted: true },
        { description: `Cross-Trade Clash Credit: Deduct redundant ${VFD_DESC}`, costDeduct: 37500, isAccepted: true },
        { description: "Additional VFD commissioning credit (manual entry)", costDeduct: 5000, isAccepted: true },
      ],
      leadTimePenalty: 0, coiPenalty: 0,
    }));
    const b2 = await bidById(p23, b23.bidId);
    const d2 = await detect(id);
    record("A32-MAN.3", "MAN add accepted manual $5,000 after the credit: leveled 436,500; card still deducted $37,500 and remaining redundancy $0 (manual coverage saturates)",
      add5k.ok && b2?.leveledTotalCost === 436500 && creditRows(b2).length === 1 &&
        card(d2, "clash-vfd-01")?.status === "deducted" && card(d2, "clash-vfd-01")?.deductedAmount === 37500 &&
        card(d2, "clash-vfd-01")?.redundantAmount === 0,
      { leveled: b2?.leveledTotalCost, card: card(d2, "clash-vfd-01") });

    // remove the added row (keep manual 1k + credit 37.5k)
    await call("man-drop-5k", () => c.mutation("bids:updateBidAdjustments", {
      bidId: b23.bidId,
      identifiedExclusions: [],
      valueEngineeringAlternates: [
        { description: "VFD factory pricing credit (manual entry)", costDeduct: 1000, isAccepted: true },
        { description: `Cross-Trade Clash Credit: Deduct redundant ${VFD_DESC}`, costDeduct: 37500, isAccepted: true },
      ],
      leadTimePenalty: 0, coiPenalty: 0,
    }));

    // un-accept the credit row (exact qa30-05 UI toggle) -> A32-02 repro
    const unacc = await call("man-unaccept-credit", () => c.mutation("bids:updateBidAdjustments", {
      bidId: b23.bidId,
      identifiedExclusions: [],
      valueEngineeringAlternates: (b1?.valueEngineeringAlternates || []).map((v) =>
        /^Cross-Trade Clash Credit:/.test(v.description) ? { ...v, isAccepted: false } : v
      ),
      leadTimePenalty: 0, coiPenalty: 0,
    }));
    const bU = await bidById(p23, b23.bidId);
    const dU = await detect(id);
    const retryU = await call("man-unaccept-retry-deduct", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 37500, description: VFD_DESC }));
    const dU2 = await detect(id);
    record("A32-MAN.4", "MAN un-accept credit row: A30-01 overlay works (card returns to detected $37,500, bid 479,000) BUT re-applying the credit is refused ('reverse the existing credit') although no UI reverse control exists on a detected card",
      unacc.ok && bU?.leveledTotalCost === 479000 && creditRows(bU).length === 1 && creditRows(bU)[0].isAccepted === false &&
        card(dU, "clash-vfd-01")?.status === "detected" && card(dU, "clash-vfd-01")?.redundantAmount === 37500 &&
        !retryU.ok && /already been applied/.test(retryU.data || ""),
      { unacceptLeveled: bU?.leveledTotalCost, rows: creditRows(bU), card: card(dU, "clash-vfd-01"), retry: retryU.data, stillDetected: card(dU2, "clash-vfd-01")?.status });

    // raw reverse (backend sanctioned path) then re-deduct works
    const revU = await call("man-unaccept-reverse", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
    const bR = await bidById(p23, b23.bidId);
    const reDed = await call("man-unaccept-rededuct", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 37500, description: VFD_DESC }));
    const bF = await bidById(p23, b23.bidId);
    const dF = await detect(id);
    record("A32-MAN.5", "MAN backend recovery: reverse clears the stale resolution silently (479,000 unchanged) and the re-deduct then applies once (441,500, single row, card deducted $37,500)",
      revU.ok && bR?.leveledTotalCost === 479000 && creditRows(bR).length === 0 &&
        reDed.ok && bF?.leveledTotalCost === 441500 && creditRows(bF).length === 1 &&
        card(dF, "clash-vfd-01")?.status === "deducted" && card(dF, "clash-vfd-01")?.deductedAmount === 37500,
      { reverse: revU.value ?? revU.data, reDeduct: reDed.value ?? reDed.data, finalLeveled: bF?.leveledTotalCost, rows: creditRows(bF).length, card: card(dF, "clash-vfd-01") });

    // delete variant: remove the credit row entirely (UI save without the row)
    const del = await call("man-delete-credit", () => c.mutation("bids:updateBidAdjustments", {
      bidId: b23.bidId,
      identifiedExclusions: [],
      valueEngineeringAlternates: bF.valueEngineeringAlternates.filter((v) => !/^Cross-Trade Clash Credit:/.test(v.description)),
      leadTimePenalty: 0, coiPenalty: 0,
    }));
    const bD = await bidById(p23, b23.bidId);
    const dD = await detect(id);
    const retryD = await call("man-delete-retry-deduct", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 37500, description: VFD_DESC }));
    record("A32-MAN.6", "MAN delete credit row: card returns to detected $37,500 with a live apply button, but apply is still refused by the stale resolution (same dead-end as un-accept)",
      del.ok && bD?.leveledTotalCost === 479000 && creditRows(bD).length === 0 &&
        card(dD, "clash-vfd-01")?.status === "detected" && card(dD, "clash-vfd-01")?.redundantAmount === 37500 &&
        !retryD.ok && /already been applied/.test(retryD.data || ""),
      { delete: del.ok, leveled: bD?.leveledTotalCost, card: card(dD, "clash-vfd-01"), retry: retryD.data });

    const dDisc = await detect(id);
    record("A32-MAN.7", "MAN alias regression: the disconnect card still reports $12,000 nonzero after every VFD manipulation (switchgear alias never offsets it)",
      card(dDisc, "clash-disconnect-02")?.redundantAmount === 12000 && card(dDisc, "clash-disconnect-02")?.status === "detected",
      { disc: card(dDisc, "clash-disconnect-02") });
  }

  writeEvidence("state-machine", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
  writeLog("state-machine", log);
  console.log(`state-machine: ${results.filter((r) => r.pass).length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeEvidence("state-machine", { results: [...results, { id: "A32-02.ERR", pass: false, name: "aborted", detail: String(e?.stack ?? e) }] });
  writeLog("state-machine", [...log, String(e?.stack ?? e)]);
  process.exit(1);
});