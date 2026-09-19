/**
 * QA30-03 credit flows / bounds / phantom state matrix:
 *  EDGE   - 0, negative, >1e9, leveled+1 refusals leave zero state; equal-to-leveled allowed.
 *  BASE   - valid deduct, duplicate refusal, valid assign, duplicate refusal, unknown/rotated ids,
 *           cross-kind ids, foreign package/bid, ghost bid.
 *  ONEWAY - one-sided pricing: empty detect + both mutations refused + no state.
 *  NOBID  - target package without bid refused for deduct; concurrency: exactly one of two parallel deducts wins.
 *  PHANTOM- deduct, then remove the credit via updateBidAdjustments -> card still claims the credit and retry is blocked.
 *  MAN    - UI-shaped reduced credit applies exactly $37,500.
 */
import { client, readEvidence, writeEvidence, writeLog, call } from "./qa30-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1800)}`);
};
const F = readEvidence("fixtures");

const detect = (projectId) => c.query("coordination:detectCrossTradeClashes", { projectId });
const card = (d, id) => d.doubleBuys.find((x) => x.id === id);
const voidCard = (d, id) => d.scopeVoids.find((x) => x.id === id);
const bidById = async (pkgId, bidId) => (await c.query("bids:listByPackage", { tradePackageId: pkgId })).find((b) => b._id === bidId);
const deductRows = async (projectId) => (await c.query("auditLogs:listRecentLogs", { projectId, limit: 400 }) || []).filter((l) => /Double-Buy Credit Deducted/.test(l.title));
const assignRows = async (projectId) => (await c.query("auditLogs:listRecentLogs", { projectId, limit: 400 }) || []).filter((l) => /Scope Void Assigned/.test(l.title));

