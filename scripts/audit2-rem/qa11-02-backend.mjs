import { client, readEvidence, writeEvidence, writeLog, call, expectReject, expectOk, projectSnapshot, snapDigest, sleep } from "./qa11-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];

function record(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "FIXED" : "NOT-FIXED"}  ${name} :: ${detail}`);
}

async function main() {
  // ---------------------------------------------------------------- A10-01
  const execPkg = await c.query("tradePackages:getPackage", { tradePackageId: F.execPackageId });
  const execBefore = snapDigest(await projectSnapshot(c, F.execProjectId));
  const cycleCall = await call("A10-01 runFullProcurementCycle on executed package", () =>
    c.mutation("simulation:runFullProcurementCycle", {
      projectId: F.execProjectId,
      tradePackageId: F.execPackageId,
    })
  );
  const execAfter = snapDigest(await projectSnapshot(c, F.execProjectId));
  const refusal = expectReject(cycleCall, /executed subcontract/i, "cycle refuses executed package");
  const unchanged = JSON.stringify(execBefore) === JSON.stringify(execAfter);
  record(
    "A10-01-refuse-executed-cycle",
    refusal.ok && unchanged,
    `${refusal.observed}; stateUnchanged=${unchanged}`
  );
  const execAgrStill = (await c.query("agreements:listAgreements", { projectId: F.execProjectId })).find(
    (a) => a._id === F.execAgreementId
  );
  record(
    "A10-01-executed-agreement-intact",
    execAgrStill && execAgrStill.status === "executed",
    `status=${execAgrStill ? execAgrStill.status : "MISSING"}`
  );

  // normal full cycle on a package without executed contract
  const cycleOk = await call("A10-01 normal full cycle", () =>
    c.mutation("simulation:runFullProcurementCycle", {
      projectId: F.cycleProjectId,
      tradePackageId: F.cyclePackageId,
    })
  );
  record(
    "A10-01-normal-cycle-works",
    cycleOk.ok && cycleOk.value && cycleOk.value.success === true,
    cycleOk.ok ? `success agreement=${cycleOk.value.agreementId} winner=${cycleOk.value.winningBidder}` : cycleOk.data || cycleOk.message
  );

  // ---------------------------------------------------------------- A10-03
  const cycleAgreements = await c.query("agreements:listAgreements", { projectId: F.cycleProjectId });
  const cycleAgr = cycleAgreements.find((a) => a._id === cycleOk.value?.agreementId) || cycleAgreements[0];
  const title = cycleAgr ? cycleAgr.documentTitle : null;
  const titleOk =
    typeof title === "string" &&
    /generated draft/i.test(title) &&
    /not an AIA-licensed form/i.test(title) &&
    !/^AIA Document A401/i.test(title);
  record("A10-03-draft-document-title", titleOk, `documentTitle=${JSON.stringify(title)}`);

  // ---------------------------------------------------------------- A10-02
  const delBefore = snapDigest(await projectSnapshot(c, F.execProjectId));
  const delRefuse = await call("A10-02 deleteProject with executed subcontract", () =>
    c.mutation("projects:deleteProject", { projectId: F.execProjectId })
  );
  const delAfter = snapDigest(await projectSnapshot(c, F.execProjectId));
  const delRefusal = expectReject(delRefuse, /executed subcontract/i, "deleteProject refuses");
  const delUnchanged = JSON.stringify(delBefore) === JSON.stringify(delAfter);
  record("A10-02-refuse-delete-executed", delRefusal.ok && delUnchanged, `${delRefusal.observed}; stateUnchanged=${delUnchanged}`);

  const delOk = await call("A10-02 normal project delete", () =>
    c.mutation("projects:deleteProject", { projectId: F.delProjectId })
  );
  let cascade = null;
  if (delOk.ok) {
    const post = await projectSnapshot(c, F.delProjectId);
    cascade = {
      project: post.project,
      packages: post.packages.length,
      bids: post.bids.length,
      contractors: post.contractors.length,
      agreements: post.agreements.length,
      files: post.files.length,
      logs: post.logs.length,
    };
  }
  const cascadeClean =
    cascade &&
    cascade.project == null &&
    cascade.packages === 0 &&
    cascade.bids === 0 &&
    cascade.contractors === 0 &&
    cascade.agreements === 0;
  record(
    "A10-02-normal-delete-cascades",
    delOk.ok && cascadeClean,
    delOk.ok ? JSON.stringify(cascade) : delOk.data || delOk.message
  );

  // ---------------------------------------------------------------- A10-04 / A8-03
  const hvacBidBefore = (await c.query("bids:listByPackage", { tradePackageId: F.mainHvacPackageId })).find(
    (b) => b._id === F.mainHvacBidId
  );
  const firstCredit = await call("A10-04 first credit clash-vfd-01", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.mainProjectId,
      clashId: "clash-vfd-01",
      tradePackageId: F.mainHvacPackageId,
      deductAmount: 38500,
      description: "QA11 VFD redundant buyout",
    })
  );
  const hvacBidMid = (await c.query("bids:listByPackage", { tradePackageId: F.mainHvacPackageId })).find(
    (b) => b._id === F.mainHvacBidId
  );
  const firstOk = firstCredit.ok && hvacBidMid && hvacBidBefore.leveledTotalCost - hvacBidMid.leveledTotalCost === 38500;
  record(
    "A10-04-first-credit-applies",
    firstOk,
    `leveled ${hvacBidBefore.leveledTotalCost} -> ${hvacBidMid ? hvacBidMid.leveledTotalCost : "?"} (delta=${
      hvacBidMid ? hvacBidBefore.leveledTotalCost - hvacBidMid.leveledTotalCost : "?"
    })`
  );

  const secondCredit = await call("A10-04 duplicate credit clash-vfd-01", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.mainProjectId,
      clashId: "clash-vfd-01",
      tradePackageId: F.mainHvacPackageId,
      deductAmount: 500,
      description: "QA11 duplicate attempt",
    })
  );
  const dupRefusal = expectReject(secondCredit, /already been applied|already/i, "duplicate refuses");
  const hvacBidAfterDup = (await c.query("bids:listByPackage", { tradePackageId: F.mainHvacPackageId })).find(
    (b) => b._id === F.mainHvacBidId
  );
  const levelingOnce =
    hvacBidAfterDup && hvacBidMid && hvacBidAfterDup.leveledTotalCost === hvacBidMid.leveledTotalCost;
  const resolutionsVfd = await c.raw.query("coordination:detectCrossTradeClashes", { projectId: F.mainProjectId });
  const vfdClash = (resolutionsVfd.doubleBuys || []).find((d) => d.id === "clash-vfd-01");
  record(
    "A10-04-duplicate-credit-refused",
    dupRefusal.ok && levelingOnce,
    `${dupRefusal.observed}; leveledUnchanged=${levelingOnce}`
  );
  record(
    "A10-04-vfd-resolution-single",
    vfdClash && vfdClash.status === "deducted" && vfdClash.deductedAmount === 38500,
    vfdClash ? `status=${vfdClash.status} deductedAmount=${vfdClash.deductedAmount}` : "clash not found"
  );

  // ---------------------------------------------------------------- A10-07 backend truth
  const secondDeduct = await call("A10-07 custom credit clash-disconnect-02", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.mainProjectId,
      clashId: "clash-disconnect-02",
      tradePackageId: F.mainHvacPackageId,
      deductAmount: 9999,
      description: "QA11 disconnect redundant buyout",
    })
  );
  const clashes = await c.raw.query("coordination:detectCrossTradeClashes", { projectId: F.mainProjectId });
  const discClash = (clashes.doubleBuys || []).find((d) => d.id === "clash-disconnect-02");
  const backendResolutionTotal =
    (clashes.doubleBuys || []).reduce((s, d) => s + (typeof d.deductedAmount === "number" ? d.deductedAmount : 0), 0);
  const expectedUiTotal = 38500 + 9999;
  record(
    "A10-07-backend-credit-truth",
    secondDeduct.ok && discClash && discClash.deductedAmount === 9999 && backendResolutionTotal === expectedUiTotal,
    `disconnect deductedAmount=${discClash ? discClash.deductedAmount : "?"}; resolutionTotal=${backendResolutionTotal}; expectedUi=$${expectedUiTotal.toLocaleString()}`
  );

  // ---------------------------------------------------------------- A10-05
  const lvlFrac = await call("A10-05 updateBidLeveling fractional weeks", () =>
    c.mutation("bids:updateBidLeveling", { bidId: F.mainElecBidId, longLeadEquipmentWeeks: 2.5 })
  );
  const fracReject = expectReject(lvlFrac, /whole number/i, "fractional rejected");
  const lvlNeg = await call("A10-05 updateBidLeveling negative weeks", () =>
    c.mutation("bids:updateBidLeveling", { bidId: F.mainElecBidId, longLeadEquipmentWeeks: -1 })
  );
  const negReject = expectReject(lvlNeg, /whole number/i, "negative rejected");
  const lvlValid = await call("A10-05 updateBidLeveling valid weeks", () =>
    c.mutation("bids:updateBidLeveling", { bidId: F.mainElecBidId, longLeadEquipmentWeeks: 16 })
  );
  const lvlSaved = (await c.query("bids:listByPackage", { tradePackageId: F.mainElecPackageId })).find(
    (b) => b._id === F.mainElecBidId
  );
  record(
    "A10-05-updateBidLeveling-bounds",
    fracReject.ok && negReject.ok && lvlValid.ok && lvlSaved && lvlSaved.longLeadEquipmentWeeks === 16,
    `frac=${fracReject.observed}; neg=${negReject.observed}; validSaved=${lvlSaved ? lvlSaved.longLeadEquipmentWeeks : "?"}`
  );

  const adjFrac = await call("A10-05 updateBidAdjustments fractional weeks", () =>
    c.mutation("bids:updateBidAdjustments", {
      bidId: F.mainElecBidId,
      identifiedExclusions: [],
      longLeadEquipmentWeeks: 1.25,
    })
  );
  const adjFracReject = expectReject(adjFrac, /whole number/i, "fractional rejected");
  const adjValid = await call("A10-05 updateBidAdjustments valid weeks", () =>
    c.mutation("bids:updateBidAdjustments", {
      bidId: F.mainElecBidId,
      identifiedExclusions: [],
      longLeadEquipmentWeeks: 10,
    })
  );
  const adjSaved = (await c.query("bids:listByPackage", { tradePackageId: F.mainElecPackageId })).find(
    (b) => b._id === F.mainElecBidId
  );
  record(
    "A10-05-updateBidAdjustments-bounds",
    adjFracReject.ok && adjValid.ok && adjSaved && adjSaved.longLeadEquipmentWeeks === 10,
    `frac=${adjFracReject.observed}; validSaved=${adjSaved ? adjSaved.longLeadEquipmentWeeks : "?"}`
  );

  // ---------------------------------------------------------------- A10-06
  const negBid = await call("A10-06 submitDirectBid negative line item", () =>
    c.mutation("bids:submitDirectBid", {
      tradePackageId: F.mainElecPackageId,
      contractorId: F.mainBackupContractorId,
      subcontractorName: "AUDIT-QA11 Main Electric Backup",
      baseBidAmount: 640_000,
      lineItems: [{ item: "QA11 negative line", unit: "LS", quantity: 1, unitCost: -5, totalCost: -5 }],
      longLeadEquipmentWeeks: 12,
      leadTimePenalty: 0,
      coiComplianceStatus: "compliant",
      coiPenalty: 0,
    })
  );
  const negRejectBid = expectReject(negBid, /non-negative/i, "negative line rejected");
  const validBid = await call("A10-06 submitDirectBid valid line items", () =>
    c.mutation("bids:submitDirectBid", {
      tradePackageId: F.mainElecPackageId,
      contractorId: F.mainBackupContractorId,
      subcontractorName: "AUDIT-QA11 Main Electric Backup",
      baseBidAmount: 640_000,
      lineItems: [
        { item: "QA11 valid line A", unit: "LS", quantity: 1, unitCost: 400_000, totalCost: 400_000 },
        { item: "QA11 valid line B", unit: "LS", quantity: 1, unitCost: 240_000, totalCost: 240_000 },
      ],
      longLeadEquipmentWeeks: 12,
      leadTimePenalty: 0,
      coiComplianceStatus: "compliant",
      coiPenalty: 0,
    })
  );
  const backupSaved = (await c.query("bids:listByPackage", { tradePackageId: F.mainElecPackageId })).find(
    (b) => b.contractorId === F.mainBackupContractorId
  );
  record(
    "A10-06-submitDirectBid-negative-line-items",
    negRejectBid.ok && validBid.ok && backupSaved && backupSaved.lineItems.every((li) => li.totalCost >= 0),
    `negative=${negRejectBid.observed}; validBid=${validBid.ok}; storedLines=${backupSaved ? backupSaved.lineItems.length : "?"}`
  );
  record(
    "A10-06-submitDirectBid-valid-saves",
    validBid.ok && backupSaved && backupSaved.baseBidAmount === 640_000,
    `base=${backupSaved ? backupSaved.baseBidAmount : "?"}`
  );

  // ---------------------------------------------------------------- A9-02 backend guard
  const fileDel = await call("A9-02 deleteFile on bid-linked quote", () =>
    c.mutation("files:deleteFile", { fileId: F.ingestFileId })
  );
  const fileDelReject = expectReject(fileDel, /linked to a bid/i, "guard reason surfaced");
  const fileStill = (await c.query("files:listFilesByProject", { projectId: F.ingestProjectId })).find(
    (f) => f._id === F.ingestFileId
  );
  record(
    "A9-02-delete-linked-file-guard",
    fileDelReject.ok && Boolean(fileStill),
    `${fileDelReject.observed}; fileStillPresent=${Boolean(fileStill)}`
  );

  // ---------------------------------------------------------------- HUNT backend: award / unaward / re-award / void / deletes
  const awardGen = await call("HUNT generateAgreement", () =>
    c.mutation("agreements:generateAgreement", { bidId: F.mainElecBidId, tradePackageId: F.mainElecPackageId })
  );
  const awardCall = await call("HUNT awardContract", () =>
    c.mutation("bids:awardContract", { bidId: F.mainElecBidId, tradePackageId: F.mainElecPackageId })
  );
  const awardedBid = (await c.query("bids:listByPackage", { tradePackageId: F.mainElecPackageId })).find(
    (b) => b._id === F.mainElecBidId
  );
  const awardOk = awardGen.ok && awardCall.ok && awardedBid && awardedBid.isAwarded === true;
  record("HUNT-award-contract", awardOk, `gen=${awardGen.ok} award=${awardCall.ok} isAwarded=${awardedBid ? awardedBid.isAwarded : "?"}`);

  const unawardCall = await call("HUNT unawardContract", () =>
    c.mutation("bids:unawardContract", { bidId: F.mainElecBidId, tradePackageId: F.mainElecPackageId })
  );
  const unawardedBid = (await c.query("bids:listByPackage", { tradePackageId: F.mainElecPackageId })).find(
    (b) => b._id === F.mainElecBidId
  );
  const awardAgreements1 = await c.query("agreements:listAgreements", { projectId: F.mainProjectId });
  const mainAgr = awardAgreements1.find((a) => a.bidId === F.mainElecBidId);
  record(
    "HUNT-unaward-contract",
    unawardCall.ok && unawardedBid && unawardedBid.isAwarded === false && mainAgr && mainAgr.status === "superseded",
    `unaward=${unawardCall.ok} isAwarded=${unawardedBid ? unawardedBid.isAwarded : "?"} agreement=${mainAgr ? mainAgr.status : "?"}`
  );

  const reGen = await call("HUNT re-award generate", () =>
    c.mutation("agreements:generateAgreement", { bidId: F.mainElecBidId, tradePackageId: F.mainElecPackageId })
  );
  const reAward = await call("HUNT re-award contract", () =>
    c.mutation("bids:awardContract", { bidId: F.mainElecBidId, tradePackageId: F.mainElecPackageId })
  );
  const reAwarded = (await c.query("bids:listByPackage", { tradePackageId: F.mainElecPackageId })).find(
    (b) => b._id === F.mainElecBidId
  );
  record("HUNT-re-award", reGen.ok && reAward.ok && reAwarded && reAwarded.isAwarded === true, `re-award isAwarded=${reAwarded ? reAwarded.isAwarded : "?"}`);

  const assignVoid = await call("HUNT assign scope void", () =>
    c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: F.mainProjectId,
      voidId: "void-bas-wiring-01",
      tradePackageId: F.mainElecPackageId,
      additionalCost: 28000,
      description: "QA11 BAS control wiring field assignment",
    })
  );
  const voidClashes = await c.raw.query("coordination:detectCrossTradeClashes", { projectId: F.mainProjectId });
  const basVoid = (voidClashes.scopeVoids || []).find((v) => v.id === "void-bas-wiring-01");
  record("HUNT-assign-scope-void", assignVoid.ok && basVoid && basVoid.status === "assigned", `assign=${assignVoid.ok} status=${basVoid ? basVoid.status : "?"}`);

  const backupBidRow = (await c.query("bids:listByPackage", { tradePackageId: F.mainElecPackageId })).find(
    (b) => b.contractorId === F.mainBackupContractorId
  );
  const deleteBidCall = await call("HUNT deleteBid", () => c.mutation("bids:deleteBid", { bidId: backupBidRow._id }));
  const deletedStill = (await c.query("bids:listByPackage", { tradePackageId: F.mainElecPackageId })).find(
    (b) => b._id === backupBidRow._id
  );
  record("HUNT-delete-bid", deleteBidCall.ok && !deletedStill, `deleted=${deleteBidCall.ok} present=${Boolean(deletedStill)}`);

  const deleteContractorCall = await call("HUNT deleteContractor", () =>
    c.mutation("contractors:deleteContractor", { contractorId: F.mainBackupContractorId })
  );
  const contractorGone = !(await c.query("contractors:listByPackage", { tradePackageId: F.mainElecPackageId })).some(
    (x) => x._id === F.mainBackupContractorId
  );
  record("HUNT-delete-contractor", deleteContractorCall.ok && contractorGone, `deleted=${deleteContractorCall.ok} gone=${contractorGone}`);

  // KPI reconciliation snapshot (numbers for the report / UI cross-check)
  const mainSnap = await projectSnapshot(c, F.mainProjectId);
  const kpi = {
    packages: mainSnap.packages.length,
    bids: mainSnap.bids.length,
    awarded: mainSnap.bids.filter((b) => b.isAwarded).length,
    agreements: mainSnap.agreements.length,
    doubleBuyExposure: (clashes.doubleBuys || []).filter((d) => d.status === "detected").reduce((s, d) => s + d.redundantAmount, 0),
    recoveredCredits: backendResolutionTotal,
    scopeVoidExposure: (voidClashes.scopeVoids || []).filter((v) => v.status === "open").reduce((s, v) => s + v.estimatedVoidCost, 0),
    activeClashes: (voidClashes.doubleBuys || []).filter((d) => d.status === "detected").length + (voidClashes.scopeVoids || []).filter((v) => v.status === "open").length,
  };
  say(`KPI reconciliation MAIN: ${JSON.stringify(kpi)}`);

  writeEvidence("backend", { results, expectedUiCreditTotal: expectedUiTotal, kpi, cycleAgreementDocumentTitle: title });
  writeLog("backend", log);
  console.log(`\nbackend results: ${results.filter((r) => r.pass).length}/${results.length} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});