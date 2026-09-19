/**
 * QA24-02 backend hunt on the newest paths:
 *  A) both-unpriced intent-logging (deduct/assign with 0 bids) then bids arrive
 *  B) clash scan/deduct/assign on real two-sided bids (amounts, no stacking)
 *  C) void -> re-award -> execute -> void again lifecycle
 */
import { client, readEvidence, writeEvidence, writeLog, projectSnapshot, call, sleep } from "./qa24-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1100)}`);
};

const VFD = "Variable Frequency Drives (VFDs) for AHUs & Pumps";
const BAS_VOID = "Low-Voltage 24V BAS Control & Interlock Wiring";

async function bidsOf(pkgId) {
  return (await c.query("bids:listByPackage", { tradePackageId: pkgId })) || [];
}

async function main() {
  // ==================================================================
  // A. INTENT: both sides unpriced, log intent, then bids arrive
  // ==================================================================
  const detectsBefore = await c.query("coordination:detectCrossTradeClashes", { projectId: F.intent.id });
  record(
    "A24-02.1",
    "INTENT baseline: both trades unpriced -> detect returns honest empty (no cards to click)",
    detectsBefore.doubleBuys.length === 0 && detectsBefore.scopeVoids.length === 0,
    { buys: detectsBefore.doubleBuys.length, voids: detectsBefore.scopeVoids.length, provider: detectsBefore.provider }
  );

  const intentDeduct = await call("intent deduct", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.intent.id,
      clashId: "clash-vfd-01",
      tradePackageId: F.intent.p23,
      deductAmount: 38500,
      description: VFD,
    })
  );
  const intentAssign = await call("intent assign", () =>
    c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: F.intent.id,
      voidId: "void-bas-wiring-01",
      tradePackageId: F.intent.p26,
      additionalCost: 28000,
      description: BAS_VOID,
    })
  );
  record(
    "A24-02.2",
    "INTENT: both-unpriced deduct/assign are accepted and recorded (designed intent-logging path)",
    intentDeduct.ok && intentDeduct.value?.success === true && /logged/i.test(intentDeduct.value?.note || "") &&
      intentAssign.ok && intentAssign.value?.success === true,
    { deduct: intentDeduct.value ?? intentDeduct, assign: intentAssign.value ?? intentAssign }
  );

  // bids arrive afterwards on both packages
  const i26Bid = await c.mutation("bids:submitDirectBid", {
    tradePackageId: F.intent.p26, contractorId: F.intent.contractors.c26,
    subcontractorName: "AUDIT-QA24 Intent Electric", baseBidAmount: 800000,
  });
  const i23Bid = await c.mutation("bids:submitDirectBid", {
    tradePackageId: F.intent.p23, contractorId: F.intent.contractors.c23,
    subcontractorName: "AUDIT-QA24 Intent Mechanical", baseBidAmount: 500000,
  });

  const detectAfter = await c.query("coordination:detectCrossTradeClashes", { projectId: F.intent.id });
  const vfdCard = detectAfter.doubleBuys.find((d) => d.id === "clash-vfd-01");
  const basCard = detectAfter.scopeVoids.find((v) => v.id === "void-bas-wiring-01");
  const [i26Rows, i23Rows] = await Promise.all([bidsOf(F.intent.p26), bidsOf(F.intent.p23)]);
  const i26BidRow = i26Rows.find((b) => b._id === i26Bid.bidId);
  const i23BidRow = i23Rows.find((b) => b._id === i23Bid.bidId);
  const i23Ve = i23BidRow?.valueEngineeringAlternates || [];
  const ghostCredited = i23Ve.some((x) => /Cross-Trade Clash Credit/.test(x.description));
  record(
    "A24-02.3",
    "INTENT corruption: after bids arrive the VFD card claims 'deducted $38,500' but no bid was touched (0 credits applied)",
    vfdCard?.status === "deducted" && vfdCard?.deductedAmount === 38500 && !ghostCredited &&
      i23BidRow?.leveledTotalCost === 500000 && i26BidRow?.leveledTotalCost === 800000,
    {
      card: vfdCard ? { status: vfdCard.status, deductedAmount: vfdCard.deductedAmount } : null,
      hvacBid: { leveled: i23BidRow?.leveledTotalCost, veCount: i23Ve.length },
      elecBid: { leveled: i26BidRow?.leveledTotalCost, lineItemCount: (i26BidRow?.lineItems || []).length },
      summary: detectAfter.summary,
      basCard: basCard ? { status: basCard.status, assignedTo: basCard.assignedToDivision || null } : null,
      basInclusion: ((await c.query("tradePackages:getPackage", { tradePackageId: F.intent.p26 }))?.mandatoryInclusions || []).includes(BAS_VOID),
    }
  );

  const reDeduct = await call("re-deduct after bids", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.intent.id,
      clashId: "clash-vfd-01",
      tradePackageId: F.intent.p23,
      deductAmount: 38500,
      description: VFD,
    })
  );
  const reDeductExplicit = await call("re-deduct after bids w/ explicit bidId", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.intent.id,
      clashId: "clash-vfd-01",
      tradePackageId: F.intent.p23,
      bidId: i23Bid.bidId,
      deductAmount: 38500,
      description: VFD,
    })
  );
  const intentLogs = (await c.query("auditLogs:listRecentLogs", { projectId: F.intent.id, limit: 200 })) || [];
  const loggedRow = intentLogs.find((l) => /Double-Buy Credit Logged/.test(l.title));
  const deductedRow = intentLogs.find((l) => /Double-Buy Credit Deducted/.test(l.title));
  record(
    "A24-02.4",
    "INTENT trap: the sanctioned 1-click credit is permanently refused once bids arrive; audit claims it 'will apply to incoming proposals' (it never does)",
    reDeduct.ok === false && /already been applied/i.test(String(reDeduct.data ?? "")) &&
      reDeductExplicit.ok === false && Boolean(loggedRow) && !deductedRow &&
      /Will apply to incoming proposals/.test(loggedRow?.description || ""),
    {
      reDeduct: { ok: reDeduct.ok, data: reDeduct.data },
      reDeductExplicit: { ok: reDeductExplicit.ok, data: reDeductExplicit.data },
      loggedTitle: loggedRow?.title ?? null,
      deductedRowExists: Boolean(deductedRow),
      hvacLeveledAfterRefusals: (await bidsOf(F.intent.p23))[0]?.leveledTotalCost,
    }
  );

  // assign retry: void path self-heals if the operator manually re-runs it
  const reAssign = await call("re-assign after bids", () =>
    c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: F.intent.id,
      voidId: "void-bas-wiring-01",
      tradePackageId: F.intent.p26,
      additionalCost: 28000,
      description: BAS_VOID,
    })
  );
  const i26AfterAssign = (await bidsOf(F.intent.p26)).find((b) => b._id === i26Bid.bidId);
  const voidItem = (i26AfterAssign?.lineItems || []).find((i) => i.item === `Assigned Scope Void: ${BAS_VOID}`);
  record(
    "A24-02.5",
    "INTENT assign asymmetry: void card claimed 'assigned' with no cost on any bid; a manual retry is required to actually add the $28,000 (deduct has no such retry)",
    reAssign.ok === true && voidItem?.totalCost === 28000 && i26AfterAssign?.baseBidAmount === 828000,
    { reAssignOk: reAssign.ok, base: i26AfterAssign?.baseBidAmount, voidLine: voidItem ?? null, leveled: i26AfterAssign?.leveledTotalCost }
  );

  const aliasAssign = await call("assign alias desc", () =>
    c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: F.intent.id,
      voidId: "void-bas-wiring-01",
      tradePackageId: F.intent.p26,
      additionalCost: 1000,
      description: "QA24 alias void assignment",
    })
  );
  const i26AfterAlias = (await bidsOf(F.intent.p26)).find((b) => b._id === i26Bid.bidId);
  record(
    "A24-02.6",
    "INTENT assign has no duplicate-resolution guard: same voidId with a new description stacks another line item (deduct refuses)",
    aliasAssign.ok === true && (i26AfterAlias?.lineItems || []).filter((i) => /Assigned Scope Void/.test(i.item)).length === 2,
    { aliasOk: aliasAssign.ok, base: i26AfterAlias?.baseBidAmount, items: (i26AfterAlias?.lineItems || []).map((i) => i.item) }
  );

  // ==================================================================
  // B. REPEAT: real two-sided bids
  // ==================================================================
  const repBaseline = await c.query("coordination:detectCrossTradeClashes", { projectId: F.repeat.id });
  const scanAction = await call("scan both trades", () => c.action("coordination:scanCrossTradeClashes", { projectId: F.repeat.id }));
  const buyTotal = repBaseline.doubleBuys.filter((d) => d.status === "detected").reduce((s, d) => s + d.redundantAmount, 0);
  const voidTotal = repBaseline.scopeVoids.filter((v) => v.status === "open").reduce((s, v) => s + v.estimatedVoidCost, 0);
  record(
    "A24-02.7",
    "REPEAT baseline: 2 buys ($50,500) + 2 voids ($46,500); scan message equals persisted computed totals",
    repBaseline.doubleBuys.length === 2 && repBaseline.scopeVoids.length === 2 && buyTotal === 50500 && voidTotal === 46500 &&
      scanAction.ok && scanAction.value?.analyzed === true &&
      scanAction.value?.message.includes("2 double-buy") && scanAction.value?.message.includes("$50,500") && scanAction.value?.message.includes("$46,500"),
    { buys: repBaseline.doubleBuys.map((d) => d.id), voids: repBaseline.scopeVoids.map((v) => v.id), buyTotal, voidTotal, message: scanAction.value?.message }
  );

  const deduct1 = await call("deduct vfd", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.repeat.id,
      clashId: "clash-vfd-01",
      tradePackageId: F.repeat.p23,
      bidId: F.repeat.bids.b23.bidId,
      deductAmount: 38500,
      description: VFD,
    })
  );
  const hvacAfter = (await bidsOf(F.repeat.p23)).find((b) => b._id === F.repeat.bids.b23.bidId);
  const hvacVe = hvacAfter?.valueEngineeringAlternates || [];
  const detectedAfter = await c.query("coordination:detectCrossTradeClashes", { projectId: F.repeat.id });
  const vfdAfter = detectedAfter.doubleBuys.find((d) => d.id === "clash-vfd-01");
  record(
    "A24-02.8",
    "REPEAT deduct: leveled cost reflects exactly one accepted credit; card deductedAmount equals the stored VE amount",
    deduct1.ok && deduct1.value?.newLeveledCost === 431500 && hvacAfter?.leveledTotalCost === 431500 &&
      hvacVe.length === 1 && hvacVe[0].costDeduct === 38500 && hvacVe[0].isAccepted === true &&
      vfdAfter?.status === "deducted" && vfdAfter?.deductedAmount === 38500 &&
      detectedAfter.summary.totalDoubleBuyExposure === 12000,
    { newLeveled: deduct1.value?.newLeveledCost, ve: hvacVe, card: { status: vfdAfter?.status, deductedAmount: vfdAfter?.deductedAmount }, exposure: detectedAfter.summary.totalDoubleBuyExposure }
  );

  const stackAttempt = await call("re-deduct same clash", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.repeat.id,
      clashId: "clash-vfd-01",
      tradePackageId: F.repeat.p23,
      bidId: F.repeat.bids.b23.bidId,
      deductAmount: 38500,
      description: "QA24 second credit attempt",
    })
  );
  const aliasClash = await call("alias clash id", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.repeat.id,
      clashId: "clash-vfd-01-qa24-alias",
      tradePackageId: F.repeat.p23,
      bidId: F.repeat.bids.b23.bidId,
      deductAmount: 1000,
      description: VFD,
    })
  );
  const hvacAfterAlias = (await bidsOf(F.repeat.p23)).find((b) => b._id === F.repeat.bids.b23.bidId);
  const aliasVe = hvacAfterAlias?.valueEngineeringAlternates || [];
  record(
    "A24-02.9",
    "REPEAT no stacking: same clashId is refused with a readable error; alias clashId replaces the credit (VE count stays 1, no double-apply)",
    stackAttempt.ok === false && /already been applied/i.test(String(stackAttempt.data ?? "")) &&
      aliasClash.ok === true && aliasVe.length === 1 && hvacAfterAlias?.leveledTotalCost === 469000,
    { stack: { ok: stackAttempt.ok, data: stackAttempt.data }, alias: { ok: aliasClash.ok, newLeveled: aliasClash.value?.newLeveledCost }, ve: aliasVe, leveled: hvacAfterAlias?.leveledTotalCost }
  );

  // reversal path probe: no reverse/clear/undo mutation exists in the codebase
  record(
    "A24-02.10",
    "REPEAT: reversal path absent by design note (no reverseCredit/clearClash mutation); alias id silently re-credits instead",
    true,
    { note: "Only deductDoubleBuyCredit / assignScopeVoidToTrade write clashResolutions; the refusal message asks to 'reverse the existing credit', but no such API exists." }
  );

  const assign1 = await call("assign bas void", () =>
    c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: F.repeat.id,
      voidId: "void-bas-wiring-01",
      tradePackageId: F.repeat.p23,
      additionalCost: 28000,
      description: BAS_VOID,
    })
  );
  const hvacAssigned = (await bidsOf(F.repeat.p23)).find((b) => b._id === F.repeat.bids.b23.bidId);
  const assignItems1 = (hvacAssigned?.lineItems || []).filter((i) => /Assigned Scope Void/.test(i.item)).length;
  const reAssignSame = await call("re-assign same desc", () =>
    c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: F.repeat.id,
      voidId: "void-bas-wiring-01",
      tradePackageId: F.repeat.p23,
      additionalCost: 28000,
      description: BAS_VOID,
    })
  );
  const hvacReAssigned = (await bidsOf(F.repeat.p23)).find((b) => b._id === F.repeat.bids.b23.bidId);
  const assignItems2 = (hvacReAssigned?.lineItems || []).filter((i) => /Assigned Scope Void/.test(i.item)).length;
  record(
    "A24-02.11",
    "REPEAT assign: adds the $28,000 line once; identical re-call is idempotent on cost (no double-add)",
    assign1.ok && hvacAssigned?.baseBidAmount === 498000 && assignItems1 === 1 &&
      reAssignSame.ok && hvacReAssigned?.baseBidAmount === 498000 && assignItems2 === 1,
    { base: hvacAssigned?.baseBidAmount, items: assignItems1, baseAfterReassign: hvacReAssigned?.baseBidAmount, itemsAfterReassign: assignItems2, leveled: hvacReAssigned?.leveledTotalCost }
  );

  // ==================================================================
  // C. VOID lifecycle: generate -> execute -> void -> re-award -> execute -> void
  // ==================================================================
  const vPkg = F.void.p26;
  const vBid = F.void.bids.a.bidId;
  const gen1 = await c.mutation("agreements:generateAgreement", { bidId: vBid, tradePackageId: vPkg });
  const exec1 = await call("execute #1", () => c.mutation("agreements:executeAgreement", { agreementId: gen1._id }));
  const snapE1 = await projectSnapshot(c, F.void.id);
  const agrE1 = snapE1.agreements.find((a) => a._id === gen1._id);
  const kpiAwarded = (snap) => {
    const ids = new Set();
    for (const a of snap.agreements) if (a.status !== "superseded") ids.add(a.tradePackageId);
    for (const b of snap.bids) if (b.isAwarded) ids.add(b.tradePackageId);
    for (const p of snap.packages) if (p.status === "awarded") ids.add(p._id);
    return ids.size;
  };
  const void1 = await call("void #1", () =>
    c.mutation("agreements:voidExecutedAgreement", {
      agreementId: gen1._id,
      reason: "QA24 lifecycle #1: execution recorded in error, external amendment pending.",
    })
  );
  const snapV1 = await projectSnapshot(c, F.void.id);
  const agrV1 = snapV1.agreements.find((a) => a._id === gen1._id);
  record(
    "A24-02.12",
    "VOID #1: status superseded, bid unawarded, package reopened; executedAt retained on the superseded record",
    exec1.ok && agrE1?.status === "executed" && Boolean(agrE1?.executedAt) &&
      void1.ok && agrV1?.status === "superseded" &&
      snapV1.bids.find((b) => b._id === vBid)?.isAwarded === false &&
      snapV1.packages.find((p) => p._id === vPkg)?.status === "leveling" &&
      agrV1?.executedAt === agrE1?.executedAt,
    { executedAt1: agrE1?.executedAt, voided: { status: agrV1?.status, executedAt: agrV1?.executedAt }, bidAwarded: snapV1.bids.find((b) => b._id === vBid)?.isAwarded, pkg: snapV1.packages.find((p) => p._id === vPkg)?.status }
  );

  const reAward = await call("re-award same bid", () => c.mutation("agreements:generateAgreement", { bidId: vBid, tradePackageId: vPkg }));
  const snapR = await projectSnapshot(c, F.void.id);
  const agrR = snapR.agreements.find((a) => a._id === gen1._id);
  record(
    "A24-02.13",
    "RE-AWARD: same agreement number reactivated to generated; stale executedAt survives on a non-executed record",
    reAward.ok && agrR?.status === "generated" && agrR?.agreementNumber === gen1.agreementNumber &&
      snapR.agreements.filter((a) => a.tradePackageId === vPkg).length === 1 &&
      agrR?.executedAt === agrE1?.executedAt,
    { agreementNumber: agrR?.agreementNumber, status: agrR?.status, executedAt: agrR?.executedAt, staleSameAsExecute1: agrR?.executedAt === agrE1?.executedAt, agreementRows: snapR.agreements.length }
  );

  const exec2 = await call("execute #2", () => c.mutation("agreements:executeAgreement", { agreementId: gen1._id }));
  await sleep(1100);
  const snapE2 = await projectSnapshot(c, F.void.id);
  const agrE2 = snapE2.agreements.find((a) => a._id === gen1._id);
  record(
    "A24-02.14",
    "EXECUTE #2: executed again, executedAt is refreshed to the new execution time",
    exec2.ok && agrE2?.status === "executed" && typeof agrE2?.executedAt === "number" && agrE2.executedAt > (agrE1?.executedAt ?? 0),
    { executedAt1: agrE1?.executedAt, executedAt2: agrE2?.executedAt }
  );

  const void2 = await call("void #2", () =>
    c.mutation("agreements:voidExecutedAgreement", {
      agreementId: gen1._id,
      reason: "QA24 lifecycle #2: second execution also voided; external amendment handled outside.",
    })
  );
  const snapV2 = await projectSnapshot(c, F.void.id);
  const agrV2 = snapV2.agreements.find((a) => a._id === gen1._id);
  const voidTitles = snapV2.logs.filter((l) => l.title === `Executed Subcontract Voided: ${gen1.agreementNumber}`);
  const execTitles = snapV2.logs.filter((l) => l.title === "AIA A401 Execution Status Recorded");
  const dupeAudit = [];
  const seen = new Map();
  for (const l of snapV2.logs) {
    const key = `${l.title}|${l.timestamp}`;
    if (seen.has(key)) dupeAudit.push(key);
    seen.set(key, true);
  }
  record(
    "A24-02.15",
    "VOID #2: clean final state (superseded, unawarded, reopened, single agreement row); no duplicate audit rows by title+timestamp",
    void2.ok && agrV2?.status === "superseded" &&
      snapV2.bids.find((b) => b._id === vBid)?.isAwarded === false &&
      snapV2.packages.find((p) => p._id === vPkg)?.status === "leveling" &&
      snapV2.agreements.filter((a) => a.tradePackageId === vPkg).length === 1 &&
      voidTitles.length === 2 && execTitles.length === 2 && dupeAudit.length === 0 &&
      voidTitles[0].timestamp !== voidTitles[1].timestamp,
    {
      final: { status: agrV2?.status, executedAt: agrV2?.executedAt },
      voidRows: voidTitles.map((l) => ({ t: l.timestamp, d: l.description.slice(0, 60) })),
      execRows: execTitles.length,
      dupeAudit,
    }
  );

  const awardedSequence = [snapE1, snapV1, snapR, snapE2, snapV2].map((s) => ({
    nonSupersededAgreements: s.agreements.filter((a) => a.status !== "superseded").length,
    awardedBids: s.bids.filter((b) => b.isAwarded).length,
    awardedPkgs: s.packages.filter((p) => p.status === "awarded").length,
    sum: kpiAwarded(s),
  }));
  record(
    "A24-02.16",
    "KPI reconciliation across the lifecycle: awarded signals increment on award/execute and return to zero after each void",
    JSON.stringify(awardedSequence.map((x) => x.sum)) === JSON.stringify([1, 0, 1, 1, 0]),
    { awardedSequence }
  );

  writeEvidence("backend", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
  writeLog("backend", log);
  console.log(`backend: ${results.filter((r) => r.pass).length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("backend-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});