import { ConvexHttpClient } from "convex/browser";
import { writeJson, writeLog } from "./lib.mjs";

const c = new ConvexHttpClient(process.env.REM_CONVEX_URL || "https://brainy-skunk-440.convex.cloud");
const FIX_A = "AUDIT-QA3-fixture-2026-09-18";
const FIX_B = "AUDIT-QA3-isolation-2026-09-18";
const results = [];
const rec = (id, label, outcome, detail) => {
  results.push({ id, label, outcome, detail });
  console.log(`${outcome.padEnd(13)} ${id} ${label} :: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
};
async function call(fn, args) {
  try { return { threw: false, value: await c.mutation(fn, args) }; }
  catch (e) { return { threw: true, data: e && e.data !== undefined ? e.data : null, message: e && e.message ? e.message : String(e) }; }
}
async function query(fn, args) {
  try { return { threw: false, value: await c.query(fn, args) }; }
  catch (e) { return { threw: true, data: e && e.data !== undefined ? e.data : null, message: e && e.message ? e.message : String(e) }; }
}
const errText = (r) => (r.data && typeof r.data === "string" ? r.data : r.data ? JSON.stringify(r.data) : r.message);

const run = async () => {
  const out = { startedAt: new Date().toISOString(), results };
  const projects0 = (await query("projects:listProjects", {})).value;
  let fixA = projects0.find((p) => p.title === FIX_A);
  let fixB = projects0.find((p) => p.title === FIX_B);
  if (!fixA) throw new Error("fixture A missing");
  if (!fixB) {
    const r = await call("projects:createProject", {
      title: FIX_B, location: "Austin, TX", projectType: "Class-A Commercial", estBudget: 800000,
      targetCompletionWeeks: 40, specDocumentText: "QA3 isolation fixture", isDemoProject: false,
    });
    if (r.threw) throw new Error("fixture B create failed: " + errText(r));
    fixB = { _id: r.value };
  }
  out.fixtures = { A: fixA._id, B: fixB._id };

  const pkgA = (await query("tradePackages:listByProject", { projectId: fixA._id })).value.find((p) => p.csiDivision === "26 00 00");
  const conA = (await query("contractors:listByProject", { projectId: fixA._id })).value.find((x) => x.companyName === "QA3 Valid Electric LLC");
  const bidA = (await query("bids:listAllProjectBids", { projectId: fixA._id })).value[0];
  out.idsA = { pkgA: pkgA?._id, conA: conA?._id, bidA: bidA?._id };

  // ---- Fixture B setup: package + contractor + bid (if missing)
  let pkgB = (await query("tradePackages:listByProject", { projectId: fixB._id })).value.find((p) => p.csiDivision === "23 00 00");
  if (!pkgB) {
    const r = await call("tradePackages:createTradePackage", {
      projectId: fixB._id, csiDivision: "23 00 00", tradeName: "QA3 Isolation HVAC", budgetEstimate: 400000,
      scopeSummary: "QA3 isolation scope", mandatoryInclusions: ["seismic"], bidDeadline: "2027-03-01",
    });
    if (r.threw) throw new Error("pkgB: " + errText(r));
    pkgB = { _id: r.value, csiDivision: "23 00 00" };
  }
  let conB = (await query("contractors:listByProject", { projectId: fixB._id })).value.find((x) => x.companyName === "QA3 Isolation Mechanical");
  if (!conB) {
    const r = await call("contractors:createContractor", {
      tradePackageId: pkgB._id, companyName: "QA3 Isolation Mechanical", contactEmail: "iso@tradepulse-pro.test",
      licenseNumber: "TX-ISO-1", licenseStatus: "Active / Verified", sourceUrl: "https://tradepulse-pro.test/iso", rfqStatus: "invited",
    });
    if (r.threw) throw new Error("conB: " + errText(r));
    conB = { _id: r.value, companyName: "QA3 Isolation Mechanical" };
  }
  let bidB = (await query("bids:listAllProjectBids", { projectId: fixB._id })).value[0];
  if (!bidB) {
    const r = await call("bids:submitDirectBid", {
      tradePackageId: pkgB._id, contractorId: conB._id, subcontractorName: conB.companyName,
      baseBidAmount: 355000, longLeadEquipmentWeeks: 10, coiComplianceStatus: "compliant",
    });
    if (r.threw) throw new Error("bidB: " + errText(r));
    bidB = { _id: r.value.bidId };
  }
  out.idsB = { pkgB: pkgB._id, conB: conB._id, bidB: bidB._id };

  // ================= 1. Concurrent submitDirectBid (fixture A) =================
  const concBid = await Promise.all([
    call("bids:submitDirectBid", { tradePackageId: pkgA._id, contractorId: conA._id, subcontractorName: "QA3 Race A", baseBidAmount: 490000, longLeadEquipmentWeeks: 10, coiComplianceStatus: "compliant" }),
    call("bids:submitDirectBid", { tradePackageId: pkgA._id, contractorId: conA._id, subcontractorName: "QA3 Race B", baseBidAmount: 495000, longLeadEquipmentWeeks: 10, coiComplianceStatus: "compliant" }),
  ]);
  const bidsAfterRace = (await query("bids:listByPackage", { tradePackageId: pkgA._id })).value;
  rec("C1", "concurrent submitDirectBid x2 -> single bid, no duplicates", bidsAfterRace.length === 1 ? "PASS" : "FAIL", {
    results: concBid.map((x) => (x.threw ? errText(x) : x.value)),
    bidCount: bidsAfterRace.length, final: bidsAfterRace.map((b) => ({ name: b.subcontractorName, base: b.baseBidAmount, rev: b.revisionNumber })),
  });

  // ================= 2. Concurrent createTradePackage same CSI =================
  const csiRace = "24 00 00";
  const pkgRace = await Promise.all([
    call("tradePackages:createTradePackage", { projectId: fixA._id, csiDivision: csiRace, tradeName: "QA3 Race Pkg 1", budgetEstimate: 100000, scopeSummary: "race1", mandatoryInclusions: [], bidDeadline: "2027-04-01" }),
    call("tradePackages:createTradePackage", { projectId: fixA._id, csiDivision: csiRace, tradeName: "QA3 Race Pkg 2", budgetEstimate: 100000, scopeSummary: "race2", mandatoryInclusions: [], bidDeadline: "2027-04-01" }),
  ]);
  const raceCount = (await query("tradePackages:listByProject", { projectId: fixA._id })).value.filter((p) => p.csiDivision === csiRace).length;
  const raceSucceeded = pkgRace.filter((x) => !x.threw).length;
  rec("C2", "concurrent createTradePackage same CSI -> exactly one package", raceCount === 1 && raceSucceeded === 1 ? "PASS" : "FAIL", { raceCount, raceSucceeded, outcomes: pkgRace.map((x) => (x.threw ? errText(x) : x.value)) });
  const racePkgId = pkgRace.find((x) => !x.threw)?.value;
  if (racePkgId) out.keepRacePkg = racePkgId;

  // ================= 3. Concurrent dispatchRfqs =================
  const d1 = await Promise.all([call("rfq:dispatchRfqs", { tradePackageId: pkgA._id }), call("rfq:dispatchRfqs", { tradePackageId: pkgA._id })]);
  const consA = (await query("contractors:listByProject", { projectId: fixA._id })).value.filter((x) => x.tradePackageId === pkgA._id);
  rec("C3", "concurrent dispatchRfqs x2 -> consistent invited state", consA.every((x) => x.rfqStatus === "invited" || x.rfqStatus === "bid_received") ? "PASS" : "FAIL", { outcomes: d1.map((x) => (x.threw ? errText(x) : x.value)), contractors: consA.map((x) => ({ n: x.companyName, s: x.rfqStatus })) });

  // ================= 4. Agreement generation + concurrent award =================
  const gen = await call("agreements:generateAgreement", { bidId: bidA._id, tradePackageId: pkgA._id });
  if (!gen.threw) {
    const agreementId = gen.value._id;
    const exec = await call("agreements:executeAgreement", { agreementId });
    const awardRace = await Promise.all([
      call("bids:awardContract", { bidId: bidA._id, tradePackageId: pkgA._id }),
      call("bids:awardContract", { bidId: bidA._id, tradePackageId: pkgA._id }),
    ]);
    const ags = (await query("agreements:listAgreements", { projectId: fixA._id })).value;
    const bidsNow = (await query("bids:listByPackage", { tradePackageId: pkgA._id })).value;
    const awarded = bidsNow.filter((b) => b.isAwarded).length;
    const nonSuperseded = ags.filter((a) => a.status !== "superseded").length;
    rec("C4", "concurrent awardContract x2 -> one awarded bid, one active agreement", awarded === 1 && nonSuperseded === 1 ? "PASS" : "FAIL", { awardRace: awardRace.map((x) => (x.threw ? errText(x) : "ok")), awarded, nonSuperseded, agreements: ags.map((a) => ({ id: a._id, status: a.status, sum: a.contractSum, executedAt: a.executedAt || null })) });

    // 4b. generateAgreement same bid twice concurrently
    const genRace = await Promise.all([
      call("agreements:generateAgreement", { bidId: bidA._id, tradePackageId: pkgA._id }),
      call("agreements:generateAgreement", { bidId: bidA._id, tradePackageId: pkgA._id }),
    ]);
    const ags2 = (await query("agreements:listAgreements", { projectId: fixA._id })).value;
    rec("C4b", "concurrent generateAgreement same bid -> no duplicate agreement", ags2.length === 1 ? "PASS" : "FAIL", { count: ags2.length, outcomes: genRace.map((x) => (x.threw ? errText(x) : x.value?._id || x.value)) });
  } else rec("C4", "generateAgreement setup", "FAIL", errText(gen));

  // ================= 5. Concurrent submitCustomRfi guest dedupe =================
  const rfiRace = await Promise.all([
    call("simulation:submitCustomRfi", { tradePackageId: pkgB._id, subject: "QA3 guest A", question: "QA3 guest concurrency probe A: crane access?" }),
    call("simulation:submitCustomRfi", { tradePackageId: pkgB._id, subject: "QA3 guest B", question: "QA3 guest concurrency probe B: firestop scope?" }),
  ]);
  const guests = (await query("contractors:listByProject", { projectId: fixB._id })).value.filter((x) => x.companyName === "Guest / Inquiring Subcontractor");
  const convoCount = (await query("rfq:listConversations", { tradePackageId: pkgB._id })).value.length;
  rec("C5", "concurrent submitCustomRfi x2 -> 1 guest record, 2 RFIs", guests.length === 1 && convoCount === 2 ? "PASS" : "FAIL", { guests: guests.length, conversations: convoCount, outcomes: rfiRace.map((x) => (x.threw ? errText(x) : x.value.conversationId)) });

  // ================= 6. Cross-project isolation =================
  const iso = {};
  iso.bidConB_pkgA = await call("bids:submitDirectBid", { tradePackageId: pkgA._id, contractorId: conB._id, subcontractorName: "QA3 FOREIGN", baseBidAmount: 200000, longLeadEquipmentWeeks: 5, coiComplianceStatus: "compliant" });
  rec("I1", "bid: contractor B + package A rejected", iso.bidConB_pkgA.threw ? "PASS" : "FAIL", iso.bidConB_pkgA.threw ? errText(iso.bidConB_pkgA) : "ACCEPTED");
  iso.bidConA_pkgB = await call("bids:submitDirectBid", { tradePackageId: pkgB._id, contractorId: conA._id, subcontractorName: "QA3 FOREIGN", baseBidAmount: 200000, longLeadEquipmentWeeks: 5, coiComplianceStatus: "compliant" });
  rec("I2", "bid: contractor A + package B rejected", iso.bidConA_pkgB.threw ? "PASS" : "FAIL", iso.bidConA_pkgB.threw ? errText(iso.bidConA_pkgB) : "ACCEPTED");
  iso.rfiConB_pkgA = await call("simulation:submitCustomRfi", { tradePackageId: pkgA._id, contractorId: conB._id, subject: "QA3 iso", question: "Cross-project RFI probe question?" });
  rec("I3", "RFI: contractor B + package A rejected", iso.rfiConB_pkgA.threw ? "PASS" : "FAIL", iso.rfiConB_pkgA.threw ? errText(iso.rfiConB_pkgA) : "ACCEPTED");
  iso.agr_bidB_pkgA = await call("agreements:generateAgreement", { bidId: bidB._id, tradePackageId: pkgA._id });
  rec("I4", "agreement: bid B + package A rejected", iso.agr_bidB_pkgA.threw ? "PASS" : "FAIL", iso.agr_bidB_pkgA.threw ? errText(iso.agr_bidB_pkgA) : "ACCEPTED");
  iso.award_bidB_pkgA = await call("bids:awardContract", { bidId: bidB._id, tradePackageId: pkgA._id });
  rec("I5", "award: bid B + package A rejected", iso.award_bidB_pkgA.threw ? "PASS" : "FAIL", iso.award_bidB_pkgA.threw ? errText(iso.award_bidB_pkgA) : "ACCEPTED");
  iso.deduct_bidB_pkgA = await call("coordination:deductDoubleBuyCredit", { projectId: fixA._id, clashId: "qa3-iso", tradePackageId: pkgB._id, deductAmount: 100, description: "iso probe" });
  rec("I6", "coordination: package B + project A rejected", iso.deduct_bidB_pkgA.threw ? "PASS" : "FAIL", iso.deduct_bidB_pkgA.threw ? errText(iso.deduct_bidB_pkgA) : "ACCEPTED");
  iso.void_bidB_pkgA = await call("coordination:assignScopeVoidToTrade", { projectId: fixA._id, voidId: "qa3-void-iso", tradePackageId: pkgB._id, additionalCost: 100, description: "iso void probe" });
  rec("I7", "coordination: void package B + project A rejected", iso.void_bidB_pkgA.threw ? "PASS" : "FAIL", iso.void_bidB_pkgA.threw ? errText(iso.void_bidB_pkgA) : "ACCEPTED");
  iso.deduct_bid_mismatch = await call("coordination:deductDoubleBuyCredit", { projectId: fixB._id, clashId: "qa3-iso2", tradePackageId: pkgB._id, bidId: bidA._id, deductAmount: 100, description: "iso bid mismatch" });
  rec("I8", "coordination: foreign bidId + package B rejected", iso.deduct_bid_mismatch.threw ? "PASS" : "FAIL", iso.deduct_bid_mismatch.threw ? errText(iso.deduct_bid_mismatch) : "ACCEPTED");

  // ================= 7. Orphan lifecycle =================
  // 7a. deleteContractor deletes an EXECUTED agreement (immutability bypass)
  const genB = await call("agreements:generateAgreement", { bidId: bidB._id, tradePackageId: pkgB._id });
  if (!genB.threw) {
    const execB = await call("agreements:executeAgreement", { agreementId: genB.value._id });
    const delBidBlocked = await call("bids:deleteBid", { bidId: bidB._id });
    const delCon = await call("contractors:deleteContractor", { contractorId: conB._id });
    const agsAfter = (await query("agreements:listAgreements", { projectId: fixB._id })).value;
    const bidsAfter = (await query("bids:listByPackage", { tradePackageId: pkgB._id })).value;
    rec("O1", "deleteBid with executed agreement blocked (control)", delBidBlocked.threw ? "PASS" : "FAIL", delBidBlocked.threw ? errText(delBidBlocked) : "DELETED");
    rec("O2", "deleteContractor deletes executed agreement (bypass)", !delCon.threw && agsAfter.length === 0 ? "FINDING" : "PASS", {
      deleteResult: delCon.threw ? errText(delCon) : delCon.value,
      agreementsAfter: agsAfter.map((a) => ({ id: a._id, status: a.status, executedAt: a.executedAt })),
      bidsAfter: bidsAfter.length,
      note: delCon.threw ? "" : "executed contract record and its bid were deleted via deleteContractor",
    });
  } else rec("O1", "isolation agreement setup", "FAIL", errText(genB));

  // 7b. deleteTradePackage cascade completeness + orphan index check
  const pkgC = await call("tradePackages:createTradePackage", { projectId: fixB._id, csiDivision: "25 00 00", tradeName: "QA3 Cascade AV", budgetEstimate: 150000, scopeSummary: "cascade scope", mandatoryInclusions: ["x"], bidDeadline: "2027-05-01" });
  if (!pkgC.threw) {
    const conC = await call("contractors:createContractor", { tradePackageId: pkgC.value, companyName: "QA3 Cascade AV Co", contactEmail: "cascade@tradepulse-pro.test", licenseNumber: "TX-C", licenseStatus: "Active", sourceUrl: "s", rfqStatus: "discovered" });
    const bidC = await call("bids:submitDirectBid", { tradePackageId: pkgC.value, contractorId: conC.value, subcontractorName: "QA3 Cascade AV Co", baseBidAmount: 140000, longLeadEquipmentWeeks: 8, coiComplianceStatus: "compliant" });
    const genC = await call("agreements:generateAgreement", { bidId: bidC.value?.bidId, tradePackageId: pkgC.value });
    const fileUploadUrl = await call("files:generateUploadUrl", {});
    let fileC = null;
    if (!fileUploadUrl.threw) {
      const resp = await fetch(fileUploadUrl.value, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "cascade file" });
      const sid = (await resp.json()).storageId;
      fileC = await call("files:saveFileRecord", { projectId: fixB._id, tradePackageId: pkgC.value, storageId: sid, fileName: "cascade.txt", fileType: "spec", fileSize: 12, uploadedBy: "QA3", textContent: "cascade file" });
    }
    const delPkg = await call("tradePackages:deleteTradePackage", { tradePackageId: pkgC.value });
    const children = {
      contractors: (await query("contractors:listByPackage", { tradePackageId: pkgC.value })).value,
      bids: (await query("bids:listByPackage", { tradePackageId: pkgC.value })).value,
      files: (await query("files:listFilesByPackage", { tradePackageId: pkgC.value })).value,
    };
    const agsC = (await query("agreements:listAgreements", { projectId: fixB._id })).value.filter((a) => a.tradePackageId === pkgC.value);
    const pkgGone = (await query("tradePackages:getPackage", { tradePackageId: pkgC.value })).value === null;
    const contractorsLeft = children.contractors ? children.contractors.length : 0;
    rec("O3", "deleteTradePackage cascades children (no orphans by index)", delPkg.threw === false && pkgGone && children.bids.length === 0 && children.files.length === 0 && agsC.length === 0 && contractorsLeft === 0 ? "PASS" : "FAIL", { delPkg: delPkg.threw ? errText(delPkg) : delPkg.value, pkgGone, children: { contractors: contractorsLeft, bids: children.bids.length, files: children.files.length }, agreements: agsC.length, genC: genC.threw ? errText(genC) : "ok" });
  } else rec("O3", "cascade package setup", "FAIL", errText(pkgC));

  // 7c. deleteFile on non-existent + linked bid guard? just check deleteFile missing id
  const df = await call("files:deleteFile", { fileId: "js0000000000000000000000000000" });
  rec("O4", "deleteFile nonexistent id rejected (no crash)", df.threw ? "PASS" : "FAIL", df.threw ? errText(df) : df.value);

  out.finalA = {
    packages: (await query("tradePackages:listByProject", { projectId: fixA._id })).value.map((p) => ({ id: p._id, csi: p.csiDivision, status: p.status })),
    bids: (await query("bids:listAllProjectBids", { projectId: fixA._id })).value.map((b) => ({ id: b._id, base: b.baseBidAmount, leveled: b.leveledTotalCost, awarded: b.isAwarded })),
    agreements: (await query("agreements:listAgreements", { projectId: fixA._id })).value.map((a) => ({ id: a._id, status: a.status, exec: !!a.executedAt })),
  };
  writeJson("fix4-qa3-03-concurrency-isolation.json", out);
  writeLog("fix4-qa3-03-concurrency-isolation.log", results.map((x) => `${x.outcome} ${x.id} ${x.label} :: ${typeof x.detail === "string" ? x.detail : JSON.stringify(x.detail)}`));
  console.log("\nDONE", JSON.stringify(out.finalA));
};
run().catch((e) => { console.error("ERR", e && e.stack ? e.stack : e); process.exit(1); });