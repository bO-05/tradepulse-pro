/**
 * QA33-02 backend verification of FIX-NEW-72..74:
 *  A32-01 (MB): deduct on cheapest B1 -> award B2 -> reverse. The carrier B1 must be
 *    found by the credit alternate (not by award/cheapest), restored to $480,000,
 *    the resolution cleared, a reversal audit row written, B2's awarded $497,000
 *    contract untouched, and no credit VE stranded anywhere.
 *  A32-02 (STALE): un-accept the credit row -> detect must flag staleResolution and
 *    the reverse path must clear it WITH an audit row, after which a deduct applies.
 */
import { client, writeEvidence, writeLog, call } from "./qa33-lib.mjs";
import { rebuildPair } from "./qa33-01-fixtures.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1900)}`);
};

const F = {};
const VFD_DESC = "Variable Frequency Drives (VFDs) for AHUs & Pumps";

const detect = (projectId) => c.query("coordination:detectCrossTradeClashes", { projectId });
const card = (d, id) => d.doubleBuys.find((x) => x.id === id);
const bidsByPkg = (pkgId) => c.query("bids:listByPackage", { tradePackageId: pkgId });
const bidById = async (pkgId, bidId) => (await bidsByPkg(pkgId)).find((b) => b._id === bidId);
const creditRows = (bid) => (bid?.valueEngineeringAlternates || []).filter((v) => /^Cross-Trade Clash Credit:/.test(v.description || ""));
const logs = (projectId, limit = 300) => c.query("auditLogs:listRecentLogs", { projectId, limit });
const reversedRows = async (p) => (await logs(p)).filter((l) => /Double-Buy Credit Reversed/.test(l.title));
const clearedRows = async (p) => (await logs(p)).filter((l) => /Double-Buy Credit Record Cleared/.test(l.title));
const deductedRows = async (p) => (await logs(p)).filter((l) => /Double-Buy Credit Deducted/.test(l.title));

