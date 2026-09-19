import { client, fixtureTitle, writeEvidence, writeLog, sleep, utcDate, zonedDate, zonedDateTime } from "./qa14-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const TZ_TITLE = fixtureTitle("TZ");
const CTRL_TITLE = fixtureTitle("CTRL");

async function findProject(title) {
  const projects = (await c.query("projects:listProjects", {})) || [];
  return projects.find((p) => p.title === title) || null;
}

async function hardDelete(title) {
  const existing = await findProject(title);
  if (!existing) return;
  await c.mutation("projects:deleteProject", { projectId: existing._id });
  say(`removed pre-existing ${title} (${existing._id})`);
  await sleep(800);
}

async function createProject(title, type) {
  const id = await c.mutation("projects:createProject", {
    title,
    location: "New York, NY",
    projectType: type,
    estBudget: 3_500_000,
    targetCompletionWeeks: 52,
    specDocumentText: `${title} fixture spec. Division 26 electrical, Division 23 HVAC, Division 22 plumbing.`,
    isDemoProject: false,
    generalContractorName: "AUDIT-QA14 General Contractor LLC",
  });
  const project = await c.query("projects:getProject", { projectId: id });
  say(`created project ${title} ${id}`);
  return project;
}

async function createPackage(projectId, csiDivision, tradeName, bidDeadline) {
  const id = await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision,
    tradeName,
    budgetEstimate: 1_000_000,
    scopeSummary: `${tradeName} fixture scope for QA14 deadline testing.`,
    mandatoryInclusions: ["QA14 inclusion A", "QA14 inclusion B"],
    bidDeadline,
  });
  const pkg = await c.query("tradePackages:getPackage", { tradePackageId: id });
  say(`created package ${tradeName} ${id} deadline=${bidDeadline}`);
  return pkg;
}

async function setStatus(pkgId, status) {
  await c.mutation("tradePackages:updateStatus", { tradePackageId: pkgId, status });
  const pkg = await c.query("tradePackages:getPackage", { tradePackageId: pkgId });
  say(`package ${pkg.csiDivision} status -> ${pkg.status}`);
  return pkg;
}

async function createContractor(pkgId, companyName, email) {
  const id = await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId,
    companyName,
    contactEmail: email,
    phone: "+1 (212) 555-0144",
    licenseNumber: "NY-QA14-0001",
    licenseStatus: "Active / Verified (QA14)",
    sourceUrl: "https://qa14.example.invalid",
    rfqStatus: "invited",
  });
  const list = (await c.query("contractors:listByPackage", { tradePackageId: pkgId })) || [];
  const ctr = list.find((x) => x._id === id);
  say(`created contractor ${companyName} ${id}`);
  return ctr;
}

async function createBid(pkgId, contractor, amount) {
  const res = await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkgId,
    contractorId: contractor._id,
    subcontractorName: contractor.companyName,
    baseBidAmount: amount,
    lineItems: [{ item: "QA14 base scope", unit: "LS", quantity: 1, unitCost: amount, totalCost: amount }],
    identifiedExclusions: [],
    valueEngineeringAlternates: [],
    longLeadEquipmentWeeks: 8,
    leadTimePenalty: 0,
    coiComplianceStatus: "compliant",
    coiPenalty: 0,
  });
  say(`created bid ${res.bidId} on pkg ${pkgId}`);
  return res;
}

async function main() {
  const now = new Date();
  const todayUtc = utcDate(now);
  const nyDate = zonedDate(now, "America/New_York");
  const nyNow = zonedDateTime(now, "America/New_York");
  say(`clock: UTC date=${todayUtc} | America/New_York local date=${nyDate} at ${nyNow}`);

  await hardDelete(TZ_TITLE);
  await hardDelete(CTRL_TITLE);

  const tz = await createProject(TZ_TITLE, "QA14 Deadline Timezone Fixture");
  const dueTodayElect = await createPackage(tz._id, "26 00 00", "AUDIT-QA14 Due Today Electrical", todayUtc);
  const dueTodayNoBid = await createPackage(tz._id, "23 00 00", "AUDIT-QA14 Due Today No Bid HVAC", todayUtc);
  const futureControl = await createPackage(tz._id, "22 00 00", "AUDIT-QA14 Control Future Plumbing", "2026-12-31");

  await setStatus(dueTodayElect._id, "rfqs_dispatched");
  await setStatus(dueTodayNoBid._id, "rfqs_dispatched");
  await setStatus(futureControl._id, "rfqs_dispatched");

  const e1 = await createContractor(dueTodayElect._id, "AUDIT-QA14 Electrical Bidder", "qa14.elec@qa14.invalid");
  const e1Bid = await createBid(dueTodayElect._id, e1, 910_000);

  const p3ctr = await createContractor(futureControl._id, "AUDIT-QA14 Edit Target Plumbing", "qa14.edit@qa14.invalid");
  const p3Bid = await createBid(futureControl._id, p3ctr, 780_000);

  const ctrl = await createProject(CTRL_TITLE, "QA14 Cross-Project Isolation Fixture");
  const ctrlPkg = await createPackage(ctrl._id, "26 00 00", "AUDIT-QA14 Control Project Electrical", todayUtc);
  await setStatus(ctrlPkg._id, "rfqs_dispatched");
  const c1 = await createContractor(ctrlPkg._id, "AUDIT-QA14 Control Electric", "qa14.ctrl@qa14.invalid");
  const c1Bid = await createBid(ctrlPkg._id, c1, 640_000);

  const map = {
    generatedAt: now.toISOString(),
    todayUtc,
    nyDate,
    nyNow,
    tzProjectId: tz._id,
    tzProjectTitle: TZ_TITLE,
    dueTodayElectPackageId: dueTodayElect._id,
    dueTodayNoBidPackageId: dueTodayNoBid._id,
    futureControlPackageId: futureControl._id,
    electricalContractorId: e1._id,
    electricalBidId: e1Bid.bidId,
    editTargetContractorId: p3ctr._id,
    editTargetEmail: p3ctr.contactEmail,
    editTargetName: p3ctr.companyName,
    controlProjectId: ctrl._id,
    controlProjectTitle: CTRL_TITLE,
    controlPackageId: ctrlPkg._id,
    controlBidId: c1Bid.bidId,
  };
  writeEvidence("fixtures", map);
  writeLog("fixtures", log);
  await sleep(300);
  console.log("fixtures:", JSON.stringify(map, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});