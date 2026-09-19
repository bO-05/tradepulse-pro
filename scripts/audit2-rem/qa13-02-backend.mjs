import {
  client,
  call,
  expectReject,
  expectOk,
  readEvidence,
  writeEvidence,
  writeLog,
} from "./qa13-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${detail}`);
};

async function listBids(pkgId) {
  return (await c.query("bids:listByPackage", { tradePackageId: pkgId })) || [];
}
async function listAgreements(projectId) {
  return (await c.query("agreements:listAgreements", { projectId })) || [];
}

async function main() {
  // ================================================================ A11-04 backend credit
  const deduct = await call("A11-04 deduct custom 9999 on clash-disconnect-02", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.mainProjectId,
      clashId: "clash-disconnect-02",
      tradePackageId: F.mainHvacPackageId,
      deductAmount: 9999,
      description: "Rooftop Mechanical Equipment Disconnect Switches",
    })
  );
  const clashes = await c.raw.query("coordination:detectCrossTradeClashes", { projectId: F.mainProjectId });
  const disconnect = (clashes.doubleBuys || []).find((d) => d.id === "clash-disconnect-02");
  const hvacBidAfterCredit = (await listBids(F.mainHvacPackageId)).find((b) => b._id === F.mainHvacBidId);
  record(
    "A11-04-backend-custom-credit",
    deduct.ok &&
      disconnect &&
      disconnect.status === "deducted" &&
      disconnect.deductedAmount === 9999 &&
      hvacBidAfterCredit &&
      hvacBidAfterCredit.leveledTotalCost === 790_001,
    `deduct=${deduct.ok}; deductedAmount=${disconnect ? disconnect.deductedAmount : "?"}; staticResolution=${JSON.stringify(disconnect ? disconnect.resolution : null)}; hvacLeveled=${hvacBidAfterCredit ? hvacBidAfterCredit.leveledTotalCost : "?"}`
  );

  // ================================================================ A12-03 refusal (no evidence)
  const statusRefuse = await call("A12-03 updateStatus awarded without evidence (plumbing)", () =>
    c.mutation("tradePackages:updateStatus", { tradePackageId: F.mainPlumbPackageId, status: "awarded" })
  );
  const plumbPkgAfterRefuse = await c.query("tradePackages:getPackage", { tradePackageId: F.mainPlumbPackageId });
  const statusRefusal = expectReject(statusRefuse, /awarded after a bid is awarded|award evidence|only be marked awarded/i, "refused");
  record(
    "A12-03-refuse-no-evidence",
    statusRefusal.ok && plumbPkgAfterRefuse.status !== "awarded",
    `${statusRefusal.observed}; pkgStatus=${plumbPkgAfterRefuse.status}`
  );

  // ================================================================ A12-06 setup: superseded plumbing agreement
  const plumbGen = await call("A12-06 setup generate plumbing agreement", () =>
    c.mutation("agreements:generateAgreement", { bidId: F.mainPlumbBidId, tradePackageId: F.mainPlumbPackageId })
  );
  const plumbAgr = (await listAgreements(F.mainProjectId)).find((a) => a.bidId === F.mainPlumbBidId);
  const plumbUnaward = await call("A12-06 setup unaward plumbing", () =>
    c.mutation("bids:unawardContract", { bidId: F.mainPlumbBidId, tradePackageId: F.mainPlumbPackageId })
  );
  const plumbAgrAfter = (await listAgreements(F.mainProjectId)).find((a) => a._id === plumbAgr._id);
  record(
    "A12-06-setup-superseded-agreement",
    plumbGen.ok && plumbUnaward.ok && plumbAgrAfter && plumbAgrAfter.status === "superseded",
    `agreement=${plumbAgrAfter ? plumbAgrAfter._id : "?"} status=${plumbAgrAfter ? plumbAgrAfter.status : "?"}`
  );

  // ================================================================ A12-01 superseded award guard
  const hvacPkg0 = await c.query("tradePackages:getPackage", { tradePackageId: F.mainHvacPackageId });
  const hvacGen1 = await call("A12-01 generateAgreement (hvac)", () =>
    c.mutation("agreements:generateAgreement", { bidId: F.mainHvacBidId, tradePackageId: F.mainHvacPackageId })
  );
  const hvacAgr1 = (await listAgreements(F.mainProjectId)).find((a) => a.bidId === F.mainHvacBidId);
  const hvacUnaward = await call("A12-01 unawardContract (hvac)", () =>
    c.mutation("bids:unawardContract", { bidId: F.mainHvacBidId, tradePackageId: F.mainHvacPackageId })
  );
  const hvacAgrSuperseded = (await listAgreements(F.mainProjectId)).find((a) => a._id === hvacAgr1._id);
  const awardRefuse = await call("A12-01 awardContract on superseded agreement", () =>
    c.mutation("bids:awardContract", { bidId: F.mainHvacBidId, tradePackageId: F.mainHvacPackageId })
  );
  const awardRefusal = expectReject(awardRefuse, /superseded/i, "award refused");
  const hvacBidAfterRefuse = (await listBids(F.mainHvacPackageId)).find((b) => b._id === F.mainHvacBidId);
  record(
    "A12-01-refuse-superseded-award",
    hvacGen1.ok &&
      hvacUnaward.ok &&
      hvacAgrSuperseded.status === "superseded" &&
      awardRefusal.ok &&
      hvacBidAfterRefuse.isAwarded === false,
    `agreementStatus=${hvacAgrSuperseded.status}; refusal=${JSON.stringify(awardRefusal.observed)}; bidAwarded=${hvacBidAfterRefuse.isAwarded}`
  );
  const hvacGen2 = await call("A12-01 regenerateAgreement (hvac)", () =>
    c.mutation("agreements:generateAgreement", { bidId: F.mainHvacBidId, tradePackageId: F.mainHvacPackageId })
  );
  const hvacAward2 = await call("A12-01 awardContract after regeneration", () =>
    c.mutation("bids:awardContract", { bidId: F.mainHvacBidId, tradePackageId: F.mainHvacPackageId })
  );
  const hvacAgr2 = (await listAgreements(F.mainProjectId)).find((a) => a._id === hvacAgr1._id);
  const hvacBidAwarded = (await listBids(F.mainHvacPackageId)).find((b) => b._id === F.mainHvacBidId);
  record(
    "A12-01-regenerate-allows-award",
    hvacGen2.ok && hvacAward2.ok && hvacAgr2.status !== "superseded" && hvacBidAwarded.isAwarded === true,
    `agreementStatus=${hvacAgr2.status}; contractSum=${hvacAgr2.contractSum}; bidAwarded=${hvacBidAwarded.isAwarded}`
  );

  // ================================================================ A12-03 success after real award
  const statusOk = await call("A12-03 updateStatus awarded after real award (hvac)", () =>
    c.mutation("tradePackages:updateStatus", { tradePackageId: F.mainHvacPackageId, status: "awarded" })
  );
  const hvacPkg1 = await c.query("tradePackages:getPackage", { tradePackageId: F.mainHvacPackageId });
  record(
    "A12-03-succeeds-after-award",
    statusOk.ok && hvacPkg1.status === "awarded",
    `status update=${statusOk.ok}; pkgStatus=${hvacPkg1.status}`
  );
  void hvacPkg0;

  // ================================================================ A12-02 revision syncs active agreement
  const elecGen = await call("A12-02 generateAgreement (elec award)", () =>
    c.mutation("agreements:generateAgreement", { bidId: F.mainElecBidId, tradePackageId: F.mainElecPackageId })
  );
  const elecAgrBefore = (await listAgreements(F.mainProjectId)).find((a) => a.bidId === F.mainElecBidId);
  const revision = await call("A12-02 submitDirectBid revision on awarded bid", () =>
    c.mutation("bids:submitDirectBid", {
      tradePackageId: F.mainElecPackageId,
      contractorId: F.mainElecContractorId,
      subcontractorName: "AUDIT-QA13 Totally Fake Bidder Name",
      baseBidAmount: 910_000,
      lineItems: [{ item: "QA13 Electrical revised scope", unit: "LS", quantity: 1, unitCost: 910_000, totalCost: 910_000 }],
      identifiedExclusions: [],
      valueEngineeringAlternates: [],
      longLeadEquipmentWeeks: 12,
      leadTimePenalty: 0,
      coiComplianceStatus: "compliant",
      coiPenalty: 0,
    })
  );
  const elecBidRev = (await listBids(F.mainElecPackageId)).find((b) => b._id === F.mainElecBidId);
  const elecAgrAfter = (await listAgreements(F.mainProjectId)).find((a) => a.bidId === F.mainElecBidId);
  record(
    "A12-02-revision-syncs-agreement",
    elecGen.ok &&
      revision.ok &&
      elecAgrBefore.contractSum === 850_000 &&
      elecBidRev.leveledTotalCost === 910_000 &&
      elecAgrAfter.contractSum === elecBidRev.leveledTotalCost &&
      elecAgrAfter.contractorId === F.mainElecContractorId,
    `agrBefore=${elecAgrBefore.contractSum} -> bid=${elecBidRev.leveledTotalCost} / agrAfter=${elecAgrAfter.contractSum}; revisionNumber=${elecBidRev.revisionNumber}`
  );

  // A12-08 canonical bidder name after revision submitted with a fake display name
  record(
    "A12-08-bidder-name-canonical",
    elecBidRev.subcontractorName === "AUDIT-QA13 Main Electric Co" &&
      elecAgrAfter.subcontractorName === "AUDIT-QA13 Main Electric Co" &&
      !elecBidRev.subcontractorName.includes("Fake"),
    `bidName=${JSON.stringify(elecBidRev.subcontractorName)}; agreementName=${JSON.stringify(elecAgrAfter.subcontractorName)}`
  );

  // ================================================================ A12-08 reserved / zero-width names
  const reserved = await call("A12-08 createContractor AWARDED", () =>
    c.mutation("contractors:createContractor", {
      tradePackageId: F.mainElecPackageId,
      companyName: "AWARDED",
      contactEmail: "reserved@qa13.invalid",
      licenseNumber: "TX-QA13-R",
      licenseStatus: "active",
      sourceUrl: "https://qa13.invalid/reserved",
      rfqStatus: "discovered",
    })
  );
  const reservedReject = expectReject(reserved, /reserved system label/i, "reserved label refused");
  const zeroWidth = await call("A12-08 createContractor zero-width", () =>
    c.mutation("contractors:createContractor", {
      tradePackageId: F.mainElecPackageId,
      companyName: "AUDIT\u200BQA13",
      contactEmail: "zerowidth@qa13.invalid",
      licenseNumber: "TX-QA13-Z",
      licenseStatus: "active",
      sourceUrl: "https://qa13.invalid/zerowidth",
      rfqStatus: "discovered",
    })
  );
  const zeroWidthReject = expectReject(zeroWidth, /invisible|direction-control/i, "zero-width refused");
  record(
    "A12-08-refuse-reserved-and-zero-width",
    reservedReject.ok && zeroWidthReject.ok,
    `reserved=${JSON.stringify(reservedReject.observed)}; zeroWidth=${JSON.stringify(zeroWidthReject.observed)}`
  );

  // ================================================================ A12-07 §6.1 accounting line
  const execAgr = (await listAgreements(F.execProjectId)).find((a) => a._id === F.execAgreementId);
  const line = (execAgr.contractText.match(/\(Accounting Reconciliation:[^\n]*\)/) || [null])[0];
  record(
    "A12-07-accounting-line-names-adjustments",
    Boolean(
      line &&
        /scope-gap/i.test(line) &&
        /lead-time/i.test(line) &&
        /COI adjustments/i.test(line)
    ),
    `line=${JSON.stringify(line)}`
  );

  // ================================================================ Expected UI reconciliation numbers
  const activeAgreements = (await listAgreements(F.mainProjectId)).filter((a) => a.status !== "superseded");
  const contractsActiveTotal = activeAgreements.reduce((s, a) => s + a.contractSum, 0);
  const expected = {
    elecAgreementSum: elecAgrAfter.contractSum,
    hvacAgreementSum: hvacAgr2.contractSum,
    plumbAgreementStatus: plumbAgrAfter.status,
    contractsActiveTotal,
    totalLeveledBuyout: 910_000 + 790_001 + 320_000,
    awardedPackages: 2,
    totalPackages: 3,
    disconnectApplied: 9999,
    disconnectBenchmark: 12000,
  };
  say(`expected UI numbers: ${JSON.stringify(expected)}`);

  writeEvidence("backend", { results, expected, details: {
    disconnect,
    elecBidRev: {
      _id: elecBidRev._id,
      subcontractorName: elecBidRev.subcontractorName,
      baseBidAmount: elecBidRev.baseBidAmount,
      leveledTotalCost: elecBidRev.leveledTotalCost,
      revisionNumber: elecBidRev.revisionNumber,
      isAwarded: elecBidRev.isAwarded,
    },
    elecAgrAfter: {
      _id: elecAgrAfter._id,
      agreementNumber: elecAgrAfter.agreementNumber,
      contractSum: elecAgrAfter.contractSum,
      subcontractorName: elecAgrAfter.subcontractorName,
      status: elecAgrAfter.status,
    },
    hvacAgr2: {
      _id: hvacAgr2._id,
      agreementNumber: hvacAgr2.agreementNumber,
      contractSum: hvacAgr2.contractSum,
      status: hvacAgr2.status,
    },
    plumbAgrAfter: { _id: plumbAgrAfter._id, status: plumbAgrAfter.status },
    execContractLength: execAgr.contractText.length,
    accountingLine: line,
  } });
  writeLog("backend", log);
  console.log(`\nbackend results: ${results.filter((r) => r.pass).length}/${results.length} passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });