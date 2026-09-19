/**
 * QA25-02 backend verification (live):
 *  A24-01/A23-03: deductDoubleBuyCredit + assignScopeVoidToTrade refuse whenever
 *  either trade side is unpriced (both-unpriced, electrical-only, HVAC-only,
 *  missing trade pair) with a readable message, no resolution row, no change to
 *  any real bid or package inclusion.
 *  With both sides priced the first credit applies exactly once and a duplicate
 *  is refused.
 *  Clash detect is truthful on no-evidence projects (no packages / no bids).
 */
import { client, readEvidence, writeEvidence, writeLog, call } from "./qa25-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1200)}`);
};

const EVIDENCE_MSG = /at least one priced proposal in both Division 26 \(Electrical\) and Division 23 \(HVAC\)/i;
const VFD = "Variable Frequency Drives (VFDs) for AHUs & Pumps";
const BAS_VOID = "Low-Voltage 24V BAS Control & Interlock Wiring";
const CREDIT_TITLES = ["Double-Buy Credit Logged", "Double-Buy Credit Deducted"];
const ASSIGN_TITLE = "Scope Void Assigned";

async function bidsOf(pkgId) {
  return (await c.query("bids:listByPackage", { tradePackageId: pkgId })) || [];
}

function refusalOk(r) {
  return r.ok === false && EVIDENCE_MSG.test(r.data || "") && !/Server Error/i.test(r.data || "");
}

