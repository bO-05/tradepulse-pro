import { client, readEvidence, writeEvidence, writeLog, corruptId } from "./qa10-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const rows = [];
const say = (s) => { log.push(s); console.log(s); };

async function counts(projectId) {
  const [packages, files, agreements] = await Promise.all([
    c.query("tradePackages:listByProject", { projectId }),
    c.query("files:listFilesByProject", { projectId }),
    c.query("agreements:listAgreements", { projectId }),
  ]);
  const contractors = await c.query("contractors:listByProject", { projectId });
  const bids = await c.query("bids:listAllProjectBids", { projectId });
  let conversations = [];
  for (const pkg of packages || []) {
    conversations = conversations.concat(await c.query("rfq:listConversations", { tradePackageId: pkg._id }) || []);
  }
  return {
    packages: packages.length, files: files.length, agreements: agreements.length,
    contractors: contractors.length, bids: bids.length, conversations: conversations.length,
  };
}

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

async function matrix(id, label, fn, expected = "reject") {
  const beforeB = await counts(F.bravo.projectId);
  const beforeM = await counts(F.malformed.projectId);
  const beforeA = await counts(F.alpha.projectId);
  let outcome;
  try { outcome = { ok: true, value: await fn() }; } catch (e) { outcome = { ok: false, err: (e?.data ?? e?.message ?? String(e)).toString().split("\n")[0].slice(0, 130) }; }
  const afterB = await counts(F.bravo.projectId);
  const afterM = await counts(F.malformed.projectId);
  const afterA = await counts(F.alpha.projectId);
  const wrote = !same(beforeB, afterB) || !same(beforeM, afterM) || !same(beforeA, afterA);
  const rejected = !outcome.ok;
  const ok = expected === "reject" ? rejected && !wrote : true;
  rows.push({ id, label, expected, observed: outcome.ok ? `ACCEPTED ${JSON.stringify(outcome.value).slice(0, 120)}` : `REJECTED ${outcome.err}`, wrote, ok });
  say(`${ok ? "ok " : "FLAG"} ${id} ${label} | ${outcome.ok ? "accepted" : "rejected"} | wrote=${wrote} | ${outcome.ok ? JSON.stringify(outcome.value).slice(0, 80) : outcome.err}`);
  return outcome;
}

