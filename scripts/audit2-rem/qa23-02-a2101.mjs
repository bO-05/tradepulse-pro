/**
 * QA23-02 A21-01 (live backend, AUDIT-QA23-PARTIAL):
 *  - Div26 priced / Div23 unpriced -> detect returns 0 double-buys + 0 voids.
 *  - deductDoubleBuyCredit + assignScopeVoidToTrade REFUSED with the both-sides message.
 *  - the real Div26 bid's leveled total, VE list, inclusions and resolution table unchanged.
 *  - price the Div23 side -> detect returns real clashes; first deduct applies exactly once.
 */
import { client, readEvidence, writeEvidence, writeLog, projectSnapshot, call } from "./qa23-lib.mjs";

const c = client();
const F = readEvidence("01-fixtures");
const P = F.partial;
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1000)}`);
};

const BOTH_SIDES = /priced proposals on both Division 26 \(Electrical\) and Division 23 \(HVAC\)/i;

async function main() {
  const before = await projectSnapshot(c, P.id);
  const elecBidBefore = before.bids.find((b) => b._id === P.elecBidId);
  const elecPkgBefore = before.packages.find((p) => p._id === P.elecPackageId);
  const hvacPkgChecker = before.packages.find((p) => p._id === P.hvacPackageId);
  say(`baseline: elecBids=${before.bids.filter((b) => b.tradePackageId === P.elecPackageId).length} hvacBids=${before.bids.filter((b) => b.tradePackageId === P.hvacPackageId).length}`);

  // ---------- 1. detect on one-sided pricing ----------
  const detectBefore = await c.query("coordination:detectCrossTradeClashes", { projectId: P.id });
  record(
    "A21-01.1",
    "Div26 priced / Div23 unpriced: detect returns 0 double-buys and 0 scope voids",
    detectBefore.doubleBuys.length === 0 &&
      detectBefore.scopeVoids.length === 0 &&
      detectBefore.summary.activeClashesCount === 0 &&
      detectBefore.summary.totalDoubleBuyExposure === 0 &&
      detectBefore.summary.totalScopeVoidExposure === 0 &&
      /Evidence-Guard/.test(detectBefore.provider || ""),
    { provider: detectBefore.provider, model: detectBefore.model, summary: detectBefore.summary }
  );

  // ---------- 2. deduct refused ----------
  const deductRefused = await call("deduct one-sided", () => c.mutation("coordination:deductDoubleBuyCredit", {
    projectId: P.id,
    clashId: "clash-vfd-01",
    tradePackageId: P.elecPackageId,
    deductAmount: 38500,
    description: "QA23 redundant VFD double-buy",
  }));
  record(
    "A21-01.2",
    "deductDoubleBuyCredit refused with the both-sides-priced message (readable ConvexError data)",
    !deductRefused.ok && BOTH_SIDES.test(deductRefused.data || "") && !/Server Error/i.test(deductRefused.data || ""),
    { ok: deductRefused.ok, data: deductRefused.data, name: deductRefused.name }
  );

  // ---------- 3. assign refused ----------
  const assignRefused = await call("assign one-sided", () => c.mutation("coordination:assignScopeVoidToTrade", {
    projectId: P.id,
    voidId: "void-bas-wiring-01",
    tradePackageId: P.elecPackageId,
    additionalCost: 28000,
    description: "QA23 low-voltage BAS control wiring",
  }));
  record(
    "A21-01.3",
    "assignScopeVoidToTrade refused with the both-sides-priced message (readable ConvexError data)",
    !assignRefused.ok && BOTH_SIDES.test(assignRefused.data || "") && !/Server Error/i.test(assignRefused.data || ""),
    { ok: assignRefused.ok, data: assignRefused.data, name: assignRefused.name }
  );

  // ---------- 4. no side-effects ----------
  const afterRefusals = await projectSnapshot(c, P.id);
  const elecBidAfter = afterRefusals.bids.find((b) => b._id === P.elecBidId);
  const elecPkgAfter = afterRefusals.packages.find((p) => p._id === P.elecPackageId);
  const resolutionRows = await c.raw.query("coordination:detectCrossTradeClashes", { projectId: P.id });
  record(
    "A21-01.4",
    "refusals left the real bid's leveled total, VE list, inclusions and clash state untouched",
    elecBidAfter.leveledTotalCost === elecBidBefore.leveledTotalCost &&
      JSON.stringify(elecBidAfter.valueEngineeringAlternates || []) === JSON.stringify(elecBidBefore.valueEngineeringAlternates || []) &&
      JSON.stringify(elecPkgAfter.mandatoryInclusions || []) === JSON.stringify(elecPkgBefore.mandatoryInclusions || []) &&
      resolutionRows.doubleBuys.length === 0 && resolutionRows.scopeVoids.length === 0,
    {
      leveledBefore: elecBidBefore.leveledTotalCost,
      leveledAfter: elecBidAfter.leveledTotalCost,
      veAfter: (elecBidAfter.valueEngineeringAlternates || []).length,
      inclusionsAfter: elecPkgAfter.mandatoryInclusions,
      detectAfter: { buys: resolutionRows.doubleBuys.length, voids: resolutionRows.scopeVoids.length },
    }
  );

  // ---------- 5. price the Div23 side ----------
  const hvacBid = await c.mutation("bids:submitDirectBid", {
    tradePackageId: P.hvacPackageId,
    contractorId: P.contractors.hvac,
    subcontractorName: "AUDIT-QA23 PARTIAL Mechanical",
    baseBidAmount: 250_000,
    identifiedExclusions: [],
    valueEngineeringAlternates: [],
    longLeadEquipmentWeeks: 8,
    leadTimePenalty: 0,
    coiComplianceStatus: "compliant",
    coiPenalty: 0,
  });
  const hvacBidId = hvacBid.bidId;
  say(`priced Div23: bid ${hvacBidId} leveled=$${hvacBid.leveledTotalCost}`);

  const detectPriced = await c.query("coordination:detectCrossTradeClashes", { projectId: P.id });
  const detectedBuys = (detectPriced.doubleBuys || []).filter((d) => d.status === "detected");
  const openVoids = (detectPriced.scopeVoids || []).filter((v) => v.status === "open");
  record(
    "A21-01.5",
    "after pricing Div23: detect returns the real clash set (2 detected double-buys, 2 open voids)",
    detectPriced.doubleBuys.length === 2 && detectedBuys.length === 2 &&
      detectPriced.scopeVoids.length === 2 && openVoids.length === 2 &&
      detectPriced.summary.totalDoubleBuyExposure === 50500 &&
      detectPriced.summary.totalScopeVoidExposure === 46500,
    { summary: detectPriced.summary, buyIds: detectedBuys.map((d) => d.id), voidIds: openVoids.map((v) => v.id) }
  );

  // ---------- 6. first deduct applies exactly once ----------
  const deduct1 = await call("deduct#1", () => c.mutation("coordination:deductDoubleBuyCredit", {
    projectId: P.id,
    clashId: "clash-vfd-01",
    tradePackageId: P.hvacPackageId,
    deductAmount: 38500,
    description: "QA23 redundant VFD double-buy",
  }));
  const deduct2 = await call("deduct#2", () => c.mutation("coordination:deductDoubleBuyCredit", {
    projectId: P.id,
    clashId: "clash-vfd-01",
    tradePackageId: P.hvacPackageId,
    deductAmount: 38500,
    description: "QA23 redundant VFD double-buy",
  }));
  const pricedSnap = await projectSnapshot(c, P.id);
  const hvacBidAfter = pricedSnap.bids.find((b) => b._id === hvacBidId);
  const detectedAfterDeduct = await c.query("coordination:detectCrossTradeClashes", { projectId: P.id });
  const vfdCard = (detectedAfterDeduct.doubleBuys || []).find((d) => d.id === "clash-vfd-01");
  const veRows = (hvacBidAfter?.valueEngineeringAlternates || []).filter((x) => /VFD double-buy/.test(x.description || ""));
  record(
    "A21-01.6",
    "first deduct applies exactly once (leveled 250000-38500), second deduct refused as already applied",
    deduct1.ok && deduct1.value?.success === true &&
      !deduct2.ok && /already been applied/i.test(deduct2.data || "") &&
      hvacBidAfter?.leveledTotalCost === 250_000 - 38_500 &&
      veRows.length === 1 && veRows[0].costDeduct === 38500 && veRows[0].isAccepted === true &&
      vfdCard?.status === "deducted" && vfdCard?.deductedAmount === 38500,
    {
      deduct1: deduct1.ok ? deduct1.value : deduct1,
      deduct2: { ok: deduct2.ok, data: deduct2.data },
      hvacLeveledBefore: hvacBid.leveledTotalCost,
      hvacLeveledAfter: hvacBidAfter?.leveledTotalCost,
      veRows: veRows.map((x) => ({ d: x.description, c: x.costDeduct, a: x.isAccepted })),
      vfdCard: vfdCard ? { status: vfdCard.status, deductedAmount: vfdCard.deductedAmount } : null,
    }
  );

  const out = {
    results,
    detectBefore: { summary: detectBefore.summary, provider: detectBefore.provider },
    detectPriced: { summary: detectPriced.summary },
    hvacPackageStatus: (await c.query("tradePackages:getPackage", { tradePackageId: P.hvacPackageId })).status,
    summary: { pass: results.filter((r) => r.pass).length, total: results.length },
  };
  writeEvidence("02-a2101", out);
  writeLog("02-a2101", log);
  console.log(`a2101: ${results.filter((r) => r.pass).length}/${results.length}`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("02-a2101-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});