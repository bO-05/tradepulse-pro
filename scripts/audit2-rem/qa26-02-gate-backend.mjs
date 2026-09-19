/**
 * QA26-02 backend convergence on the newest evidence gate (FIX-NEW-57) and the
 * award/execute audit wording:
 *  A) zero-bid GATE project: detect empty; deduct/assign refused (new message)
 *  B) one-sided priced: still refused; no bid mutated
 *  C) both priced: detect populated; deduct once; duplicate refused; assign idempotent
 *  D) award audit wording vs actual agreement status (AWARD fixture)
 */
import { client, readEvidence, writeEvidence, writeLog, projectSnapshot, call } from "./qa26-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1200)}`);
};

const VFD = "Variable Frequency Drives (VFDs) for AHUs & Pumps";
const BAS_VOID = "Low-Voltage 24V BAS Control & Interlock Wiring";
const NEW_MSG = /at least one priced proposal in both Division 26 .* and Division 23/i;

async function bidsOf(pkgId) {
  return (await c.query("bids:listByPackage", { tradePackageId: pkgId })) || [];
}

async function main() {
  // ================= A. zero-bid gate =================
  const d0 = await c.query("coordination:detectCrossTradeClashes", { projectId: F.gate.id });
  record(
    "A26-02.1",
    "GATE zero bids: detect returns honest empty (no cards)",
    d0.doubleBuys.length === 0 && d0.scopeVoids.length === 0,
    { buys: d0.doubleBuys.length, voids: d0.scopeVoids.length, summary: d0.summary }
  );

  const deduct0 = await call("deduct with zero bids", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.gate.id, clashId: "clash-vfd-01", tradePackageId: F.gate.p23,
      deductAmount: 38500, description: VFD,
    })
  );
  const assign0 = await call("assign with zero bids", () =>
    c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: F.gate.id, voidId: "void-bas-wiring-01", tradePackageId: F.gate.p26,
      additionalCost: 28000, description: BAS_VOID,
    })
  );
  record(
    "A26-02.2",
    "GATE zero bids: deduct and assign both refused with the new evidence-gate message",
    deduct0.ok === false && NEW_MSG.test(String(deduct0.data ?? "")) &&
      assign0.ok === false && NEW_MSG.test(String(assign0.data ?? "")),
    { deduct: { ok: deduct0.ok, data: deduct0.data }, assign: { ok: assign0.ok, data: assign0.data } }
  );

  // ================= B. one-sided priced =================
  const hBid = await c.mutation("bids:submitDirectBid", {
    tradePackageId: F.gate.p23, contractorId: F.gate.contractors.c23,
    subcontractorName: "AUDIT-QA26 Gate Mechanical", baseBidAmount: 500000,
  });
  const d1 = await c.query("coordination:detectCrossTradeClashes", { projectId: F.gate.id });
  const deduct1 = await call("deduct one-sided", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.gate.id, clashId: "clash-vfd-01", tradePackageId: F.gate.p23,
      bidId: hBid.bidId, deductAmount: 38500, description: VFD,
    })
  );
  const assign1 = await call("assign one-sided", () =>
    c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: F.gate.id, voidId: "void-bas-wiring-01", tradePackageId: F.gate.p26,
      additionalCost: 28000, description: BAS_VOID,
    })
  );
  const hRow1 = (await bidsOf(F.gate.p23)).find((b) => b._id === hBid.bidId);
  const pkg26After1 = await c.query("tradePackages:getPackage", { tradePackageId: F.gate.p26 });
  record(
    "A26-02.3",
    "GATE one-sided (HVAC priced, Electrical not): detect empty; deduct/assign refused; HVAC bid and Div26 inclusions untouched",
    d1.doubleBuys.length === 0 && d1.scopeVoids.length === 0 &&
      deduct1.ok === false && NEW_MSG.test(String(deduct1.data ?? "")) &&
      assign1.ok === false && NEW_MSG.test(String(assign1.data ?? "")) &&
      hRow1?.leveledTotalCost === 500000 && (hRow1?.valueEngineeringAlternates || []).length === 0 &&
      !(pkg26After1?.mandatoryInclusions || []).includes(BAS_VOID),
    {
      detect: { buys: d1.doubleBuys.length, voids: d1.scopeVoids.length },
      deduct: deduct1.data, assign: assign1.data,
      hvac: { leveled: hRow1?.leveledTotalCost, ve: (hRow1?.valueEngineeringAlternates || []).length },
      inclusions26: pkg26After1?.mandatoryInclusions,
    }
  );

  // ================= C. both priced: real operations =================
  const eBid = await c.mutation("bids:submitDirectBid", {
    tradePackageId: F.gate.p26, contractorId: F.gate.contractors.c26,
    subcontractorName: "AUDIT-QA26 Gate Electric", baseBidAmount: 800000,
  });
  const d2 = await c.query("coordination:detectCrossTradeClashes", { projectId: F.gate.id });
  const buyTotal = d2.doubleBuys.reduce((s, x) => s + (x.redundantAmount || 0), 0);
  const voidTotal = d2.scopeVoids.reduce((s, x) => s + (x.estimatedVoidCost || 0), 0);
  const scan = await call("scan", () => c.action("coordination:scanCrossTradeClashes", { projectId: F.gate.id }));
  record(
    "A26-02.4",
    "GATE both priced: detect populates cards; scan message reconciles with the card totals",
    d2.doubleBuys.length === 2 && d2.scopeVoids.length === 2 &&
      scan.ok && scan.value?.analyzed === true &&
      scan.value?.message.includes("2 double-buy") &&
      scan.value?.message.includes(`$${buyTotal.toLocaleString("en-US")}`) &&
      scan.value?.message.includes(`$${voidTotal.toLocaleString("en-US")}`),
    { buys: d2.doubleBuys.map((x) => ({ id: x.id, amt: x.redundantAmount, status: x.status })), voids: d2.scopeVoids.map((x) => ({ id: x.id, amt: x.estimatedVoidCost, status: x.status })), buyTotal, voidTotal, message: scan.value?.message }
  );

  const deduct2 = await call("deduct", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.gate.id, clashId: "clash-vfd-01", tradePackageId: F.gate.p23,
      bidId: hBid.bidId, deductAmount: 38500, description: VFD,
    })
  );
  const hvac2 = (await bidsOf(F.gate.p23)).find((b) => b._id === hBid.bidId);
  const hvacVe2 = hvac2?.valueEngineeringAlternates || [];
  const dupe = await call("duplicate deduct", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.gate.id, clashId: "clash-vfd-01", tradePackageId: F.gate.p23,
      bidId: hBid.bidId, deductAmount: 38500, description: "A26 duplicate attempt",
    })
  );
  const hvac3 = (await bidsOf(F.gate.p23)).find((b) => b._id === hBid.bidId);
  record(
    "A26-02.5",
    "GATE both priced: deduct applies exactly one VE credit; duplicate deduct refused with a readable error",
    deduct2.ok && hvac2?.leveledTotalCost === 500000 - 38500 && hvacVe2.length === 1 &&
      hvacVe2[0].costDeduct === 38500 && hvacVe2[0].isAccepted === true &&
      dupe.ok === false && /already been applied/i.test(String(dupe.data ?? "")) &&
      hvac3?.leveledTotalCost === 500000 - 38500 && (hvac3?.valueEngineeringAlternates || []).length === 1,
    { newLeveled: deduct2.value?.newLeveledCost, ve: hvacVe2, dupe: { ok: dupe.ok, data: dupe.data }, after: hvac3?.leveledTotalCost }
  );

  const assign2 = await call("assign", () =>
    c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: F.gate.id, voidId: "void-bas-wiring-01", tradePackageId: F.gate.p26,
      additionalCost: 28000, description: BAS_VOID,
    })
  );
  const elec2 = (await bidsOf(F.gate.p26)).find((b) => b._id === eBid.bidId);
  const assignItems1 = (elec2?.lineItems || []).filter((i) => /Assigned Scope Void/.test(i.item)).length;
  const assign3 = await call("assign again", () =>
    c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: F.gate.id, voidId: "void-bas-wiring-01", tradePackageId: F.gate.p26,
      additionalCost: 28000, description: BAS_VOID,
    })
  );
  const elec3 = (await bidsOf(F.gate.p26)).find((b) => b._id === eBid.bidId);
  const assignItems2 = (elec3?.lineItems || []).filter((i) => /Assigned Scope Void/.test(i.item)).length;
  record(
    "A26-02.6",
    "GATE both priced: assign adds the scope-void line once; identical re-call is idempotent on cost",
    assign2.ok && elec2?.baseBidAmount === 828000 && assignItems1 === 1 &&
      assign3.ok && elec3?.baseBidAmount === 828000 && assignItems2 === 1,
    { base: elec2?.baseBidAmount, items1: assignItems1, reAssignOk: assign3.ok, baseAfter: elec3?.baseBidAmount, items2: assignItems2 }
  );

  const logs = (await c.query("auditLogs:listRecentLogs", { projectId: F.gate.id, limit: 300 })) || [];
  const deductedRow = logs.find((l) => /Double-Buy Credit Deducted/.test(l.title));
  const loggedRow = logs.find((l) => /Double-Buy Credit Logged/.test(l.title));
  record(
    "A26-02.7",
    "GATE audit truth: refusals wrote no 'Logged' intent row; the real deduct wrote exactly one Deducted row",
    Boolean(deductedRow) && !loggedRow &&
      /38,500/.test(deductedRow?.description || ""),
    { deducted: deductedRow ? { title: deductedRow.title, desc: deductedRow.description } : null, loggedRow: loggedRow ? loggedRow.title : null }
  );

  // ================= D. award audit wording vs status =================
  const genA = await c.mutation("agreements:generateAgreement", { bidId: F.award.bids.a.bidId, tradePackageId: F.award.p26 });
  const snap = await projectSnapshot(c, F.award.id);
  const agrA = snap.agreements.find((a) => a._id === genA._id);
  const awardRow = snap.logs.find((l) => /AIA A401 Subcontract Agreement Awarded/.test(l.title));
  record(
    "A26-02.8",
    "AWARD audit wording: generation records 'Executed subcontract agreement ...' in the audit description although the agreement is only Generated / Pending Execution",
    agrA?.status === "generated" && Boolean(awardRow) && /Executed subcontract agreement/.test(awardRow.description || ""),
    {
      agreement: { number: agrA?.agreementNumber, status: agrA?.status, executedAt: agrA?.executedAt ?? null },
      audit: awardRow ? { title: awardRow.title, description: awardRow.description, eventType: awardRow.eventType } : null,
    }
  );

  writeEvidence("gate", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
  writeLog("gate", log);
  console.log(`gate: ${results.filter((r) => r.pass).length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("gate-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});