async function main() {
  const A = F.alpha, B = F.bravo, M = F.malformed;
  const corruptProj = corruptId(A.projectId, 12);
  const corruptPkg = corruptId(A.elecPackageId, 12);
  const corruptBid = corruptId(B.bid, 12);
  const corruptCtr = corruptId(B.contractor, 12);

  say("=== CROSS-PROJECT MATRIX (A=ALPHA parent, B=BRAVO child) ===");
  await matrix("A10-M01", "awardContract(bidB, pkgA)", () => c.mutation("bids:awardContract", { bidId: B.bid, tradePackageId: A.elecPackageId }));
  await matrix("A10-M02", "unawardContract(bidB, pkgA)", () => c.mutation("bids:unawardContract", { bidId: B.bid, tradePackageId: A.elecPackageId }));
  await matrix("A10-M03", "generateAgreement(bidB, pkgA)", () => c.mutation("agreements:generateAgreement", { bidId: B.bid, tradePackageId: A.elecPackageId }));
  await matrix("A10-M04", "submitDirectBid(pkgA, ctrB)", () => c.mutation("bids:submitDirectBid", { tradePackageId: A.elecPackageId, contractorId: B.contractor, subcontractorName: "x", baseBidAmount: 500000 }));
  await matrix("A10-M05", "submitDirectBid(pkgB, ctrA)", () => c.mutation("bids:submitDirectBid", { tradePackageId: B.elecPackageId, contractorId: A.contractorA, subcontractorName: "x", baseBidAmount: 500000 }));
  await matrix("A10-M06", "saveFileRecord(projA, pkgB)", () => c.mutation("files:saveFileRecord", { projectId: A.projectId, tradePackageId: B.elecPackageId, storageId: "quote_qa10m06", fileName: "m06.pdf", fileType: "quote_pdf", fileSize: 1000, uploadedBy: "QA10" }));
  await matrix("A10-M07", "deductDoubleBuyCredit(projA, pkgB)", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: A.projectId, clashId: "clash-vfd-01", tradePackageId: B.elecPackageId, deductAmount: 1000, description: "QA10 m07" }));
  await matrix("A10-M08", "assignScopeVoid(projA, pkgB)", () => c.mutation("coordination:assignScopeVoidToTrade", { projectId: A.projectId, voidId: "void-bas-wiring-01", tradePackageId: B.elecPackageId, additionalCost: 1000, description: "QA10 m08" }));
  await matrix("A10-M09", "runFullProcurementCycle(projA, pkgB)", () => c.mutation("simulation:runFullProcurementCycle", { projectId: A.projectId, tradePackageId: B.elecPackageId }));
  await matrix("A10-M10", "extractBidFromQuoteFile(projA, pkgB)", () => c.action("files:extractBidFromQuoteFile", { projectId: A.projectId, tradePackageId: B.elecPackageId, quoteText: "Base Bid Price: $500,000 QA10 cross" }));
  await matrix("A10-M11", "generatePreBidAddendum(projA, pkgB)", () => c.action("files:generatePreBidAddendum", { projectId: A.projectId, tradePackageId: B.elecPackageId }));
  await matrix("A10-M12", "submitCustomRfi(pkgA, ctrB)", () => c.mutation("simulation:submitCustomRfi", { tradePackageId: A.elecPackageId, contractorId: B.contractor, subject: "QA10", question: "cross?" }));
  await matrix("A10-M13", "createContractor(pkgB, mCtr in A?) n/a - create in B allowed", () => c.mutation("contractors:createContractor", { tradePackageId: B.elecPackageId, companyName: "AUDIT-QA10 Matrix Allowed", contactEmail: "matrix.allowed@qa10.invalid", licenseNumber: "L", licenseStatus: "S", sourceUrl: "u", rfqStatus: "discovered" }), "accept");
  await matrix("A10-M14", "createContractor(valid-format nonexistent pkg)", () => c.mutation("contractors:createContractor", { tradePackageId: corruptPkg, companyName: "x", contactEmail: "x@y.zz", licenseNumber: "L", licenseStatus: "S", sourceUrl: "u", rfqStatus: "discovered" }));
  await matrix("A10-M15", "createTradePackage(A.project, CSI dup in B) allowed", () => c.mutation("tradePackages:createTradePackage", { projectId: A.projectId, csiDivision: "33 00 00", tradeName: "AUDIT-QA10 Matrix Utilities", budgetEstimate: 100000, scopeSummary: "QA10 matrix", mandatoryInclusions: ["x"], bidDeadline: "2026-12-31" }), "accept");
  await matrix("A10-M16", "deduct(projB, pkgB, bidA)", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: B.projectId, clashId: "clash-vfd-01", tradePackageId: B.elecPackageId, deductAmount: 1000, description: "QA10 m16", bidId: A.bidB }));
  await matrix("A10-M17", "assign(projB, pkgB, bidA)", () => c.mutation("coordination:assignScopeVoidToTrade", { projectId: B.projectId, voidId: "void-bas-wiring-01", tradePackageId: B.elecPackageId, additionalCost: 1000, description: "QA10 m17", bidId: A.bidB }));
  await matrix("A10-M18", "awardContract(bidA, pkgB)", () => c.mutation("bids:awardContract", { bidId: A.bidA, tradePackageId: B.elecPackageId }));
  await matrix("A10-M19", "generateAgreement(bidA, pkgB)", () => c.mutation("agreements:generateAgreement", { bidId: A.bidA, tradePackageId: B.elecPackageId }));
  await matrix("A10-M20", "runFullProcurementCycle(projB, pkgA)", () => c.mutation("simulation:runFullProcurementCycle", { projectId: B.projectId, tradePackageId: A.elecPackageId }));
  await matrix("A10-M21", "executeAgreement(M.agreement) via public - allowed? own fixture", () => c.mutation("agreements:executeAgreement", { agreementId: M.agreement }), "accept");
  await matrix("A10-M22", "awardContract(nonexistent bid in own pkg)", () => c.mutation("bids:awardContract", { bidId: corruptBid, tradePackageId: B.elecPackageId }));
  await matrix("A10-M23", "deduct with bidId from nonexistent", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: A.projectId, clashId: "x", tradePackageId: A.elecPackageId, deductAmount: 1000, description: "QA10 m23", bidId: corruptBid }));
  await matrix("A10-M24", "contractor update with foreign contractor id", () => c.mutation("contractors:updateContractor", { contractorId: corruptCtr, companyName: "x", contactEmail: "x@y.zz", licenseNumber: "L", licenseStatus: "S", sourceUrl: "u" }));

  // ---------------- RACES ----------------
  say("=== RACES ===");
  const raceA = await Promise.allSettled([
    c.raw.mutation("agreements:generateAgreement", { bidId: B.bid, tradePackageId: B.elecPackageId }),
    c.raw.mutation("agreements:generateAgreement", { bidId: B.bid, tradePackageId: B.elecPackageId }),
  ]);
  const bravoAgreements = await c.query("agreements:listAgreements", { projectId: B.projectId });
  rows.push({ id: "A10-M25", label: "concurrent generateAgreement same bid", expected: "exactly 1 agreement row", observed: `${bravoAgreements.length} rows; outcomes=${raceA.map((r) => r.status).join(",")}`, wrote: true, ok: bravoAgreements.length === 1 && raceA.every((r) => r.status === "fulfilled") });
  say(`${rows[rows.length - 1].ok ? "ok " : "FLAG"} A10-M25 concurrent generateAgreement -> ${bravoAgreements.length} agreement rows`);

  const bravoAgreementId = bravoAgreements[0]._id;
  const raceB = await Promise.allSettled([
    c.raw.mutation("agreements:executeAgreement", { agreementId: bravoAgreementId }),
    c.raw.mutation("bids:updateBidLeveling", { bidId: B.bid, baseBidAmount: 760000 }),
  ]);
  const agAfter = (await c.query("agreements:listAgreements", { projectId: B.projectId })).find((x) => x._id === bravoAgreementId);
  const bidAfter = (await c.query("bids:listByPackage", { tradePackageId: B.elecPackageId })).find((x) => x._id === B.bid);
  const consistent = agAfter.status !== "executed" || agAfter.contractSum === bidAfter.leveledTotalCost;
  rows.push({
    id: "A10-M26", label: "race executeAgreement vs updateBidLeveling",
    expected: "no executed agreement with stale contract sum",
    observed: `outcomes=${raceB.map((r) => (r.status === "fulfilled" ? "ok" : (r.reason?.data ?? r.reason?.message ?? "").toString().slice(0, 60))).join(" | ")}; agreement=${agAfter.status} sum=${agAfter.contractSum} bidLeveled=${bidAfter.leveledTotalCost}`,
    wrote: true, ok: consistent,
  });
  say(`${rows[rows.length - 1].ok ? "ok " : "FLAG"} A10-M26 race execute/update -> ${rows[rows.length - 1].observed}`);

  const raceC = await Promise.allSettled([
    c.raw.mutation("bids:unawardContract", { bidId: B.bid, tradePackageId: B.elecPackageId }),
    c.raw.mutation("bids:deleteBid", { bidId: B.bid }),
  ]);
  const bidStill = (await c.query("bids:listByPackage", { tradePackageId: B.elecPackageId })).find((x) => x._id === B.bid);
  const agStill = (await c.query("agreements:listAgreements", { projectId: B.projectId })).find((x) => x._id === bravoAgreementId);
  rows.push({
    id: "A10-M27", label: "race unaward vs deleteBid on executed contract",
    expected: "bid + executed agreement survive",
    observed: `outcomes=${raceC.map((r) => r.status === "fulfilled" ? "ok" : "rejected").join(",")}; bidExists=${!!bidStill}; agreement=${agStill ? agStill.status : "MISSING"}`,
    wrote: true, ok: !!bidStill && !!agStill && agStill.status === "executed",
  });
  say(`${rows[rows.length - 1].ok ? "ok " : "FLAG"} A10-M27 race unaward/deleteBid executed -> ${rows[rows.length - 1].observed}`);

  // race delete package vs bid submit on a throwaway package
  const throwPkgId = await c.mutation("tradePackages:createTradePackage", { projectId: A.projectId, csiDivision: "34 00 00", tradeName: "AUDIT-QA10 Race Package", budgetEstimate: 100000, scopeSummary: "QA10 race", mandatoryInclusions: ["x"], bidDeadline: "2026-12-31" });
  const throwCtrId = await c.mutation("contractors:createContractor", { tradePackageId: throwPkgId, companyName: "AUDIT-QA10 Race Bidder", contactEmail: "race.bidder@qa10.invalid", licenseNumber: "L", licenseStatus: "S", sourceUrl: "u", rfqStatus: "invited" });
  const raceD = await Promise.allSettled([
    c.raw.mutation("tradePackages:deleteTradePackage", { tradePackageId: throwPkgId }),
    c.raw.mutation("bids:submitDirectBid", { tradePackageId: throwPkgId, contractorId: throwCtrId, subcontractorName: "AUDIT-QA10 Race Bidder", baseBidAmount: 200000 }),
  ]);
  const pkgGone = !(await c.query("tradePackages:getPackage", { tradePackageId: throwPkgId }));
  const orphanBids = (await c.query("bids:listAllProjectBids", { projectId: A.projectId })).filter((b) => b.tradePackageId === throwPkgId);
  const orphanCtrs = (await c.query("contractors:listByProject", { projectId: A.projectId })).filter((x) => x.tradePackageId === throwPkgId);
  const noOrphans = orphanBids.length === 0 && orphanCtrs.length === 0;
  rows.push({
    id: "A10-M28", label: "race deleteTradePackage vs submitDirectBid",
    expected: "no orphan bid/contractor rows",
    observed: `outcomes=${raceD.map((r) => (r.status === "fulfilled" ? "ok" : "rejected")).join(",")}; pkgGone=${pkgGone}; orphanBids=${orphanBids.length}; orphanCtrs=${orphanCtrs.length}`,
    wrote: true, ok: noOrphans,
  });
  say(`${rows[rows.length - 1].ok ? "ok " : "FLAG"} A10-M28 race package delete/bid submit -> ${rows[rows.length - 1].observed}`);

  // post-matrix walk: no cross-project parentage anywhere in our fixtures
  const integrity = [];
  for (const [name, f] of Object.entries({ alpha: A, bravo: B, malformed: M })) {
    const pkgs = await c.query("tradePackages:listByProject", { projectId: f.projectId });
    const pkgIds = new Set((pkgs || []).map((p) => p._id));
    const bids = await c.query("bids:listAllProjectBids", { projectId: f.projectId });
    const ctrs = await c.query("contractors:listByProject", { projectId: f.projectId });
    const ags = await c.query("agreements:listAgreements", { projectId: f.projectId });
    const badBids = bids.filter((b) => !pkgIds.has(b.tradePackageId));
    const badCtrs = ctrs.filter((x) => !pkgIds.has(x.tradePackageId));
    const badAgs = ags.filter((a) => !pkgIds.has(a.tradePackageId));
    integrity.push({ fixture: name, packages: pkgs.length, bids: bids.length, contractors: ctrs.length, agreements: ags.length, orphanBids: badBids.length, orphanContractors: badCtrs.length, orphanAgreements: badAgs.length });
  }
  writeEvidence("isolation-races", { generatedAt: new Date().toISOString(), rows, integrity, log });
  writeLog("isolation-races", log);
  console.log(`\nTOTAL ${rows.length} matrix/race probes, ${rows.filter((r) => !r.ok).length} flagged`);
}

main().catch((e) => { console.error(e); process.exit(1); });