async function main() {
  // ---------- EDGE bounds ----------
  {
    const before = await bidById(F.edge.p23, F.edge.b23.bidId);
    const z = await call("edge-zero", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.edge.id, clashId: "clash-vfd-01", tradePackageId: F.edge.p23, deductAmount: 0, description: "QA30 zero credit probe",
    }));
    const n = await call("edge-negative", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.edge.id, clashId: "clash-vfd-01", tradePackageId: F.edge.p23, deductAmount: -100, description: "QA30 negative credit probe",
    }));
    const huge = await call("edge-over-max", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.edge.id, clashId: "clash-vfd-01", tradePackageId: F.edge.p23, deductAmount: 1000000001, description: "QA30 over-max credit probe",
    }));
    const over = await call("edge-over-leveled", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.edge.id, clashId: "clash-vfd-01", tradePackageId: F.edge.p23, deductAmount: 40001, description: "QA30 over-leveled credit probe",
    }));
    const d = await detect(F.edge.id);
    const after = await bidById(F.edge.p23, F.edge.b23.bidId);
    record("A30-03.1", "EDGE bounds: 0 / negative / >$1B / leveled+1 all refused (positive-credit + ceiling messages); bid and card untouched, zero deduct audit rows",
      !z.ok && /greater than zero/.test(z.data || "") &&
        !n.ok && /greater than zero/.test(n.data || "") &&
        !huge.ok && /greater than zero and no more than/.test(huge.data || "") &&
        !over.ok && /exceeds the proposal's leveled cost/.test(over.data || "") &&
        card(d, "clash-vfd-01")?.status === "detected" && card(d, "clash-vfd-01")?.redundantAmount === 38500 &&
        (after?.valueEngineeringAlternates || []).length === (before?.valueEngineeringAlternates || []).length &&
        (await deductRows(F.edge.id)).length === 0,
      { zero: z.data, negative: n.data, overMax: huge.data, overLeveled: over.data, card: card(d, "clash-vfd-01"), veCount: (after?.valueEngineeringAlternates || []).length });

    const eq = await call("edge-equal", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.edge.id, clashId: "clash-vfd-01", tradePackageId: F.edge.p23, deductAmount: 40000, description: "QA30 equal-to-leveled credit probe",
    }));
    const dEq = await detect(F.edge.id);
    const bEq = await bidById(F.edge.p23, F.edge.b23.bidId);
    record("A30-03.2", "EDGE equal-to-leveled ($40,000 = leveled): accepted, leveled $0, card reports exactly $40,000 (bounds allow the full value; recorded for completeness)",
      eq.ok && eq.value?.newLeveledCost === 0 && bEq?.leveledTotalCost === 0 &&
        card(dEq, "clash-vfd-01")?.deductedAmount === 40000,
      { result: eq.value ?? eq.data, card: card(dEq, "clash-vfd-01") });
  }

  // ---------- BASE valid flows + idempotency + scoping ----------
  {
    const ded = await call("base-deduct", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.base.id, clashId: "clash-vfd-01", tradePackageId: F.base.p23, deductAmount: 38500, description: "Variable Frequency Drives (VFDs) for AHUs & Pumps",
    }));
    const bAfter = await bidById(F.base.p23, F.base.b23.bidId);
    let d = await detect(F.base.id);
    const rows = await deductRows(F.base.id);
    record("A30-03.3", "BASE valid deduct: HVAC leveled $480,000 -> $441,500, card overlay $38,500, exactly one deduct audit row",
      ded.ok && ded.value?.newLeveledCost === 441500 && bAfter?.leveledTotalCost === 441500 &&
        card(d, "clash-vfd-01")?.status === "deducted" && card(d, "clash-vfd-01")?.deductedAmount === 38500 &&
        rows.length === 1 && /-\$38,500/.test(rows[0].title) && /Normalized leveled cost updated to \$441,500/.test(rows[0].description),
      { result: ded.value ?? ded.data, card: card(d, "clash-vfd-01"), audit: rows.map((r) => r.title), leveled: bAfter?.leveledTotalCost });

    const dupe = await call("base-deduct-dupe", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.base.id, clashId: "clash-vfd-01", tradePackageId: F.base.p23, deductAmount: 1000, description: "Duplicate credit attempt",
    }));
    const bDupe = await bidById(F.base.p23, F.base.b23.bidId);
    record("A30-03.4", "BASE duplicate deduct refused with reversal hint; exactly one VE row and no new audit row",
      !dupe.ok && /already been applied/.test(dupe.data || "") &&
        (bDupe?.valueEngineeringAlternates || []).filter((v) => /Cross-Trade Clash Credit/.test(v.description)).length === 1 &&
        (await deductRows(F.base.id)).length === 1,
      { data: dupe.data, ve: bDupe?.valueEngineeringAlternates });

    const asg = await call("base-assign", () => c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: F.base.id, voidId: "void-bas-wiring-01", tradePackageId: F.base.p26, additionalCost: 28000, description: "Low-Voltage 24V BAS Control & Interlock Wiring",
    }));
    const b26 = await bidById(F.base.p26, F.base.b26.bidId);
    const p26 = (await c.query("tradePackages:listByProject", { projectId: F.base.id })).find((p) => p._id === F.base.p26);
    d = await detect(F.base.id);
    record("A30-03.5", "BASE valid assign: Div26 base $800,000 -> $828,000 with one line item + inclusion + overlay; one assign audit row",
      asg.ok && b26?.baseBidAmount === 828000 && b26?.leveledTotalCost === 828000 &&
        (b26?.lineItems || []).filter((i) => /Assigned Scope Void/.test(i.item)).length === 1 &&
        (p26?.mandatoryInclusions || []).some((i) => /BAS Control/.test(i)) &&
        voidCard(d, "void-bas-wiring-01")?.status === "assigned" &&
        (await assignRows(F.base.id)).length === 1,
      { result: asg.value ?? asg.data, base: b26?.baseBidAmount, incl: p26?.mandatoryInclusions, card: voidCard(d, "void-bas-wiring-01")?.status });

    const asgDupe = await call("base-assign-dupe", () => c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: F.base.id, voidId: "void-bas-wiring-01", tradePackageId: F.base.p26, additionalCost: 28000, description: "Low-Voltage 24V BAS Control & Interlock Wiring",
    }));
    const b26d = await bidById(F.base.p26, F.base.b26.bidId);
    record("A30-03.6", "BASE duplicate assign refused; base and inclusion counts unchanged",
      !asgDupe.ok && /already been assigned/.test(asgDupe.data || "") &&
        b26d?.baseBidAmount === 828000 &&
        (b26d?.lineItems || []).filter((i) => /Assigned Scope Void/.test(i.item)).length === 1 &&
        (await assignRows(F.base.id)).length === 1,
      { data: asgDupe.data, base: b26d?.baseBidAmount });

    const rotated = await call("rotated", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.base.id, clashId: "CLASH-VFD-01", tradePackageId: F.base.p23, deductAmount: 1, description: "Rotated id probe",
    }));
    const crossKind = await call("cross-kind", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.base.id, clashId: "void-bas-wiring-01", tradePackageId: F.base.p23, deductAmount: 1, description: "Cross-kind id probe",
    }));
    const crossKindAssign = await call("cross-kind-assign", () => c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: F.base.id, voidId: "clash-vfd-01", tradePackageId: F.base.p26, additionalCost: 1, description: "Cross-kind void probe",
    }));
    const unknown = await call("unknown", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.base.id, clashId: "clash-vfd-02", tradePackageId: F.base.p23, deductAmount: 1, description: "Unknown id probe",
    }));
    record("A30-03.7", "BASE rotated/unknown/cross-kind ids refused with unknown-id messages; no audit rows added",
      !rotated.ok && /Unknown clash id/.test(rotated.data || "") &&
        !crossKind.ok && /Unknown clash id/.test(crossKind.data || "") &&
        !crossKindAssign.ok && /Unknown scope void id/.test(crossKindAssign.data || "") &&
        !unknown.ok && /Unknown clash id/.test(unknown.data || "") &&
        (await deductRows(F.base.id)).length === 1 && (await assignRows(F.base.id)).length === 1,
      { rotated: rotated.data, crossKind: crossKind.data, crossKindAssign: crossKindAssign.data, unknown: unknown.data });

    const foreignPkg = await call("foreign-pkg", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.base.id, clashId: "clash-disconnect-02", tradePackageId: F.nobid.p03, deductAmount: 100, description: "Foreign package probe",
    }));
    const foreignBid = await call("foreign-bid", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.base.id, clashId: "clash-disconnect-02", tradePackageId: F.base.p23, deductAmount: 100, description: "Foreign bid probe", bidId: F.man.b26.bidId,
    }));
    const ghostBid = await call("ghost-bid", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.base.id, clashId: "clash-disconnect-02", tradePackageId: F.base.p23, deductAmount: 100, description: "Ghost bid probe", bidId: "j0000000000000000000000000000000",
    }));
    const dScope = await detect(F.base.id);
    record("A30-03.8", "BASE scoping: foreign package and foreign bid refused with ownership messages; ghost bid refused; disconnect card untouched",
      !foreignPkg.ok && /does not belong to the selected project/.test(foreignPkg.data || "") &&
        !foreignBid.ok && /does not belong to the target trade package/.test(foreignBid.data || "") &&
        !ghostBid.ok &&
        card(dScope, "clash-disconnect-02")?.status === "detected" && card(dScope, "clash-disconnect-02")?.redundantAmount === 12000,
      { foreignPkg: foreignPkg.data, foreignBid: foreignBid.data, ghostBid: ghostBid.data ?? ghostBid.message });
  }

  // ---------- ONEWAY one-sided pricing ----------
  {
    const d = await detect(F.oneway.id);
    const rowsBefore = (await c.query("auditLogs:listRecentLogs", { projectId: F.oneway.id, limit: 200 }) || []).length;
    const ded = await call("oneway-deduct", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.oneway.id, clashId: "clash-vfd-01", tradePackageId: F.oneway.p23, deductAmount: 38500, description: "One-sided probe",
    }));
    const asg = await call("oneway-assign", () => c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: F.oneway.id, voidId: "void-bas-wiring-01", tradePackageId: F.oneway.p26, additionalCost: 28000, description: "One-sided void probe",
    }));
    const scan = await c.action("coordination:scanCrossTradeClashes", { projectId: F.oneway.id });
    const rowsAfter = (await c.query("auditLogs:listRecentLogs", { projectId: F.oneway.id, limit: 200 }) || []).length;
    const b23 = await bidById(F.oneway.p23, F.oneway.b23?.bidId);
    record("A30-03.9", "ONEWAY one-sided pricing: detect returns empty (0/0), deduct+assign refused by both-sides evidence gate, no audit rows written, no bid mutation, scan says needs both proposals",
      d.doubleBuys.length === 0 && d.scopeVoids.length === 0 && d.summary.activeClashesCount === 0 &&
        !ded.ok && /both Division 26 .* and Division 23/.test(ded.data || "") &&
        !asg.ok && /both Division 26 .* and Division 23/.test(asg.data || "") &&
        scan?.analyzed === false && /both Division 26 and Division 23/.test(scan.message || "") &&
        rowsAfter === rowsBefore && b23 === undefined,
      { detect: d.summary, deduct: ded.data, assign: asg.data, scan: scan?.message, rowsBefore, rowsAfter });
  }

  // ---------- NOBID target without bid + concurrency ----------
  {
    const ded = await call("nobid-deduct", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.nobid.id, clashId: "clash-vfd-01", tradePackageId: F.nobid.p03, deductAmount: 38500, description: "Target without bid probe",
    }));
    const dAfter = await detect(F.nobid.id);
    record("A30-03.10", "NOBID target package without proposals: deduct refused ('no priced proposal'), VFD card still detected, no resolution written",
      !ded.ok && /has no priced proposal/.test(ded.data || "") &&
        card(dAfter, "clash-vfd-01")?.status === "detected" && !card(dAfter, "clash-vfd-01")?.deductedAmount,
      { data: ded.data, card: card(dAfter, "clash-vfd-01") });

    const cA = c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.nobid.id, clashId: "clash-disconnect-02", tradePackageId: F.nobid.p23, deductAmount: 12000, description: "Concurrent credit A",
    });
    const cB = c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.nobid.id, clashId: "clash-disconnect-02", tradePackageId: F.nobid.p23, deductAmount: 12000, description: "Concurrent credit B",
    });
    const [rA, rB] = await Promise.allSettled([cA, cB]);
    const okCount = [rA, rB].filter((r) => r.status === "fulfilled").length;
    const dCon = await detect(F.nobid.id);
    const b23 = await bidById(F.nobid.p23, F.nobid.b23.bidId);
    record("A30-03.11", "NOBID concurrency: two parallel $12,000 credits -> exactly one applied (single VE row, single resolve, one deduct audit row)",
      okCount === 1 &&
        (b23?.valueEngineeringAlternates || []).filter((v) => /Cross-Trade Clash Credit/.test(v.description)).length === 1 &&
        card(dCon, "clash-disconnect-02")?.status === "deducted" &&
        (await deductRows(F.nobid.id)).length === 1,
      { okCount, rej: [rA, rB].filter((r) => r.status === "rejected").map((r) => String(r.reason?.data ?? r.reason?.message).slice(0, 120)), ve: b23?.valueEngineeringAlternates });
  }

  // ---------- PHANTOM: credit removed via bid edit, coordination still claims it ----------
  {
    const before = await bidById(F.phantom.p23, F.phantom.b23.bidId);
    const ded = await call("phantom-deduct", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.phantom.id, clashId: "clash-vfd-01", tradePackageId: F.phantom.p23, deductAmount: 38500, description: "Variable Frequency Drives (VFDs) for AHUs & Pumps",
    }));
    const mid = await detect(F.phantom.id);
    const edit = await call("phantom-edit", () => c.mutation("bids:updateBidAdjustments", {
      bidId: F.phantom.b23.bidId,
      identifiedExclusions: [],
      valueEngineeringAlternates: [],
      leadTimePenalty: 0,
      coiPenalty: 0,
    }));
    const after = await bidById(F.phantom.p23, F.phantom.b23.bidId);
    const dPh = await detect(F.phantom.id);
    const retry = await call("phantom-retry", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.phantom.id, clashId: "clash-vfd-01", tradePackageId: F.phantom.p23, deductAmount: 38500, description: "Variable Frequency Drives (VFDs) for AHUs & Pumps",
    }));
    const bFinal = await bidById(F.phantom.p23, F.phantom.b23.bidId);
    const cardPh = card(dPh, "clash-vfd-01");
    const divergent = ded.ok && edit.ok && after?.leveledTotalCost === 480000 &&
      (after?.valueEngineeringAlternates || []).length === 0 &&
      cardPh?.status === "deducted" && cardPh?.deductedAmount === 38500 &&
      !retry.ok && /already been applied/.test(retry.data || "");
    record("A30-03.12", "PHANTOM: after the credit VE is removed by a bid-leveling edit the card still reports $38,500 deducted, the bid is back to $480,000, and the sanctioned retry is blocked",
      divergent,
      {
        deduct: ded.value ?? ded.data, leveledAfterEdit: after?.leveledTotalCost, veAfterEdit: (after?.valueEngineeringAlternates || []).length,
        cardAfterEdit: { status: cardPh?.status, deductedAmount: cardPh?.deductedAmount, redundantAmount: cardPh?.redundantAmount },
        retry: retry.data ?? retry.message, finalLeveled: bFinal?.leveledTotalCost,
      });
  }

  // ---------- MAN reduced credit applies exactly ----------
  {
    const ded = await call("man-deduct", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.man.id, clashId: "clash-vfd-01", tradePackageId: F.man.p23, deductAmount: 37500, description: "Variable Frequency Drives (VFDs) for AHUs & Pumps",
    }));
    const b23 = await bidById(F.man.p23, F.man.b23.bidId);
    const d = await detect(F.man.id);
    record("A30-03.13", "MAN reduced credit: UI-shaped $37,500 applied after $1,000 manual VFD VE (HVAC $480,000 -> $442,500), overlay reports $37,500",
      ded.ok && ded.value?.newLeveledCost === 442500 && b23?.leveledTotalCost === 442500 &&
        card(d, "clash-vfd-01")?.deductedAmount === 37500,
      { result: ded.value ?? ded.data, leveled: b23?.leveledTotalCost, card: card(d, "clash-vfd-01") });
  }

  writeEvidence("credit-matrix", {
    results,
    summary: { pass: results.filter((r) => r.pass).length, total: results.length },
  });
  writeLog("credit-matrix", log);
  console.log(`credit-matrix: ${results.filter((r) => r.pass).length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeEvidence("credit-matrix", { results: [...results, { id: "A30-03.ERR", pass: false, name: "aborted", detail: String(e?.stack ?? e) }] });
  writeLog("credit-matrix", [...log, String(e?.stack ?? e)]);
  process.exit(1);
});