async function main() {
  // ================= A32-01: carrier-based reversal after award switch =================
  {
    const mb = await rebuildPair("MB", { twoHvacBids: true });
    F.mb = mb;
    const { id, p23, b23, b23b } = mb;
    const d0 = await detect(id);
    record("A33-01.1", "MB pre-state: VFD detected $38,500 on B1 $480,000 / B2 $497,000, no resolutions",
      card(d0, "clash-vfd-01")?.status === "detected" && card(d0, "clash-vfd-01")?.redundantAmount === 38500 &&
        !card(d0, "clash-vfd-01")?.staleResolution &&
        (await deductedRows(id)).length === 0,
      { card: card(d0, "clash-vfd-01") });

    const ded = await call("mb-deduct", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 38500, description: VFD_DESC,
    }));
    const b1 = await bidById(p23, b23.bidId);
    const award = await call("mb-award-b2", () => c.mutation("agreements:generateAgreement", { bidId: b23b.bidId, tradePackageId: p23 }));
    const b2 = await bidById(p23, b23b.bidId);
    const d1 = await detect(id);
    record("A33-01.2", "MB setup: credit lands on cheapest B1 ($441,500, one row); awarding alternate B2 moves the award to $497,000; card still deducted $38,500",
      ded.ok && ded.value?.newLeveledCost === 441500 && b1?.leveledTotalCost === 441500 && creditRows(b1).length === 1 &&
        award.ok && b2?.isAwarded === true && b2?.leveledTotalCost === 497000 &&
        card(d1, "clash-vfd-01")?.status === "deducted" && card(d1, "clash-vfd-01")?.deductedAmount === 38500,
      { deduct: ded.value ?? ded.data, b1: b1?.leveledTotalCost, b2: { leveled: b2?.leveledTotalCost, awarded: b2?.isAwarded }, card: card(d1, "clash-vfd-01") });

    const rev = await call("mb-reverse", () => c.mutation("coordination:reverseDoubleBuyCredit", {
      projectId: id, clashId: "clash-vfd-01", tradePackageId: p23,
    }));
    const b1f = await bidById(p23, b23.bidId);
    const b2f = await bidById(p23, b23b.bidId);
    const d2 = await detect(id);
    const agr2 = ((await c.query("agreements:listAgreements", { projectId: id })) || []).find((a) => a.bidId === b23b.bidId);
    const revRows = await reversedRows(id);
    const clrRows = await clearedRows(id);
    record("A33-01.3", "A32-01 FIXED: reverse targets the carrier B1 — credit row removed, B1 restored to $480,000, resolution cleared (card detected $38,500), reversal audit row written, no 'cleared' row",
      rev.ok && rev.value?.reversedAmount === 38500 && rev.value?.newLeveledCost === 480000 &&
        b1f?.leveledTotalCost === 480000 && creditRows(b1f).length === 0 &&
        d2 && card(d2, "clash-vfd-01")?.status === "detected" && card(d2, "clash-vfd-01")?.redundantAmount === 38500 &&
        card(d2, "clash-vfd-01")?.deductedAmount === undefined && !card(d2, "clash-vfd-01")?.staleResolution &&
        revRows.length === 1 && /restored to \$480,000/.test(revRows[0]?.description || "") &&
        clrRows.length === 0,
      { reverse: rev.value ?? rev.data, b1: { leveled: b1f?.leveledTotalCost, rows: creditRows(b1f).length }, card: card(d2, "clash-vfd-01"), revAudit: revRows[0]?.description, clearedRows: clrRows.length });

    record("A33-01.4", "A32-01 FIXED: awarded B2 is untouched — $497,000 awarded, agreement sum $497,000, zero credit rows; no stranded credit on any proposal",
      b2f?.leveledTotalCost === 497000 && b2f?.isAwarded === true && agr2?.contractSum === 497000 &&
        creditRows(b2f).length === 0 && b1f?.isAwarded === false,
      { b2: { leveled: b2f?.leveledTotalCost, awarded: b2f?.isAwarded, creditRows: creditRows(b2f).length, contractSum: agr2?.contractSum }, b1Awarded: b1f?.isAwarded });

    // resolution truly cleared: a fresh deduct now targets the awarded B2 and reverses cleanly
    const reDed = await call("mb-rededuct", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 38500, description: VFD_DESC,
    }));
    const b2r = await bidById(p23, b23b.bidId);
    const reRev = await call("mb-rereverse", () => c.mutation("coordination:reverseDoubleBuyCredit", {
      projectId: id, clashId: "clash-vfd-01", tradePackageId: p23,
    }));
    const b2f2 = await bidById(p23, b23b.bidId);
    record("A33-01.5", "A32-01 FIXED: after reversal the credit can be re-applied — it now lands on the awarded B2 ($458,500) and reverses back to $497,000 with zero rows",
      reDed.ok && reDed.value?.bidId === b23b.bidId && b2r?.leveledTotalCost === 458500 &&
        reRev.ok && b2f2?.leveledTotalCost === 497000 && creditRows(b2f2).length === 0 && (await reversedRows(id)).length === 2,
      { reDeduct: reDed.value ?? reDed.data, reReverse: reRev.value ?? reRev.data, finalB2: b2f2?.leveledTotalCost, reverseAuditRows: (await reversedRows(id)).length });
  }

  // ================= A32-02: stale record clear with audit =================
  {
    const stale = await rebuildPair("STALE");
    F.stale = stale;
    const { id, p23, b23 } = stale;
    const ded = await call("stale-deduct", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 38500, description: VFD_DESC,
    }));
    const b1 = await bidById(p23, b23.bidId);
    // un-accept the credit row exactly as the UI does (row kept, isAccepted=false)
    const unacc = await call("stale-unaccept", () => c.mutation("bids:updateBidAdjustments", {
      bidId: b23.bidId,
      identifiedExclusions: [],
      valueEngineeringAlternates: (b1?.valueEngineeringAlternates || []).map((v) =>
        /^Cross-Trade Clash Credit:/.test(v.description) ? { ...v, isAccepted: false } : v
      ),
      leadTimePenalty: 0, coiPenalty: 0,
    }));
    const bU = await bidById(p23, b23.bidId);
    const dU = await detect(id);
    record("A33-02.1", "STALE after un-accept: bid $480,000, row present but unaccepted, card detected $38,500 with staleResolution=true (backend flags the stale record)",
      ded.ok && b1?.leveledTotalCost === 441500 && unacc.ok && bU?.leveledTotalCost === 480000 && creditRows(bU).length === 1 && creditRows(bU)[0].isAccepted === false &&
        card(dU, "clash-vfd-01")?.status === "detected" && card(dU, "clash-vfd-01")?.redundantAmount === 38500 &&
        card(dU, "clash-vfd-01")?.staleResolution === true,
      { leveled: bU?.leveledTotalCost, row: creditRows(bU)[0], card: card(dU, "clash-vfd-01") });

    const clr = await call("stale-clear", () => c.mutation("coordination:reverseDoubleBuyCredit", {
      projectId: id, clashId: "clash-vfd-01", tradePackageId: p23,
    }));
    const bC = await bidById(p23, b23.bidId);
    const dC = await detect(id);
    const auditAll = (await logs(id)).filter((l) => /Double-Buy Credit/.test(l.title));
    const clrRows = await clearedRows(id);
    const revU = await reversedRows(id);
    record("A33-02.2", "A32-02 FIXED (un-accept variant): clearing the stale record succeeds — bid stays $480,000, the unaccepted row is removed, staleResolution flips off, and an audit row documents the clear; no 'cleared' row required since the carrier row existed",
      clr.ok && bC?.leveledTotalCost === 480000 && creditRows(bC).length === 0 &&
        card(dC, "clash-vfd-01")?.status === "detected" && !card(dC, "clash-vfd-01")?.staleResolution &&
        auditAll.length >= 1 && (clrRows.length + revU.length >= 1) &&
        auditAll.some((l) => /\$38,500/.test(`${l.title} ${l.description}`)),
      { clear: clr.value ?? clr.data, leveled: bC?.leveledTotalCost, rows: creditRows(bC).length, card: card(dC, "clash-vfd-01"), clearedAudit: clrRows.map((l) => l.title), reversalAudit: revU.map((l) => l.title) });

    const reDed = await call("stale-rededuct", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 38500, description: VFD_DESC,
    }));
    const bR = await bidById(p23, b23.bidId);
    const dR = await detect(id);
    record("A33-02.3", "A32-02 FIXED: after the clear, a subsequent deduct applies cleanly — $441,500, one accepted credit row, card deducted $38,500",
      reDed.ok && bR?.leveledTotalCost === 441500 && creditRows(bR).length === 1 && creditRows(bR)[0].isAccepted === true &&
        card(dR, "clash-vfd-01")?.status === "deducted" && card(dR, "clash-vfd-01")?.deductedAmount === 38500 && !card(dR, "clash-vfd-01")?.staleResolution,
      { reDeduct: reDed.value ?? reDed.data, leveled: bR?.leveledTotalCost, card: card(dR, "clash-vfd-01") });

    // delete variant: row removed entirely -> the no-carrier stale branch must clear WITH its own audit row
    const delRow = await call("stale-delete-row", () => c.mutation("bids:updateBidAdjustments", {
      bidId: b23.bidId,
      identifiedExclusions: [],
      valueEngineeringAlternates: (bR?.valueEngineeringAlternates || []).filter((v) => !/^Cross-Trade Clash Credit:/.test(v.description)),
      leadTimePenalty: 0, coiPenalty: 0,
    }));
    const bDel = await bidById(p23, b23.bidId);
    const dDel = await detect(id);
    const clearDel = await call("stale-clear-deleted", () => c.mutation("coordination:reverseDoubleBuyCredit", {
      projectId: id, clashId: "clash-vfd-01", tradePackageId: p23,
    }));
    const bDel2 = await bidById(p23, b23.bidId);
    const dDel2 = await detect(id);
    const clrRows2 = await clearedRows(id);
    record("A33-02.4", "A32-02 FIXED (deleted-row branch): after deleting the credit row detect flags staleResolution; reverse returns the 'Stale credit record cleared' note and writes the dedicated 'Double-Buy Credit Record Cleared' audit row naming $38,500 and re-applyability",
      delRow.ok && bDel?.leveledTotalCost === 480000 && creditRows(bDel).length === 0 &&
        card(dDel, "clash-vfd-01")?.staleResolution === true &&
        clearDel.ok && /Stale credit record cleared/.test(clearDel.value?.note || "") &&
        bDel2?.leveledTotalCost === 480000 && card(dDel2, "clash-vfd-01")?.status === "detected" && !card(dDel2, "clash-vfd-01")?.staleResolution &&
        clrRows2.length === 1 && /\$38,500/.test(clrRows2[0]?.description || "") && /applied again/.test(clrRows2[0]?.description || ""),
      { delete: delRow.ok, clear: clearDel.value ?? clearDel.data, leveled: bDel2?.leveledTotalCost, cardBefore: card(dDel, "clash-vfd-01")?.staleResolution, cardAfter: card(dDel2, "clash-vfd-01"), audit: clrRows2[0]?.description });

    const reDed2 = await call("stale-rededuct-2", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 38500, description: VFD_DESC,
    }));
    const bF = await bidById(p23, b23.bidId);
    record("A33-02.5", "A32-02 FIXED: a deduct after the dedicated stale clear applies exactly once ($441,500, one accepted row, card deducted)",
      reDed2.ok && bF?.leveledTotalCost === 441500 && creditRows(bF).length === 1 && creditRows(bF)[0].isAccepted === true,
      { reDeduct: reDed2.value ?? reDed2.data, leveled: bF?.leveledTotalCost, rows: creditRows(bF).length });
  }

  writeEvidence("backend-fixes", { fixtures: { mb: F.mb?.id, stale: F.stale?.id }, results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
  writeLog("backend-fixes", log);
  console.log(`backend-fixes: ${results.filter((r) => r.pass).length}/${results.length}`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeEvidence("backend-fixes", { results: [...results, { id: "A33-02.ERR", pass: false, name: "aborted", detail: String(e?.stack ?? e) }] });
  writeLog("backend-fixes", [...log, String(e?.stack ?? e)]);
  process.exit(1);
});