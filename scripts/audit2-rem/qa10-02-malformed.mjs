import { client, readEvidence, writeEvidence, writeLog, corruptId, call } from "./qa10-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const rows = [];
const say = (s) => { log.push(s); console.log(s); };

function record(id, expected, entry, note) {
  const observed = entry.ok
    ? `ACCEPTED ${typeof entry.value === "object" ? JSON.stringify(entry.value).slice(0, 160) : entry.value}`
    : `REJECTED: ${(entry.data ?? entry.message ?? "").toString().split("\n")[0].slice(0, 180)}`;
  const ok = expected === "reject" ? !entry.ok : expected === "accept" ? entry.ok : true;
  rows.push({ id, expected, observed, ok, note: note ?? null });
  say(`${ok ? "ok " : "FLAG"} ${id} | expected=${expected} | ${observed}`);
  return entry;
}

async function main() {
  const alphaPkg = F.alpha.elecPackageId;
  const malPkg = F.malformed.elecPackageId;
  const malProject = F.malformed.projectId;
  const malContractor = F.malformed.contractor;
  const malBid = F.malformed.bid;
  const alphaPkgCorrupt = corruptId(alphaPkg, 12);
  const alphaProjCorrupt = corruptId(F.alpha.projectId, 12);

  // ---------------- projects:createProject ----------------
  const mkProject = (over = {}) => ({
    title: "AUDIT-QA10-TMP-PROJECT-2026-09-19",
    location: "Austin, TX",
    projectType: "QA",
    estBudget: 100000,
    targetCompletionWeeks: 10,
    specDocumentText: "qa",
    isDemoProject: false,
    ...over,
  });
  record("A10-P01 createProject empty title", "reject", await call("empty title", () => c.mutation("projects:createProject", mkProject({ title: "   " }))));
  record("A10-P02 createProject 4000-char title", "reject", await call("long title", () => c.mutation("projects:createProject", mkProject({ title: "X".repeat(4000) }))));
  record("A10-P03 createProject budget 0", "reject", await call("budget 0", () => c.mutation("projects:createProject", mkProject({ estBudget: 0 }))));
  record("A10-P04 createProject budget -5", "reject", await call("budget -5", () => c.mutation("projects:createProject", mkProject({ estBudget: -5 }))));
  record("A10-P05 createProject budget 1e18", "reject", await call("budget 1e18", () => c.mutation("projects:createProject", mkProject({ estBudget: 1e18 }))));
  record("A10-P06 createProject weeks 1.5", "reject", await call("weeks 1.5", () => c.mutation("projects:createProject", mkProject({ targetCompletionWeeks: 1.5 }))));
  record("A10-P07 createProject weeks 521", "reject", await call("weeks 521", () => c.mutation("projects:createProject", mkProject({ targetCompletionWeeks: 521 }))));
  record("A10-P08 createProject isDemoProject 'false' string", "reject", await call("bool-as-string", () => c.mutation("projects:createProject", mkProject({ isDemoProject: "false" }))));
  record("A10-P09 createProject NaN budget (serialized null)", "reject", await call("NaN budget", () => c.mutation("projects:createProject", mkProject({ estBudget: NaN }))));
  record("A10-P10 createProject Infinity budget (serialized null)", "reject", await call("Inf budget", () => c.mutation("projects:createProject", mkProject({ estBudget: Infinity }))));

  const hostileTitle = `AUDIT-QA10-TMP-HOSTILE <script>alert(1)</script> "قوس" 😀 ${"L".repeat(300)}`;
  const hostile = await call("hostile title", () => c.mutation("projects:createProject", mkProject({ title: hostileTitle })));
  record("A10-P11 createProject HTML/RTL/emoji title (350 chars)", "inspect", hostile, hostile.ok ? `stored title bytes=${hostile.value}` : null);
  if (hostile.ok) {
    const p = await c.query("projects:getProject", { projectId: hostile.value });
    rows[rows.length - 1].note = `title round-trip=${p.title === hostileTitle ? "identical" : "MUTATED"}; scriptTagStored=${p.title.includes("<script>")}`;
    await c.mutation("projects:deleteProject", { projectId: hostile.value });
  }
  const dup1 = await call("dup1", () => c.mutation("projects:createProject", mkProject({ title: "AUDIT-QA10-TMP-DUP-2026-09-19" })));
  const dup2 = await call("dup2", () => c.mutation("projects:createProject", mkProject({ title: "AUDIT-QA10-TMP-DUP-2026-09-19" })));
  record("A10-P12 createProject duplicate title twice", "inspect", { ok: dup1.ok && dup2.ok, value: { first: dup1.value, second: dup2.value } }, "no uniqueness constraint; two rows expected");
  for (const r of [dup1, dup2]) if (r.ok) await c.mutation("projects:deleteProject", { projectId: r.value });

  const bigSpec = await call("spec 50k", () => c.mutation("projects:createProject", mkProject({ title: "AUDIT-QA10-TMP-BIGSPEC-2026-09-19", specDocumentText: "S".repeat(50000) })));
  record("A10-P13 createProject 50k-char specDocumentText", "inspect", bigSpec, bigSpec.ok ? "accepted; no documented cap on spec text" : null);
  if (bigSpec.ok) {
    const p = await c.query("projects:getProject", { projectId: bigSpec.value });
    rows[rows.length - 1].note = `stored spec length=${p.specDocumentText.length}`;
    await c.mutation("projects:deleteProject", { projectId: bigSpec.value });
  }

  // ---------------- projects:deleteProject ----------------
  record("A10-P14 deleteProject nonexistent valid-format", "reject", await call("delete bogus", () => c.mutation("projects:deleteProject", { projectId: alphaProjCorrupt })));
  // A10-P15 (demo delete guard) intentionally NOT probed here: the mission forbids touching the demo project.

  // ---------------- tradePackages ----------------
  const mkPkg = (over = {}) => ({
    projectId: malProject,
    csiDivision: "03 30 00",
    tradeName: "QA10 TMP Concrete",
    budgetEstimate: 100000,
    scopeSummary: "QA10 temporary package",
    mandatoryInclusions: ["QA10 inclusion"],
    bidDeadline: "2026-12-31",
    ...over,
  });
  record("A10-T01 createPackage empty tradeName", "reject", await call("empty name", () => c.mutation("tradePackages:createTradePackage", mkPkg({ csiDivision: "04 20 00", tradeName: "   " }))));
  record("A10-T02 createPackage bad CSI '26-00-00'", "reject", await call("bad csi", () => c.mutation("tradePackages:createTradePackage", mkPkg({ csiDivision: "26-00-00" }))));
  record("A10-T03 createPackage CSI division 99", "reject", await call("csi 99", () => c.mutation("tradePackages:createTradePackage", mkPkg({ csiDivision: "99 00 00" }))));
  record("A10-T04 createPackage budget -1", "reject", await call("budget -1", () => c.mutation("tradePackages:createTradePackage", mkPkg({ csiDivision: "05 00 00", budgetEstimate: -1 }))));
  record("A10-T05 createPackage budget 1e10", "reject", await call("budget 1e10", () => c.mutation("tradePackages:createTradePackage", mkPkg({ csiDivision: "05 00 00", budgetEstimate: 1e10 }))));
  record("A10-T06 createPackage past deadline", "reject", await call("past deadline", () => c.mutation("tradePackages:createTradePackage", mkPkg({ csiDivision: "05 00 00", bidDeadline: "2020-01-01" }))));
  record("A10-T07 createPackage invalid calendar date", "reject", await call("feb30", () => c.mutation("tradePackages:createTradePackage", mkPkg({ csiDivision: "05 00 00", bidDeadline: "2026-02-30" }))));
  record("A10-T08 createPackage nonexistent project", "reject", await call("bogus project", () => c.mutation("tradePackages:createTradePackage", mkPkg({ projectId: alphaProjCorrupt, csiDivision: "05 00 00" }))));
  record("A10-T09 createPackage duplicate CSI same project", "reject", await call("dup csi", () => c.mutation("tradePackages:createTradePackage", mkPkg({ projectId: F.alpha.projectId, csiDivision: "26 00 00" }))));

  const inclEmpty = await call("empty inclusions", () => c.mutation("tradePackages:createTradePackage", mkPkg({ csiDivision: "05 00 00", mandatoryInclusions: ["", "   "] })));
  record("A10-T10 createPackage mandatoryInclusions ['','   ']", "inspect", inclEmpty, inclEmpty.ok ? "empty inclusion strings accepted and stored" : null);
  if (inclEmpty.ok) {
    const pkg = await c.query("tradePackages:getPackage", { tradePackageId: inclEmpty.value });
    rows[rows.length - 1].note = `stored=${JSON.stringify(pkg.mandatoryInclusions)}`;
  }
  const inclHuge = await call("huge inclusions", () => c.mutation("tradePackages:createTradePackage", mkPkg({ csiDivision: "06 00 00", mandatoryInclusions: Array.from({ length: 50 }, () => "Z".repeat(4000)) })));
  record("A10-T11 createPackage 50 x 4000-char inclusions", "inspect", inclHuge, inclHuge.ok ? "200KB unbounded inclusion payload accepted" : null);

  const mkPkg2 = (csi) => mkPkg({ csiDivision: csi });
  const raceT = await Promise.allSettled([
    c.raw.mutation("tradePackages:createTradePackage", mkPkg2("07 00 00")),
    c.raw.mutation("tradePackages:createTradePackage", mkPkg2("07 00 00")),
  ]);
  const raceToks = raceT.map((r) => (r.status === "fulfilled" ? `ok:${r.value}` : `err:${(r.reason?.data ?? r.reason?.message ?? "").toString().slice(0, 90)}`));
  const raceTCount = (await c.query("tradePackages:listByProject", { projectId: malProject })).filter((p) => p.csiDivision === "07 00 00").length;
  record("A10-T12 concurrent duplicate CSI insert (two-tab race)", "inspect", { ok: raceTCount === 1, value: raceToks }, `rows for 07 00 00 = ${raceTCount} (expect 1)`);

  // ---------------- contractors ----------------
  const mkCtr = (over = {}) => ({
    tradePackageId: malPkg,
    companyName: "AUDIT-QA10 TMP Contractor",
    contactEmail: "tmp.qa10@qa10.invalid",
    phone: "+1 (512) 555-0199",
    licenseNumber: "TX-QA10-9999",
    licenseStatus: "Active / Verified",
    sourceUrl: "https://qa10.example.invalid",
    rfqStatus: "discovered",
    ...over,
  });
  record("A10-C01 createContractor empty name", "reject", await call("empty name", () => c.mutation("contractors:createContractor", mkCtr({ companyName: "  " }))));
  record("A10-C02 createContractor bad email", "reject", await call("bad email", () => c.mutation("contractors:createContractor", mkCtr({ contactEmail: "not-an-email" }))));
  record("A10-C03 createContractor email no TLD", "reject", await call("a@b", () => c.mutation("contractors:createContractor", mkCtr({ contactEmail: "a@b" }))));
  record("A10-C04 createContractor 4000-char name", "reject", await call("long name", () => c.mutation("contractors:createContractor", mkCtr({ companyName: "N".repeat(4000) }))));
  record("A10-C05 createContractor bad rfqStatus", "reject", await call("bad status", () => c.mutation("contractors:createContractor", mkCtr({ rfqStatus: "hacked" }))));
  record("A10-C06 createContractor nonexistent package", "reject", await call("bogus pkg", () => c.mutation("contractors:createContractor", mkCtr({ tradePackageId: alphaPkgCorrupt }))));
  record("A10-C07 createContractor boolean phone", "reject", await call("bool phone", () => c.mutation("contractors:createContractor", mkCtr({ phone: true }))));

  const ctr1 = await call("dup email 1", () => c.mutation("contractors:createContractor", mkCtr({ companyName: "AUDIT-QA10 TMP Dup One", contactEmail: "dup.qa10@qa10.invalid" })));
  const ctr2 = await call("dup email 2", () => c.mutation("contractors:createContractor", mkCtr({ companyName: "AUDIT-QA10 TMP Dup Two", contactEmail: "dup.qa10@qa10.invalid" })));
  const dupEmailRows = (await c.query("contractors:listByPackage", { tradePackageId: malPkg })).filter((x) => x.contactEmail === "dup.qa10@qa10.invalid").length;
  record("A10-C08 duplicate contactEmail accepted?", "inspect", { ok: ctr1.ok && ctr2.ok, value: { ctr1: ctr1.value, ctr2: ctr2.value } }, `rows with same email=${dupEmailRows} (no uniqueness constraint)`);

  record("A10-C09 updateContractor nonexistent id", "reject", await call("bogus ctr", () => c.mutation("contractors:updateContractor", { contractorId: corruptId(malContractor, 12), companyName: "X", contactEmail: "x@y.zz", licenseNumber: "L", licenseStatus: "S", sourceUrl: "u" })));
  record("A10-C10 updateContractor empty name", "reject", await call("empty name", () => c.mutation("contractors:updateContractor", { contractorId: malContractor, companyName: "", contactEmail: "x@y.zz", licenseNumber: "L", licenseStatus: "S", sourceUrl: "u" })));
  record("A10-C11 updateContractor invalid email", "reject", await call("bad email", () => c.mutation("contractors:updateContractor", { contractorId: malContractor, companyName: "AUDIT-QA10 Malformed Electric", contactEmail: "nope", licenseNumber: "L", licenseStatus: "S", sourceUrl: "u" })));
  record("A10-C12 updateContractor invalid rfqStatus", "reject", await call("bad status", () => c.mutation("contractors:updateContractor", { contractorId: malContractor, companyName: "AUDIT-QA10 Malformed Electric", contactEmail: "malformed.electric@qa10.invalid", licenseNumber: "L", licenseStatus: "S", sourceUrl: "u", rfqStatus: "evil" })));
  record("A10-C13 updateRfqStatus nonexistent id", "inspect", await call("bogus status", () => c.mutation("contractors:updateRfqStatus", { contractorId: corruptId(malContractor, 12), rfqStatus: "invited" })));
  record("A10-C14 deleteContractor with bid on file", "reject", await call("delete bidder", () => c.mutation("contractors:deleteContractor", { contractorId: malContractor })));
  record("A10-C15 deleteContractor nonexistent", "reject", await call("delete bogus", () => c.mutation("contractors:deleteContractor", { contractorId: corruptId(malContractor, 12) })));

  // ---------------- tradePackages:updateStatus ----------------
  record("A10-T13 updateStatus invalid literal", "reject", await call("bad status", () => c.mutation("tradePackages:updateStatus", { tradePackageId: malPkg, status: "hacked" })));
  const stBogus = await call("bogus status id", () => c.mutation("tradePackages:updateStatus", { tradePackageId: alphaPkgCorrupt, status: "leveling" }));
  record("A10-T14 updateStatus nonexistent valid-format", "inspect", stBogus, stBogus.ok ? "silent no-op or phantom success" : "throws");
  const stReal = await call("status roundtrip draft", () => c.mutation("tradePackages:updateStatus", { tradePackageId: malPkg, status: "draft" }));
  await c.mutation("tradePackages:updateStatus", { tradePackageId: malPkg, status: "rfqs_dispatched" }).catch(() => {});
  record("A10-T15 updateStatus valid roundtrip", "accept", stReal);

  // ---------------- bids ----------------
  const probeCtrRes = await call("probe contractor", () => c.mutation("contractors:createContractor", mkCtr({ companyName: "AUDIT-QA10 Probe Bidder", contactEmail: "probe.bidder@qa10.invalid", rfqStatus: "invited" })));
  const probeCtr = probeCtrRes.value;
  const mkBid = (over = {}) => ({
    tradePackageId: malPkg,
    contractorId: probeCtr,
    subcontractorName: "AUDIT-QA10 Probe Bidder",
    baseBidAmount: 500000,
    lineItems: [{ item: "Base", unit: "LS", quantity: 1, unitCost: 500000, totalCost: 500000 }],
    identifiedExclusions: [],
    valueEngineeringAlternates: [],
    longLeadEquipmentWeeks: 12,
    leadTimePenalty: 0,
    coiComplianceStatus: "compliant",
    coiPenalty: 0,
    ...over,
  });
  record("A10-B01 submitBid below $1000 minimum", "reject", await call("bid 999", () => c.mutation("bids:submitDirectBid", mkBid({ baseBidAmount: 999 }))));
  record("A10-B02 submitBid above ceiling", "reject", await call("bid 1e12", () => c.mutation("bids:submitDirectBid", mkBid({ baseBidAmount: 1e12 }))));
  record("A10-B03 submitBid zero", "reject", await call("bid 0", () => c.mutation("bids:submitDirectBid", mkBid({ baseBidAmount: 0 }))));
  record("A10-B04 submitBid negative", "reject", await call("bid -5000", () => c.mutation("bids:submitDirectBid", mkBid({ baseBidAmount: -5000 }))));
  record("A10-B05 submitBid bad COI status", "reject", await call("bad coi", () => c.mutation("bids:submitDirectBid", mkBid({ coiComplianceStatus: "banana" }))));
  record("A10-B06 submitBid negative exclusion impact", "reject", await call("neg exclusion", () => c.mutation("bids:submitDirectBid", mkBid({ identifiedExclusions: [{ description: "x", costImpact: -5, severity: "minor" }] }))));
  record("A10-B07 submitBid negative VE deduct", "reject", await call("neg ve", () => c.mutation("bids:submitDirectBid", mkBid({ valueEngineeringAlternates: [{ description: "x", costDeduct: -5, isAccepted: true }] }))));
  record("A10-B08 submitBid fractional lead weeks", "reject", await call("1.5 weeks", () => c.mutation("bids:submitDirectBid", mkBid({ longLeadEquipmentWeeks: 1.5 }))));
  record("A10-B09 submitBid negative lead weeks", "reject", await call("neg weeks", () => c.mutation("bids:submitDirectBid", mkBid({ longLeadEquipmentWeeks: -1 }))));
  record("A10-B10 submitBid wrong-package contractor", "reject", await call("foreign contractor", () => c.mutation("bids:submitDirectBid", mkBid({ contractorId: F.bravo.contractor }))));
  record("A10-B11 submitBid nonexistent contractor", "reject", await call("bogus contractor", () => c.mutation("bids:submitDirectBid", mkBid({ contractorId: corruptId(F.bravo.contractor, 12) }))));
  record("A10-B12 submitBid empty subcontractorName", "reject", await call("empty name", () => c.mutation("bids:submitDirectBid", mkBid({ subcontractorName: "   " }))));
  record("A10-B13 submitBid string base amount", "reject", await call("string amount", () => c.mutation("bids:submitDirectBid", mkBid({ baseBidAmount: "500000" }))));

  const negLines = await call("negative line items", () => c.mutation("bids:submitDirectBid", mkBid({
    baseBidAmount: 400000,
    lineItems: [
      { item: "Negative qty", unit: "EA", quantity: -5, unitCost: 1000, totalCost: -5000 },
      { item: "Negative cost", unit: "LS", quantity: 1, unitCost: -10000, totalCost: -10000 },
    ],
  })));
  record("A10-B14 submitBid negative line-item numbers", "inspect", negLines, negLines.ok ? "negative quantity/unitCost/totalCost accepted into lineItems" : null);
  if (negLines.ok) {
    const b = await c.query("bids:listByPackage", { tradePackageId: malPkg });
    const stored = (b || []).find((x) => x._id === negLines.value.bidId);
    rows[rows.length - 1].note = `stored lineItems=${JSON.stringify(stored.lineItems)}`;
  }

  const raceBids = await Promise.allSettled([
    c.raw.mutation("bids:submitDirectBid", mkBid({ baseBidAmount: 333000, contractorId: probeCtr })),
    c.raw.mutation("bids:submitDirectBid", mkBid({ baseBidAmount: 333000, contractorId: probeCtr })),
  ]);
  const bidsForProbe = (await c.query("bids:listByPackage", { tradePackageId: malPkg })).filter((b) => b.contractorId === probeCtr);
  record("A10-B15 concurrent double-submit same contractor", "inspect", { ok: bidsForProbe.length === 1, value: raceBids.map((r) => r.status) }, `bid rows for probe contractor=${bidsForProbe.length} (expect 1)`);

  record("A10-B16 updateBidLeveling nonexistent bid", "reject", await call("bogus bid", () => c.mutation("bids:updateBidLeveling", { bidId: corruptId(malBid, 12), baseBidAmount: 500000 })));
  const probeBidId = probeCtrBid(await c.query("bids:listByPackage", { tradePackageId: malPkg }), probeCtr);
  const lwNeg = await call("weeks -3", () => c.mutation("bids:updateBidLeveling", { bidId: probeBidId, longLeadEquipmentWeeks: -3 }));
  record("A10-B17 updateBidLeveling negative longLeadEquipmentWeeks", "inspect", lwNeg, lwNeg.ok ? "negative lead weeks accepted by public leveling writer" : null);
  const lwFrac = await call("weeks 3.7", () => c.mutation("bids:updateBidLeveling", { bidId: probeBidId, longLeadEquipmentWeeks: 3.7 }));
  record("A10-B18 updateBidLeveling fractional longLeadEquipmentWeeks", "inspect", lwFrac, lwFrac.ok ? "fractional lead weeks accepted" : null);
  const sevScript = await call("script severity", () => c.mutation("bids:updateBidLeveling", {
    bidId: probeBidId,
    identifiedExclusions: [{ description: "QA10 XSS probe", costImpact: 1000, severity: "<script>alert(1)</script>", isWaived: false }],
  }));
  record("A10-B19 updateBidLeveling arbitrary severity string", "inspect", sevScript, sevScript.ok ? "arbitrary severity accepted (UI styling key)" : null);
  record("A10-B20 updateBidLeveling negative exclusion", "reject", await call("neg excl", () => c.mutation("bids:updateBidLeveling", { bidId: malBid, identifiedExclusions: [{ description: "x", costImpact: -1, severity: "minor" }] })));
  record("A10-B21 updateBidAdjustments nonexistent bid", "reject", await call("bogus bid", () => c.mutation("bids:updateBidAdjustments", { bidId: corruptId(malBid, 12), identifiedExclusions: [] })));
  const adjLw = await call("adj weeks -9", () => c.mutation("bids:updateBidAdjustments", { bidId: probeBidId, identifiedExclusions: [], longLeadEquipmentWeeks: -9 }));
  record("A10-B22 updateBidAdjustments negative longLeadEquipmentWeeks", "inspect", adjLw, adjLw.ok ? "negative lead weeks accepted via adjustments writer" : null);
  record("A10-B23 updateBidAdjustments wipe exclusions ([]) accepted", "inspect", await call("wipe", () => c.mutation("bids:updateBidAdjustments", { bidId: probeBidId, identifiedExclusions: [] })));

  record("A10-B24 awardContract without agreement", "reject", await call("award no agreement", () => c.mutation("bids:awardContract", { bidId: F.bravo.bid, tradePackageId: F.bravo.elecPackageId })));
  record("A10-B25 awardContract nonexistent bid", "reject", await call("award bogus", () => c.mutation("bids:awardContract", { bidId: corruptId(F.bravo.bid, 12), tradePackageId: F.bravo.elecPackageId })));
  record("A10-B26 awardContract cross-project pairing", "reject", await call("award cross", () => c.mutation("bids:awardContract", { bidId: F.bravo.bid, tradePackageId: F.alpha.elecPackageId })));
  record("A10-B27 unawardContract nonexistent bid", "reject", await call("unaward bogus", () => c.mutation("bids:unawardContract", { bidId: corruptId(malBid, 12), tradePackageId: malPkg })));
  record("A10-B28 unawardContract cross-project pairing", "reject", await call("unaward cross", () => c.mutation("bids:unawardContract", { bidId: F.bravo.bid, tradePackageId: malPkg })));
  record("A10-B29 deleteBid nonexistent", "reject", await call("delete bogus", () => c.mutation("bids:deleteBid", { bidId: corruptId(malBid, 12) })));
  record("A10-B30 deleteBid with executed agreement", "reject", await call("delete executed", () => c.mutation("bids:deleteBid", { bidId: malBid })));

  // ---------------- agreements ----------------
  record("A10-A01 generateAgreement nonexistent bid", "reject", await call("bogus bid", () => c.mutation("agreements:generateAgreement", { bidId: corruptId(malBid, 12), tradePackageId: malPkg })));
  record("A10-A02 generateAgreement cross-project pairing", "reject", await call("cross", () => c.mutation("agreements:generateAgreement", { bidId: F.bravo.bid, tradePackageId: F.alpha.elecPackageId })));
  record("A10-A03 generateAgreement executed-immutability", "reject", await call("regen executed", () => c.mutation("agreements:generateAgreement", { bidId: malBid, tradePackageId: malPkg })));
  record("A10-A04 executeAgreement nonexistent", "reject", await call("bogus agreement", () => c.mutation("agreements:executeAgreement", { agreementId: corruptId(F.malformed.agreement, 12) })));
  record("A10-A05 deleteTradePackage with executed agreement", "reject", await call("delete executed pkg", () => c.mutation("tradePackages:deleteTradePackage", { tradePackageId: malPkg })));
  record("A10-A06 deleteTradePackage nonexistent", "reject", await call("delete bogus pkg", () => c.mutation("tradePackages:deleteTradePackage", { tradePackageId: alphaPkgCorrupt })));

  // ---------------- auto-generated trade packages from spec ----------------
  record("A10-T16 generateTradePackagesFromSpec nonexistent project (action)", "reject", await call("bogus spec project", () => c.action("tradePackages:generateTradePackagesFromSpec", { projectId: alphaProjCorrupt, specDocumentTextOverride: "Division 33 00 00 Utilities" })));

  writeEvidence("malformed-core", { generatedAt: new Date().toISOString(), rows, log, probeContractor: probeCtr });
  writeLog("malformed-core", log);
  const fails = rows.filter((r) => !r.ok);
  console.log(`\nTOTAL ${rows.length} probes, ${fails.length} flagged`);
}

function probeCtrBid(bids, contractorId) {
  const b = (bids || []).find((x) => x.contractorId === contractorId);
  if (!b) throw new Error("probe bid missing");
  return b._id;
}

main().catch((e) => { console.error(e); process.exit(1); });