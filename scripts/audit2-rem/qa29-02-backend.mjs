/**
 * QA29-02 backend verification of the four deployed fixes (A28-01..A28-04).
 * Fixtures: AUDIT-QA29-BASFALSE / BASBAS / BASAUTO / MANUAL / ZERO / OVER.
 * The MANUAL project is left untouched for the UI 1-click deduct in qa29-03.
 */
import { client, readEvidence, writeEvidence, writeLog } from "./qa29-lib.mjs";

const F = readEvidence("fixtures");
const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1500)}`);
};

async function detect(projectId) {
  return await c.query("coordination:detectCrossTradeClashes", { projectId });
}

async function packageBid(projectId, pkgId) {
  const ps = (await c.query("tradePackages:listByProject", { projectId })) || [];
  const pkg = ps.find((p) => p._id === pkgId);
  const bids = (await c.query("bids:listByPackage", { tradePackageId: pkgId })) || [];
  return { pkg, bids };
}

async function deduct(projectId, clashId, tradePackageId, deductAmount, description, bidId) {
  try {
    const value = await c.mutation("coordination:deductDoubleBuyCredit", {
      projectId,
      clashId,
      tradePackageId,
      deductAmount,
      description,
      ...(bidId ? { bidId } : {}),
    });
    return { ok: true, value };
  } catch (err) {
    const data = err && typeof err === "object" && "data" in err ? err.data : null;
    return { ok: false, data: typeof data === "string" ? data : data == null ? null : JSON.stringify(data), message: err?.message ?? String(err) };
  }
}

async function main() {
  // ========================= A28-01: BAS phrase matching =========================
  const dFalse = await detect(F.basFalse.id);
  const vFalse = dFalse.scopeVoids.find((x) => x.id === "void-bas-wiring-01");
  const falseRows = ((await c.query("auditLogs:listRecentLogs", { projectId: F.basFalse.id, limit: 200 })) || []).filter((l) => /scope void/i.test(l.title));
  record(
    "A29-A28-01a",
    "A28-01: inclusion 'Base building general conditions allowance' no longer marks the BAS void assigned/covered",
    vFalse?.status === "open" && vFalse?.assignedToDivision === undefined && vFalse?.assignedToTradeName === undefined &&
      dFalse.summary.totalScopeVoidExposure === 46500 && falseRows.length === 0,
    { inclusion: F.basFalse ? "Base building general conditions allowance" : null, card: vFalse ? { status: vFalse.status, assignedToDivision: vFalse.assignedToDivision ?? null, assignedToTradeName: vFalse.assignedToTradeName ?? null, cost: vFalse.estimatedVoidCost } : null, totalVoidExposure: dFalse.summary.totalScopeVoidExposure, voidAuditRows: falseRows.length }
  );

  const dBas = await detect(F.basBas.id);
  const vBas = dBas.scopeVoids.find((x) => x.id === "void-bas-wiring-01");
  record(
    "A29-A28-01b",
    "A28-01: true phrase '24V BAS control wiring...' still marks the BAS void assigned to Division 26",
    vBas?.status === "assigned" && vBas?.assignedToTradeName === "Division 26 Electrical" && dBas.summary.totalScopeVoidExposure === 18500,
    { card: vBas ? { status: vBas.status, assignedToTradeName: vBas.assignedToTradeName, cost: vBas.estimatedVoidCost } : null, totalVoidExposure: dBas.summary.totalScopeVoidExposure }
  );

  const dAuto = await detect(F.basAuto.id);
  const vAuto = dAuto.scopeVoids.find((x) => x.id === "void-bas-wiring-01");
  record(
    "A29-A28-01c",
    "A28-01: true phrase 'Building automation system ...' still marks the BAS void assigned",
    vAuto?.status === "assigned" && vAuto?.assignedToTradeName === "Division 26 Electrical",
    { card: vAuto ? { status: vAuto.status, assignedToTradeName: vAuto.assignedToTradeName } : null }
  );

  // ========================= A28-02: MANUAL pre-state =========================
  const dManual = await detect(F.manual.id);
  const vfdManual = dManual.doubleBuys.find((x) => x.id === "clash-vfd-01");
  const { bids: mBids } = await packageBid(F.manual.id, F.manual.p26);
  const mElec = mBids.find((b) => b._id === F.manual.b26.bidId);
  const acceptedVfdVe = (mElec?.valueEngineeringAlternates || []).filter((v) => v.isAccepted && /VFD|Variable Frequency/i.test(v.description)).reduce((s, v) => s + (v.costDeduct || 0), 0);
  record(
    "A29-A28-02pre",
    "A28-02 pre: accepted manual VFD VE ($1,000) reduces remaining redundancy to $37,500, card stays DETECTED, no resolution recorded",
    vfdManual?.status === "detected" && vfdManual?.redundantAmount === 37500 && vfdManual?.deductedAmount === undefined &&
      dManual.summary.totalDoubleBuyExposure === 49500 && acceptedVfdVe === 1000,
    { card: vfdManual ? { status: vfdManual.status, redundantAmount: vfdManual.redundantAmount, deductedAmount: vfdManual.deductedAmount ?? null } : null, totalDoubleBuyExposure: dManual.summary.totalDoubleBuyExposure, acceptedVfdVe, manualLeveled: mElec?.leveledTotalCost }
  );

  // ========================= A28-03: zero-value credit refused =========================
  const zeroBefore = await detect(F.zero.id);
  const zCardBefore = zeroBefore.doubleBuys.find((x) => x.id === "clash-vfd-01");
  const z0 = await deduct(F.zero.id, "clash-vfd-01", F.zero.p23, 0, "Variable Frequency Drives (VFDs) for AHUs & Pumps");
  const zeroAfter = await detect(F.zero.id);
  const zCardAfter = zeroAfter.doubleBuys.find((x) => x.id === "clash-vfd-01");
  const { bids: zBidsAfter } = await packageBid(F.zero.id, F.zero.p23);
  const zHvac0 = zBidsAfter.find((b) => b._id === F.zero.b23.bidId);
  const zAudit0 = ((await c.query("auditLogs:listRecentLogs", { projectId: F.zero.id, limit: 200 })) || []).filter((l) => /Double-Buy Credit Deducted/.test(l.title));
  record(
    "A29-A28-03a",
    "A28-03: $0 deduct is refused with a readable message and consumes nothing (card stays detected, no VE, no resolution, no audit row)",
    z0.ok === false && /greater than zero/i.test(z0.data || "") && !/Server Error/i.test(z0.data || "") &&
      zCardBefore?.status === "detected" && zCardAfter?.status === "detected" && zCardAfter?.deductedAmount === undefined &&
      zHvac0?.leveledTotalCost === 480000 && (zHvac0?.valueEngineeringAlternates || []).length === 0 && zAudit0.length === 0,
    { refusal: z0.data ?? z0.message, before: zCardBefore?.status, after: { status: zCardAfter?.status, deductedAmount: zCardAfter?.deductedAmount ?? null }, hvacLeveled: zHvac0?.leveledTotalCost, veCount: (zHvac0?.valueEngineeringAlternates || []).length, auditRows: zAudit0.length }
  );

  const zReal = await deduct(F.zero.id, "clash-vfd-01", F.zero.p23, 38500, "Variable Frequency Drives (VFDs) for AHUs & Pumps");
  const zBidReal = (await c.query("bids:listByPackage", { tradePackageId: F.zero.p23 })).find((b) => b._id === F.zero.b23.bidId);
  const zeroFinal = await detect(F.zero.id);
  const zCardFinal = zeroFinal.doubleBuys.find((x) => x.id === "clash-vfd-01");
  record(
    "A29-A28-03b",
    "A28-03: the later real $38,500 credit still applies after the $0 refusal (card deducted, bid -$38,500)",
    zReal.ok === true && zBidReal?.leveledTotalCost === 441500 && zCardFinal?.status === "deducted" && zCardFinal?.deductedAmount === 38500,
    { result: zReal.value ?? zReal.data, hvacLeveled: zBidReal?.leveledTotalCost, card: zCardFinal ? { status: zCardFinal.status, deductedAmount: zCardFinal.deductedAmount } : null }
  );

  // ========================= A28-04: oversized credit ceiling =========================
  const overBefore = await detect(F.over.id);
  const overCardBefore = overBefore.doubleBuys.find((x) => x.id === "clash-vfd-01");
  const oHuge = await deduct(F.over.id, "clash-vfd-01", F.over.p23, 1000000, "Variable Frequency Drives (VFDs) for AHUs & Pumps");
  const oAfterHuge = await detect(F.over.id);
  const oCardAfterHuge = oAfterHuge.doubleBuys.find((x) => x.id === "clash-vfd-01");
  const { bids: oBidsAfterHuge } = await packageBid(F.over.id, F.over.p23);
  const oHvacAfterHuge = oBidsAfterHuge.find((b) => b._id === F.over.b23.bidId);
  const oAuditHuge = ((await c.query("auditLogs:listRecentLogs", { projectId: F.over.id, limit: 200 })) || []).filter((l) => /Double-Buy Credit Deducted/.test(l.title));
  record(
    "A29-A28-04a",
    "A28-04: a $1,000,000 credit over the $500,000 leveled cost is refused readably with no mutation and no audit row",
    oHuge.ok === false && /exceeds the proposal's leveled cost/i.test(oHuge.data || "") && /\$500,000/.test(oHuge.data || "") && !/Server Error/i.test(oHuge.data || "") &&
      overCardBefore?.status === "detected" && oCardAfterHuge?.status === "detected" &&
      oHvacAfterHuge?.leveledTotalCost === 500000 && (oHvacAfterHuge?.valueEngineeringAlternates || []).length === 0 && oAuditHuge.length === 0,
    { refusal: oHuge.data ?? oHuge.message, after: { status: oCardAfterHuge?.status, leveled: oHvacAfterHuge?.leveledTotalCost, veCount: (oHvacAfterHuge?.valueEngineeringAlternates || []).length }, auditRows: oAuditHuge.length }
  );

  const oExact = await deduct(F.over.id, "clash-vfd-01", F.over.p23, 500000, "Variable Frequency Drives (VFDs) for AHUs & Pumps");
  const oBidExact = (await c.query("bids:listByPackage", { tradePackageId: F.over.p23 })).find((b) => b._id === F.over.b23.bidId);
  const oAuditExact = ((await c.query("auditLogs:listRecentLogs", { projectId: F.over.id, limit: 200 })) || []).find((l) => /Double-Buy Credit Deducted/.test(l.title));
  const exactDesc = oAuditExact?.description || "";
  record(
    "A29-A28-04b",
    "A28-04: the exact-leveled-cost $500,000 credit is accepted at $0 (never negative): persisted cost $0, audit says updated to $0",
    oExact.ok === true && oExact.value?.newLeveledCost === 0 && oBidExact?.leveledTotalCost === 0 &&
      /\$0\./.test(exactDesc) && !/updated to \$-\d/.test(exactDesc) && oExact.value?.newLeveledCost >= 0,
    { result: oExact.value ?? oExact.data, persistedLeveled: oBidExact?.leveledTotalCost, auditDescription: exactDesc || null }
  );

  const oTinyAfterZero = await deduct(F.over.id, "clash-disconnect-02", F.over.p23, 1, "Rooftop Mechanical Equipment Disconnect Switches");
  record(
    "A29-A28-04c",
    "A28-04: after the ceiling is reached ($0), even a $1 credit is refused (no negative leveled cost possible)",
    oTinyAfterZero.ok === false && /exceeds the proposal's leveled cost of \$0/i.test(oTinyAfterZero.data || ""),
    { refusal: oTinyAfterZero.data ?? oTinyAfterZero.message }
  );

  const out = {
    fixtureIds: { basFalse: F.basFalse.id, basBas: F.basBas.id, basAuto: F.basAuto.id, manual: F.manual.id, zero: F.zero.id, over: F.over.id },
    results,
    summary: { pass: results.filter((r) => r.pass).length, total: results.length },
  };
  writeEvidence("backend", out);
  writeLog("backend", log);
  console.log(`backend: ${out.summary.pass}/${out.summary.total}`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("backend-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});