async function main() {
  // ==================================================================
  // 0. truthful no-evidence detect
  // ==================================================================
  for (const [tag, id] of [
    ["A24-02.0a", F.noevPkg.id],
    ["A24-02.0b", F.noevOne.id],
  ]) {
    const d = await c.query("coordination:detectCrossTradeClashes", { projectId: id });
    record(
      tag,
      "detect truthful on no-evidence project (zero bids / missing trade pair) returns honest empty",
      d.doubleBuys.length === 0 && d.scopeVoids.length === 0 && d.summary.activeClashesCount === 0 &&
        d.summary.netBuyoutExposure === 0 && /deterministic-empty-state/.test(d.model || ""),
      { provider: d.provider, model: d.model, summary: d.summary }
    );
  }

  // ==================================================================
  // A. both-unpriced: both mutations refused, no writes
  // ==================================================================
  const p26 = F.credits.p26;
  const p23 = F.credits.p23;
  const detectBaseline = await c.query("coordination:detectCrossTradeClashes", { projectId: F.credits.id });
  record(
    "A24-01.1",
    "CREDITS baseline both-unpriced: detect empty with the evidence-guard provider",
    detectBaseline.doubleBuys.length === 0 && detectBaseline.scopeVoids.length === 0 &&
      /evidence/i.test(detectBaseline.provider || ""),
    { provider: detectBaseline.provider, model: detectBaseline.model }
  );

  const deductBoth = await call("deduct both-unpriced", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.credits.id, clashId: "clash-vfd-01", tradePackageId: p23,
      deductAmount: 38500, description: VFD,
    })
  );
  const assignBoth = await call("assign both-unpriced", () =>
    c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: F.credits.id, voidId: "void-bas-wiring-01", tradePackageId: p26,
      additionalCost: 28000, description: BAS_VOID,
    })
  );
  const logsAfterBoth = (await c.query("auditLogs:listRecentLogs", { projectId: F.credits.id, limit: 200 })) || [];
  record(
    "A24-01.2",
    "FIXED: both-unpriced deduct AND assign REFUSED with the readable both-sides message (no Server Error)",
    refusalOk(deductBoth) && refusalOk(assignBoth),
    { deduct: { ok: deductBoth.ok, data: deductBoth.data, name: deductBoth.name }, assign: { ok: assignBoth.ok, data: assignBoth.data, name: assignBoth.name } }
  );
  record(
    "A24-01.3",
    "both-unpriced refusals write no audit claim row (no Logged/Deducted/Assigned titles)",
    CREDIT_TITLES.every((t) => !logsAfterBoth.some((l) => l.title.startsWith(t))) &&
      !logsAfterBoth.some((l) => l.title.startsWith(ASSIGN_TITLE)),
    { titles: logsAfterBoth.map((l) => l.title).filter((t) => /credit|void/i.test(t)) }
  );

  // ==================================================================
  // B. electrical-only priced: refused, real bid + inclusions untouched
  // ==================================================================
  const elecBid = await c.mutation("bids:submitDirectBid", {
    tradePackageId: p26, contractorId: F.credits.contractors.c26,
    subcontractorName: "AUDIT-QA25 Credits Electric", baseBidAmount: 800000,
  });
  const elecBidId = elecBid.bidId;
  const detectElecOnly = await c.query("coordination:detectCrossTradeClashes", { projectId: F.credits.id });
  record(
    "A24-01.4",
    "electrical-only priced: detect stays truthful empty (one-sided pricing is not clash evidence)",
    detectElecOnly.doubleBuys.length === 0 && detectElecOnly.scopeVoids.length === 0 &&
      /evidence/i.test(detectElecOnly.provider || ""),
    { provider: detectElecOnly.provider, summary: detectElecOnly.summary }
  );

  const elecBefore = (await bidsOf(p26)).find((b) => b._id === elecBidId);
  const hvacPkgBefore = await c.query("tradePackages:getPackage", { tradePackageId: p23 });
  const deductElecOnly = await call("deduct elec-only", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.credits.id, clashId: "clash-vfd-01", tradePackageId: p26, bidId: elecBidId,
      deductAmount: 42000, description: VFD,
    })
  );
  const assignElecOnly = await call("assign elec-only", () =>
    c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: F.credits.id, voidId: "void-bas-wiring-01", tradePackageId: p23,
      additionalCost: 28000, description: BAS_VOID,
    })
  );
  const elecAfter = (await bidsOf(p26)).find((b) => b._id === elecBidId);
  const hvacPkgAfter = await c.query("tradePackages:getPackage", { tradePackageId: p23 });
  record(
    "A24-01.5",
    "FIXED: electrical-only priced: deduct AND assign refused readably",
    refusalOk(deductElecOnly) && refusalOk(assignElecOnly),
    { deduct: { ok: deductElecOnly.ok, data: deductElecOnly.data }, assign: { ok: assignElecOnly.ok, data: assignElecOnly.data } }
  );
  record(
    "A24-01.6",
    "refusals leave the real electrical bid and the target package inclusions byte-identical",
    elecAfter.baseBidAmount === elecBefore.baseBidAmount &&
      elecAfter.leveledTotalCost === elecBefore.leveledTotalCost &&
      JSON.stringify(elecAfter.lineItems || []) === JSON.stringify(elecBefore.lineItems || []) &&
      JSON.stringify(elecAfter.valueEngineeringAlternates || []) === JSON.stringify(elecBefore.valueEngineeringAlternates || []) &&
      JSON.stringify(hvacPkgAfter.mandatoryInclusions || []) === JSON.stringify(hvacPkgBefore.mandatoryInclusions || []),
    {
      base: [elecBefore.baseBidAmount, elecAfter.baseBidAmount],
      leveled: [elecBefore.leveledTotalCost, elecAfter.leveledTotalCost],
      items: [(elecBefore.lineItems || []).length, (elecAfter.lineItems || []).length],
      ve: [(elecBefore.valueEngineeringAlternates || []).length, (elecAfter.valueEngineeringAlternates || []).length],
      inclusions: hvacPkgAfter.mandatoryInclusions,
    }
  );

  // ==================================================================
  // C. HVAC-only priced (fresh no-evidence project): refused
  // ==================================================================
  const noevHvacPkgId = F.noevPkg.hvacPackageId;
  const noevHvacBid = await c.mutation("bids:submitDirectBid", {
    tradePackageId: noevHvacPkgId, contractorId: F.noevPkg.hvacContractorId,
    subcontractorName: "AUDIT-QA25 NOEVPKG Mechanical", baseBidAmount: 300000,
  });
  const noevHvacBidId = noevHvacBid.bidId;
  const noevHvacBidBefore = (await bidsOf(noevHvacPkgId)).find((b) => b._id === noevHvacBidId);
  const noevDeduct = await call("deduct hvac-only", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.noevPkg.id, clashId: "clash-disconnect-02", tradePackageId: noevHvacPkgId,
      bidId: noevHvacBidId, deductAmount: 12000, description: "Rooftop Mechanical Equipment Disconnect Switches",
    })
  );
  const noevAssign = await call("assign hvac-only", () =>
    c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: F.noevPkg.id, voidId: "void-smoke-detectors-02", tradePackageId: F.noevPkg.elecPackageId,
      additionalCost: 18500, description: "Duct Smoke Detector Installation & FACP Tie-In",
    })
  );
  const noevHvacBidAfter = (await bidsOf(noevHvacPkgId)).find((b) => b._id === noevHvacBidId);
  record(
    "A24-01.7",
    "FIXED: HVAC-only priced: deduct AND assign refused readably; bid untouched",
    refusalOk(noevDeduct) && refusalOk(noevAssign) &&
      noevHvacBidAfter.leveledTotalCost === noevHvacBidBefore.leveledTotalCost &&
      JSON.stringify(noevHvacBidAfter.valueEngineeringAlternates || []) === JSON.stringify(noevHvacBidBefore.valueEngineeringAlternates || []),
    { deduct: { ok: noevDeduct.ok, data: noevDeduct.data }, assign: { ok: noevAssign.ok, data: noevAssign.data }, leveled: noevHvacBidAfter.leveledTotalCost }
  );

  // ==================================================================
  // D. missing trade pair: refused
  // ==================================================================
  const missingDeduct = await call("deduct missing-pair", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.noevOne.id, clashId: "clash-vfd-01", tradePackageId: F.noevOne.packageId,
      deductAmount: 38500, description: VFD,
    })
  );
  const missingAssign = await call("assign missing-pair", () =>
    c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: F.noevOne.id, voidId: "void-bas-wiring-01", tradePackageId: F.noevOne.packageId,
      additionalCost: 28000, description: BAS_VOID,
    })
  );
  record(
    "A24-01.8",
    "FIXED: project missing the HVAC trade pair entirely: deduct AND assign refused readably",
    refusalOk(missingDeduct) && refusalOk(missingAssign),
    { deduct: { ok: missingDeduct.ok, data: missingDeduct.data }, assign: { ok: missingAssign.ok, data: missingAssign.data } }
  );

  // ==================================================================
  // E. both priced -> real clash set; first credit once; duplicate refused
  // ==================================================================
  const hvacBid = await c.mutation("bids:submitDirectBid", {
    tradePackageId: p23, contractorId: F.credits.contractors.c23,
    subcontractorName: "AUDIT-QA25 Credits Mechanical", baseBidAmount: 250000,
  });
  const hvacBidId = hvacBid.bidId;

  const detectPriced = await c.query("coordination:detectCrossTradeClashes", { projectId: F.credits.id });
  const stillDetected = (detectPriced.doubleBuys || []).filter((d) => d.status === "detected");
  const stillOpen = (detectPriced.scopeVoids || []).filter((v) => v.status === "open");
  record(
    "A24-01.9",
    "both priced: real clashes surface and every card is still detected/open (no resolution row from any refusal)",
    stillDetected.length === 2 && stillOpen.length === 2 &&
      detectPriced.summary.totalDoubleBuyExposure === 50500 &&
      detectPriced.summary.totalScopeVoidExposure === 46500 &&
      detectPriced.doubleBuys.every((d) => d.deductedAmount == null),
    { summary: detectPriced.summary, buyIds: stillDetected.map((d) => d.id), voidIds: stillOpen.map((v) => v.id) }
  );

  const deduct1 = await call("deduct#1", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.credits.id, clashId: "clash-vfd-01", tradePackageId: p23, bidId: hvacBidId,
      deductAmount: 38500, description: VFD,
    })
  );
  const deduct2 = await call("deduct#2 duplicate", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.credits.id, clashId: "clash-vfd-01", tradePackageId: p23, bidId: hvacBidId,
      deductAmount: 38500, description: VFD,
    })
  );
  const hvacCredited = (await bidsOf(p23)).find((b) => b._id === hvacBidId);
  const veCredit = (hvacCredited?.valueEngineeringAlternates || []).filter((x) => /Cross-Trade Clash Credit/.test(x.description || ""));
  const detectAfter = await c.query("coordination:detectCrossTradeClashes", { projectId: F.credits.id });
  const vfdCard = detectAfter.doubleBuys.find((d) => d.id === "clash-vfd-01");
  record(
    "A24-01.10",
    "FIXED: first credit applies exactly once; duplicate on the same clashId refused readably; detect overlay updates",
    deduct1.ok && deduct1.value?.success === true &&
      !deduct2.ok && /already been applied/i.test(deduct2.data || "") && !/Server Error/i.test(deduct2.data || "") &&
      hvacCredited?.leveledTotalCost === 250000 - 38500 &&
      veCredit.length === 1 && veCredit[0].costDeduct === 38500 && veCredit[0].isAccepted === true &&
      vfdCard?.status === "deducted" && vfdCard?.deductedAmount === 38500 &&
      detectAfter.summary.totalDoubleBuyExposure === 12000,
    {
      deduct1: deduct1.ok ? deduct1.value : deduct1,
      deduct2: { ok: deduct2.ok, data: deduct2.data },
      leveled: hvacCredited?.leveledTotalCost,
      ve: veCredit,
      card: vfdCard ? { status: vfdCard.status, deductedAmount: vfdCard.deductedAmount } : null,
      exposure: detectAfter.summary.totalDoubleBuyExposure,
    }
  );

  const assign1 = await call("assign sanctioned", () =>
    c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: F.credits.id, voidId: "void-bas-wiring-01", tradePackageId: p23, bidId: hvacBidId,
      additionalCost: 28000, description: BAS_VOID,
    })
  );
  const hvacAssigned = (await bidsOf(p23)).find((b) => b._id === hvacBidId);
  const voidItems = (hvacAssigned?.lineItems || []).filter((i) => /Assigned Scope Void/.test(i.item));
  record(
    "A24-01.11",
    "both priced: sanctioned assign adds its line exactly once with the right totals",
    assign1.ok && assign1.value?.success === true &&
      hvacAssigned?.baseBidAmount === 278000 && voidItems.length === 1 &&
      hvacAssigned?.leveledTotalCost === 278000 - 38500,
    { base: hvacAssigned?.baseBidAmount, voidItems: voidItems.length, leveled: hvacAssigned?.leveledTotalCost }
  );

  writeEvidence("backend", {
    results,
    summary: { pass: results.filter((r) => r.pass).length, total: results.length },
  });
  writeLog("backend", log);
  console.log(`backend: ${results.filter((r) => r.pass).length}/${results.length}`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("backend-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});