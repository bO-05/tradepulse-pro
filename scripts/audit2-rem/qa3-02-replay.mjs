import { ConvexHttpClient } from "convex/browser";
import { writeJson, writeLog } from "./lib.mjs";

const c = new ConvexHttpClient(process.env.REM_CONVEX_URL || "https://brainy-skunk-440.convex.cloud");
const FIX = "AUDIT-QA3-validation-2026-09-18";
const TMP = "AUDIT-QA3-tmpdel2-2026-09-18";
const results = [];
const rec = (id, label, outcome, detail) => {
  results.push({ id, label, outcome, detail });
  console.log(`${outcome.padEnd(13)} ${id} ${label} :: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
};
async function call(fn, args, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return { threw: false, value: await c.mutation(fn, args) }; }
    catch (e) {
      last = e;
      if (!String(e && e.message).includes("fetch failed")) break;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  return { threw: true, data: last && last.data !== undefined ? last.data : null, message: last && last.message ? last.message : String(last) };
}
async function query(fn, args) {
  try { return { threw: false, value: await c.query(fn, args) }; }
  catch (e) { return { threw: true, data: e && e.data !== undefined ? e.data : null, message: e && e.message ? e.message : String(e) }; }
}
const errText = (r) => (r.data && typeof r.data === "string" ? r.data : r.data ? JSON.stringify(r.data) : r.message);

const run = async () => {
  const out = { startedAt: new Date().toISOString(), results };
  const proj = await call("projects:createProject", {
    title: FIX, location: "Austin, TX", projectType: "Class-A Commercial", estBudget: 500000,
    targetCompletionWeeks: 40, specDocumentText: "QA3 replay spec", isDemoProject: false,
  });
  if (proj.threw) throw new Error("fixture: " + errText(proj));
  const fixId = proj.value;
  out.fixtureId = fixId;

  const cp = (over) => call("projects:createProject", {
    title: "AUDIT-QA3-y-2026-09-18", location: "Dallas, TX", projectType: "Class-A", estBudget: 100000,
    targetCompletionWeeks: 52, specDocumentText: "s", isDemoProject: false, ...over,
  });
  let r = await cp({ title: "   " });
  rec("R1", "createProject whitespace title rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : r.value);
  r = await cp({ title: "T".repeat(501) });
  rec("R2", "createProject 501-char title rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : r.value);
  r = await cp({ estBudget: 0 });
  rec("R3", "createProject budget 0 rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : r.value);
  r = await cp({ targetCompletionWeeks: 5.5 });
  rec("R4", "createProject decimal weeks rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : r.value);
  r = await cp({ title: "AUDIT-QA3-rtl2-2026-09-18 مشروع برج", estBudget: 99999.99 });
  if (!r.threw) rec("R5", "unicode/RTL + decimal budget accepted", "PASS", { id: r.value });
  else rec("R5", "unicode/RTL accepted", "FAIL", errText(r));
  if (!r.threw) await call("projects:deleteProject", { projectId: r.value });

  const basePkg = (over) => call("tradePackages:createTradePackage", {
    projectId: fixId, csiDivision: "26 00 00", tradeName: "QA3 Replay Electrical", budgetEstimate: 500000,
    scopeSummary: "replay scope", mandatoryInclusions: ["crane"], bidDeadline: "2027-01-15", ...over,
  });
  r = await basePkg({});
  const pkgId = r.threw ? null : r.value;
  rec("R6", "createTradePackage valid accepted", pkgId ? "PASS" : "FAIL", pkgId || errText(r));
  r = await basePkg({ csiDivision: "26 0 0" });
  rec("R7", "CSI bad format rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : r.value);
  r = await basePkg({ budgetEstimate: -1 });
  rec("R8", "negative budget rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : r.value);
  r = await basePkg({ bidDeadline: "2020-01-01" });
  rec("R9", "past deadline rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : r.value);
  r = await basePkg({ csiDivision: "26 00 00" });
  rec("R10", "duplicate CSI rejected (plain Server Error)", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : r.value);
  rec("R10b", "duplicate attempt did not add a package", (await query("tradePackages:listByProject", { projectId: fixId })).value.filter((p) => p.csiDivision === "26 00 00").length === 1 ? "PASS" : "FAIL", "count=1");

  // R11: deleted project id -> orphan package?
  const tmp = await cp({ title: TMP });
  if (!tmp.threw) {
    await call("projects:deleteProject", { projectId: tmp.value });
    r = await basePkg({ projectId: tmp.value, csiDivision: "28 00 00", tradeName: "QA3 Replay Orphan" });
    if (r.threw) rec("R11", "createTradePackage with deleted project id rejected", "PASS", errText(r));
    else {
      rec("R11", "createTradePackage with deleted project id rejected", "FAIL", { orphanPackageId: r.value, observed: "package inserted with dangling projectId", expected: "rejection: Project not found" });
      const del = await call("tradePackages:deleteTradePackage", { tradePackageId: r.value });
      rec("R11c", "orphan package cleanup", del.threw ? "FAIL" : "PASS", del.threw ? errText(del) : del.value);
    }
  } else rec("R11", "temp project setup", "FAIL", errText(tmp));

  const baseCon = (over) => call("contractors:createContractor", {
    tradePackageId: pkgId, companyName: "QA3 Replay Electric LLC", contactEmail: "replay@tradepulse-pro.test",
    licenseNumber: "TX-QA3-R", licenseStatus: "Active / Verified", sourceUrl: "https://tradepulse-pro.test/qa3", rfqStatus: "discovered", ...over,
  });
  r = await baseCon({ contactEmail: "bad-email" });
  rec("R12", "invalid email rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : r.value);
  r = await baseCon({ licenseNumber: "L".repeat(2000), companyName: "QA3 Replay LongLicense" });
  rec("R13", "2000-char licenseNumber accepted (unbounded field)", r.threw ? "NOTE-REJECT" : "NOTE-ACCEPTED", r.threw ? errText(r) : { contractorId: r.value });
  if (!r.threw) await call("contractors:deleteContractor", { contractorId: r.value });
  r = await baseCon({});
  const conId = r.threw ? null : r.value;
  rec("R14", "valid contractor accepted", conId ? "PASS" : "FAIL", conId || errText(r));

  const baseBid = (over) => call("bids:submitDirectBid", {
    tradePackageId: pkgId, contractorId: conId, subcontractorName: "QA3 Replay Electric LLC",
    baseBidAmount: 480000, longLeadEquipmentWeeks: 10, coiComplianceStatus: "compliant", ...over,
  });
  r = await baseBid({ baseBidAmount: 0 });
  rec("R15", "bid amount 0 rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : r.value);
  r = await baseBid({ baseBidAmount: 500 });
  rec("R16", "bid below $1,000 floor rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : r.value);
  r = await baseBid({ baseBidAmount: 3000000 });
  rec("R17", "bid 6x budget accepted (ceiling is max(5x, $5M))", r.threw ? "NOTE-REJECT" : "FAIL", r.threw ? errText(r) : { observed: "accepted", baseBidAmount: r.value.baseBidAmount, packageBudget: 500000, advertisedRule: "more than 5x package budget rejected" });
  r = await baseBid({ baseBidAmount: 480000, identifiedExclusions: [{ description: "firestop", costImpact: 20000, severity: "critical", isWaived: false }], leadTimePenalty: 12000, coiPenalty: 15000, valueEngineeringAlternates: [{ description: "VE", costDeduct: 5000, isAccepted: true }] });
  const bidId = r.threw ? null : r.value.bidId;
  rec("R18", "valid bid accepted + leveled formula", !r.threw && r.value.leveledTotalCost === 522000 ? "PASS" : "FAIL", r.threw ? errText(r) : { leveledTotalCost: r.value.leveledTotalCost, expected: 522000 });
  const r2 = await baseBid({ baseBidAmount: 481000 });
  const bidsNow = (await query("bids:listByPackage", { tradePackageId: pkgId })).value;
  rec("R19", "double submit upserts (no duplicate)", bidsNow.length === 1 ? "PASS" : "FAIL", { count: bidsNow.length, revision: bidsNow[0]?.revisionNumber });

  r = await call("bids:updateBidLeveling", { bidId, baseBidAmount: 0 });
  rec("R20", "updateBidLeveling base 0 rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : r.value);
  r = await call("bids:updateBidAdjustments", { bidId, identifiedExclusions: [{ description: "neg", costImpact: -100000, severity: "minor" }] });
  rec("R21", "negative exclusion accepted as credit (unvalidated)", r.threw ? "NOTE-REJECT" : "NOTE-ACCEPTED", r.threw ? errText(r) : r.value);

  const baseRfi = (over) => call("simulation:submitCustomRfi", { tradePackageId: pkgId, contractorId: conId, subject: "QA3 replay", question: "QA3 replay question about lead time?", ...over });
  r = await baseRfi({ question: "   " });
  rec("R22", "whitespace RFI question rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : r.value);
  r = await baseRfi({ question: "Q".repeat(4001) });
  rec("R23", "4001-char question rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : r.value);
  r = await baseRfi({ subject: "S".repeat(201) });
  rec("R24", "201-char subject rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : r.value);
  r = await baseRfi({ contractorId: "k179zp8p8ewsfznzcjzg41wq9x8em427" });
  rec("R25", "foreign contractor rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : r.value);
  r = await baseRfi({ question: "RTL سؤال: ما هي مدة التسليم؟ <b>x</b>" });
  rec("R26", "unicode/RTL/HTML RFI accepted + persisted", !r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : r.value);
  out.finalConversations = (await query("rfq:listConversations", { tradePackageId: pkgId })).value.map((x) => ({ id: x._id, status: x.status, q: x.inboundQuestion }));

  // cleanup fixture
  const del = await call("projects:deleteProject", { projectId: fixId });
  rec("R27", "fixture cleanup", del.threw ? "FAIL" : "PASS", del.threw ? errText(del) : del.value);
  const after = (await query("projects:listProjects", {})).value;
  rec("R28", "no AUDIT-QA3 project remains", after.every((p) => !p.title.startsWith("AUDIT-QA3")) ? "PASS" : "FAIL", after.map((p) => p.title));

  writeJson("fix4-qa3-02-replay.json", out);
  writeLog("fix4-qa3-02-replay.log", results.map((x) => `${x.outcome} ${x.id} ${x.label} :: ${typeof x.detail === "string" ? x.detail : JSON.stringify(x.detail)}`));
  console.log("\nDONE fails=" + results.filter((x) => x.outcome === "FAIL").length);
};
run().catch((e) => { console.error("ERR", e && e.stack ? e.stack : e); process.exit(1); });