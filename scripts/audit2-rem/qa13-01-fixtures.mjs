import {
  client,
  fixtureTitle,
  listProjects,
  deleteProjectHard,
  writeEvidence,
  writeLog,
  sleep,
} from "./qa13-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const TITLES = {
  MAIN: fixtureTitle("MAIN"),
  EXEC: fixtureTitle("EXEC"),
  ZERO: fixtureTitle("ZERO"),
  INGEST: fixtureTitle("INGEST"),
};

async function findProject(title) {
  return (await listProjects(c)).find((p) => p.title === title) || null;
}

async function purgeExisting() {
  const existing = (await listProjects(c)).filter((p) => p.title.startsWith("AUDIT-QA13-"));
  for (const p of existing) {
    const res = await deleteProjectHard(c, p._id);
    say(`purge existing ${p.title} ${p._id}: ${JSON.stringify(res)}`);
  }
}

async function ensureProject(title) {
  const id = await c.mutation("projects:createProject", {
    title,
    location: "Austin, TX",
    projectType: "Class-A Commercial Mixed-Use QA13",
    estBudget: 3_000_000,
    targetCompletionWeeks: 52,
    specDocumentText:
      "QA13 fixture specification. Division 26 electrical, Division 23 HVAC, Division 22 plumbing. Base building distribution and rooftop AHUs.",
    isDemoProject: false,
    generalContractorName: "QA13 General Contractor LLC",
  });
  const p = await c.query("projects:getProject", { projectId: id });
  say(`created project ${title} ${id}`);
  return p;
}

async function ensurePackage(projectId, csiDivision, tradeName, budget) {
  const id = await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision,
    tradeName,
    budgetEstimate: budget,
    scopeSummary: `QA13 ${tradeName} scope summary covering full division scope.`,
    mandatoryInclusions: [`QA13 inclusion for ${csiDivision}`],
    bidDeadline: "2026-12-31",
  });
  return await c.query("tradePackages:getPackage", { tradePackageId: id });
}

async function ensureContractor(pkgId, companyName, email) {
  const id = await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId,
    companyName,
    contactEmail: email,
    phone: "+1 (512) 555-0199",
    licenseNumber: "TX-QA13-0001",
    licenseStatus: "Active / Verified (TDLR-QA13)",
    sourceUrl: "https://qa13.example.invalid",
    rfqStatus: "invited",
  });
  const list = await c.query("contractors:listByPackage", { tradePackageId: pkgId });
  return (list || []).find((x) => x._id === id);
}

async function ensureBid(pkg, contractor, amount, lineItems, extra = {}) {
  const res = await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkg._id,
    contractorId: contractor._id,
    subcontractorName: contractor.companyName,
    baseBidAmount: amount,
    lineItems,
    identifiedExclusions: [],
    valueEngineeringAlternates: [],
    longLeadEquipmentWeeks: 12,
    leadTimePenalty: 0,
    coiComplianceStatus: "compliant",
    coiPenalty: 0,
    ...extra,
  });
  const bids = await c.query("bids:listByPackage", { tradePackageId: pkg._id });
  return { bid: (bids || []).find((b) => b._id === res.bidId), created: res };
}

function baseLine(amount, item = "QA13 Base Scope") {
  return [{ item, unit: "LS", quantity: 1, unitCost: amount, totalCost: amount }];
}

