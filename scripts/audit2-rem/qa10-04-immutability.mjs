import { client, readEvidence, writeEvidence, writeLog, call } from "./qa10-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const rows = [];
const say = (s) => { log.push(s); console.log(s); };

function rec(id, expected, entry, note, okOverride) {
  const observed = entry.ok
    ? `ACCEPTED ${typeof entry.value === "object" ? JSON.stringify(entry.value).slice(0, 200) : entry.value}`
    : `REJECTED: ${(entry.data ?? entry.message ?? "").toString().split("\n")[0].slice(0, 190)}`;
  const ok = okOverride !== undefined ? okOverride : expected === "reject" ? !entry.ok : true;
  rows.push({ id, expected, observed, ok, note: note ?? null });
  say(`${ok ? "ok " : "FLAG"} ${id} | expected=${expected} | ${observed}`);
  return entry;
}

async function snapBravo() {
  const agreements = await c.query("agreements:listAgreements", { projectId: F.bravo.projectId });
  const bids = await c.query("bids:listAllProjectBids", { projectId: F.bravo.projectId });
  const pkgs = await c.query("tradePackages:listByProject", { projectId: F.bravo.projectId });
  return { agreements, bids, pkgs };
}

async function main() {
  // ---------------- A: executed-agreement immutability on leveling writers ----------------
  const before = await snapBravo();
  const ag = before.agreements[0];
  const bid = before.bids.find((b) => b._id === F.bravo.bid);
  say(`BRAVO before: agreement=${ag.agreementNumber} status=${ag.status} contractSum=${ag.contractSum}; bid leveled=${bid.leveledTotalCost} exclusions=${bid.identifiedExclusions.length}`);

  const adj = await call("updateBidAdjustments on executed", () => c.mutation("bids:updateBidAdjustments", {
    bidId: F.bravo.bid,
    identifiedExclusions: [{ description: "QA10 post-execution edit", costImpact: 999999, severity: "critical" }],
  }));
  const afterAdj = await snapBravo();
  const bidAdj = afterAdj.bids.find((b) => b._id === F.bravo.bid);
  const agAdj = afterAdj.agreements.find((a) => a._id === ag._id);
  rec("A10-I01 updateBidAdjustments on executed agreement", "reject", adj, `rollback check: bid exclusions=${bidAdj.identifiedExclusions.length} leveled=${bidAdj.leveledTotalCost} agreement=${agAdj.status}/${agAdj.contractSum}`, !adj.ok && bidAdj.identifiedExclusions.length === bid.identifiedExclusions.length);

  const asg = await call("assignScopeVoid on executed bid", () => c.mutation("coordination:assignScopeVoidToTrade", {
    projectId: F.bravo.projectId,
    voidId: "void-bas-wiring-01",
    tradePackageId: F.bravo.elecPackageId,
    additionalCost: 777777,
    description: "QA10 post-execution void",
    bidId: F.bravo.bid,
  }));
  const afterAsg = await snapBravo();
  const pkgAsg = afterAsg.pkgs.find((p) => p._id === F.bravo.elecPackageId);
  const bidAsg = afterAsg.bids.find((b) => b._id === F.bravo.bid);
  rec("A10-I02 assignScopeVoidToTrade on executed bid", "reject", asg, `rollback check: mandatoryInclusions=${JSON.stringify(pkgAsg.mandatoryInclusions)} bidBase=${bidAsg.baseBidAmount}`, !asg.ok && !pkgAsg.mandatoryInclusions.includes("QA10 post-execution void") && bidAsg.baseBidAmount === bid.baseBidAmount);

  const ded = await call("deduct on executed bid", () => c.mutation("coordination:deductDoubleBuyCredit", {
    projectId: F.bravo.projectId,
    clashId: "clash-vfd-01",
    tradePackageId: F.bravo.elecPackageId,
    deductAmount: 55555,
    description: "QA10 post-execution deduct",
    bidId: F.bravo.bid,
  }));
  const afterDed = await snapBravo();
  const bidDed = afterDed.bids.find((b) => b._id === F.bravo.bid);
  rec("A10-I03 deductDoubleBuyCredit on executed bid", "reject", ded, `rollback check: leveled=${bidDed.leveledTotalCost} veCount=${(bidDed.valueEngineeringAlternates || []).length}`, !ded.ok && bidDed.leveledTotalCost === bid.leveledTotalCost);

  // ---------------- B: deleteProject destroys an executed subcontract ----------------
  const del = await call("deleteProject with executed agreement", () => c.mutation("projects:deleteProject", { projectId: F.bravo.projectId }));
  const projGone = !(await c.query("projects:getProject", { projectId: F.bravo.projectId }));
  const agsGone = (await c.query("agreements:listAgreements", { projectId: F.bravo.projectId })).length === 0;
  const bidsGone = (await c.query("bids:listAllProjectBids", { projectId: F.bravo.projectId })).length === 0;
  const pkgsGone = (await c.query("tradePackages:listByProject", { projectId: F.bravo.projectId })).length === 0;
  rec("A10-I04 deleteProject cascades through executed subcontract", "inspect", del,
    `projectGone=${projGone} executedAgreement(${ag.agreementNumber})Gone=${agsGone} bidsGone=${bidsGone} packagesGone=${pkgsGone}`,
    true);

  // ---------------- C: runFullProcurementCycle destroys executed subcontract ----------------
  const mBefore = {
    agreements: await c.query("agreements:listAgreements", { projectId: F.malformed.projectId }),
    bids: await c.query("bids:listAllProjectBids", { projectId: F.malformed.projectId }),
    pkgs: await c.query("tradePackages:listByProject", { projectId: F.malformed.projectId }),
  };
  const executedBefore = mBefore.agreements.find((a) => a.status === "executed");
  const awardedBidBefore = mBefore.bids.find((b) => b.isAwarded);
  say(`MALFORMED before cycle: agreement=${executedBefore?.agreementNumber} status=${executedBefore?.status}; awardedBid=${awardedBidBefore?._id} leveled=${awardedBidBefore?.leveledTotalCost}`);
  writeEvidence("immutability-before", {
    executedAgreement: executedBefore ? { id: executedBefore._id, number: executedBefore.agreementNumber, status: executedBefore.status, contractSum: executedBefore.contractSum } : null,
    awardedBid: awardedBidBefore ? { id: awardedBidBefore._id, isAwarded: awardedBidBefore.isAwarded, leveledTotalCost: awardedBidBefore.leveledTotalCost } : null,
    allAgreements: mBefore.agreements.map((a) => ({ id: a._id, status: a.status, number: a.agreementNumber, documentTitle: a.documentTitle })),
  });

  const cycle = await call("runFullProcurementCycle on executed package", () => c.mutation("simulation:runFullProcurementCycle", {
    projectId: F.malformed.projectId,
    tradePackageId: F.malformed.elecPackageId,
  }));
  const mAfter = {
    agreements: await c.query("agreements:listAgreements", { projectId: F.malformed.projectId }),
    bids: await c.query("bids:listAllProjectBids", { projectId: F.malformed.projectId }),
  };
  const executedAfter = mAfter.agreements.find((a) => a.status === "executed");
  const oldAgreementStill = mAfter.agreements.find((a) => a._id === executedBefore?._id);
  const oldBidStill = mAfter.bids.find((b) => b._id === awardedBidBefore?._id);
  const newAgreement = mAfter.agreements[0];
  rec("A10-I05 runFullProcurementCycle on package with executed subcontract", "inspect", cycle,
    `oldAgreementGone=${!oldAgreementStill} oldBidGone=${!oldBidStill} executedAgreementsNow=${mAfter.agreements.filter((a) => a.status === "executed").length} newAgreementStatus=${newAgreement?.status} newDocumentTitle="${newAgreement?.documentTitle}"`,
    true);
  writeEvidence("immutability-after-cycle", {
    cycleResult: cycle.ok ? cycle.value : { error: cycle.data ?? cycle.message },
    oldExecutedAgreementDestroyed: !oldAgreementStill,
    oldAwardedBidDestroyed: !oldBidStill,
    agreementsNow: mAfter.agreements.map((a) => ({ id: a._id, status: a.status, number: a.agreementNumber, documentTitle: a.documentTitle })),
    bidsNow: mAfter.bids.map((b) => ({ id: b._id, isAwarded: b.isAwarded, leveledTotalCost: b.leveledTotalCost, subcontractorName: b.subcontractorName })),
  });

  // Document-title honesty delta between the two agreement writers
  const generatedViaApi = mBefore.agreements.find((a) => a.status === "executed");
  rec("A10-I06 document title claims licensed AIA A401 in simulation path", "inspect",
    { ok: true, value: { simulationTitle: newAgreement?.documentTitle, apiGeneratedTitle: generatedViaApi?.documentTitle } },
    "simulation inserts 'AIA Document A401™ – 2017 Standard Form...' while the public generator uses the honest draft disclaimer",
    true);

  // cycle return-claim check vs stored contract
  if (cycle.ok) {
    const claimed = cycle.value.winningLeveledCost;
    const storedNew = mAfter.agreements.find((a) => a.agreementNumber === cycle.value.agreementNumber);
    rec("A10-I07 cycle result claim matches stored agreement", "inspect",
      { ok: storedNew?.contractSum === claimed, value: { claimed, storedContractSum: storedNew?.contractSum } },
      null,
      storedNew?.contractSum === claimed);
  }

  writeEvidence("immutability", { generatedAt: new Date().toISOString(), rows, log });
  writeLog("immutability", log);
  console.log(`\nTOTAL ${rows.length} probes, ${rows.filter((r) => !r.ok).length} flagged`);
}

main().catch((e) => { console.error(e); process.exit(1); });