async function main() {
  const map = { generatedAt: new Date().toISOString() };

  await purgeExisting();

  // ---------------- MAIN ----------------
  const main = await ensureProject(TITLES.MAIN);
  const elec = await ensurePackage(main._id, "26 00 00", "QA13 Electrical Main", 1_000_000);
  const hvac = await ensurePackage(main._id, "23 00 00", "QA13 HVAC Main", 1_000_000);
  const plumb = await ensurePackage(main._id, "22 00 00", "QA13 Plumbing Supersede", 500_000);

  const elec1 = await ensureContractor(elec._id, "AUDIT-QA13 Main Electric Co", "qa13.elec1@qa13.invalid");
  const elec2 = await ensureContractor(elec._id, "AUDIT-QA13 Main Electric Backup", "qa13.elec2@qa13.invalid");
  const hvac1 = await ensureContractor(hvac._id, "AUDIT-QA13 HVAC Main Co", "qa13.hvac1@qa13.invalid");
  const plumb1 = await ensureContractor(plumb._id, "AUDIT-QA13 Plumbing Co", "qa13.plumb1@qa13.invalid");

  const elec1Bid = await ensureBid(elec, elec1, 850_000, baseLine(850_000, "QA13 Electrical base scope"));
  const elec2Bid = await ensureBid(elec, elec2, 640_000, baseLine(640_000, "QA13 Electrical backup scope"));
  const hvacBid = await ensureBid(
    hvac,
    hvac1,
    800_000,
    [
      { item: "Rooftop AHU supply and installation", unit: "LS", quantity: 1, unitCost: 500_000, totalCost: 500_000 },
      { item: "Factory-mounted VFD units on chilled water AHUs", unit: "LS", quantity: 1, unitCost: 300_000, totalCost: 300_000 },
    ]
  );
  const plumbBid = await ensureBid(plumb, plumb1, 320_000, baseLine(320_000, "QA13 Plumbing base scope"));

  Object.assign(map, {
    mainProjectId: main._id,
    mainElecPackageId: elec._id,
    mainHvacPackageId: hvac._id,
    mainPlumbPackageId: plumb._id,
    mainElecContractorId: elec1._id,
    mainBackupContractorId: elec2._id,
    mainHvacContractorId: hvac1._id,
    mainPlumbContractorId: plumb1._id,
    mainElecBidId: elec1Bid.bid._id,
    mainBackupBidId: elec2Bid.bid._id,
    mainHvacBidId: hvacBid.bid._id,
    mainPlumbBidId: plumbBid.bid._id,
  });

  // ---------------- EXEC (executed subcontract) ----------------
  const exec = await ensureProject(TITLES.EXEC);
  const execPkg = await ensurePackage(exec._id, "26 00 00", "QA13 Electrical Exec", 900_000);
  const execCtr = await ensureContractor(execPkg._id, "AUDIT-QA13 Exec Electric", "qa13.exec1@qa13.invalid");
  const execBid = await ensureBid(execPkg, execCtr, 900_000, baseLine(900_000, "QA13 Exec base scope"));
  const gen = await c.mutation("agreements:generateAgreement", {
    bidId: execBid.bid._id,
    tradePackageId: execPkg._id,
  });
  const execAgr = (await c.query("agreements:listAgreements", { projectId: exec._id })).find((a) => a._id === gen._id);
  const execResult = await c.mutation("agreements:executeAgreement", { agreementId: execAgr._id });
  const execAgrAfter = (await c.query("agreements:listAgreements", { projectId: exec._id })).find((a) => a._id === execAgr._id);
  say(`EXEC agreement ${execAgr.agreementNumber} status ${execAgrAfter.status}; execute=${JSON.stringify(execResult)}`);
  Object.assign(map, {
    execProjectId: exec._id,
    execPackageId: execPkg._id,
    execContractorId: execCtr._id,
    execBidId: execBid.bid._id,
    execAgreementId: execAgr._id,
    execAgreementNumber: execAgr.agreementNumber,
  });

  // ---------------- ZERO (no contractors) ----------------
  const zero = await ensureProject(TITLES.ZERO);
  const zeroPkg = await ensurePackage(zero._id, "26 00 00", "QA13 Electrical Zero", 800_000);
  Object.assign(map, { zeroProjectId: zero._id, zeroPackageId: zeroPkg._id });

  // ---------------- INGEST (file upload target) ----------------
  const ingest = await ensureProject(TITLES.INGEST);
  const ingestPkg = await ensurePackage(ingest._id, "26 00 00", "QA13 Electrical Ingest", 1_000_000);
  const ingestCtr = await ensureContractor(
    ingestPkg._id,
    "AUDIT-QA13 Ingest Electric",
    "qa13.ingest1@qa13.invalid"
  );
  Object.assign(map, {
    ingestProjectId: ingest._id,
    ingestPackageId: ingestPkg._id,
    ingestContractorId: ingestCtr._id,
  });

  writeEvidence("fixtures", map);
  writeLog("fixtures", log);
  await sleep(200);
  console.log("fixtures:", JSON.stringify(map, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});