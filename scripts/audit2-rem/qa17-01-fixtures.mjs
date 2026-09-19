/**
 * QA17 fixtures (AUDIT-QA17-* only):
 *  - AUDIT-QA17-DEADLINE: A15-05 local-today vs UTC-today vs with-bids packages.
 *  - AUDIT-QA17-NAME: 10 packages incl. a ~500-char trade name (A16-02 ribbon).
 */
import { client, fixtureTitle, writeEvidence, writeLog, sleep, utcDate, zonedDate, addDays } from "./qa17-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const DEADLINE = fixtureTitle("DEADLINE");
const NAME = fixtureTitle("NAME");

async function findProject(title) {
  const projects = (await c.query("projects:listProjects", {})) || [];
  return projects.find((p) => p.title === title) || null;
}

async function hardDelete(title) {
  const existing = await findProject(title);
  if (!existing) return;
  try {
    await c.mutation("projects:deleteProject", { projectId: existing._id });
    say(`removed pre-existing ${title} (${existing._id})`);
    await sleep(600);
  } catch (e) {
    say(`WARN could not delete ${title}: ${e?.data ?? e?.message}`);
  }
}

async function createProject(title, type, location = "New York, NY") {
  const id = await c.mutation("projects:createProject", {
    title,
    location,
    projectType: type,
    estBudget: 4_000_000,
    targetCompletionWeeks: 48,
    specDocumentText: `${title} fixture spec. Division 01-10 coverage.`,
    isDemoProject: false,
    generalContractorName: "AUDIT-QA17 General Contractor LLC",
  });
  say(`created project ${title} ${id}`);
  return id;
}

async function createPackage(projectId, csiDivision, tradeName, bidDeadline, opts = {}) {
  const id = await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision,
    tradeName,
    budgetEstimate: opts.budgetEstimate ?? 200_000,
    scopeSummary: opts.scopeSummary ?? `${String(tradeName).slice(0, 60)} QA17 fixture scope.`,
    mandatoryInclusions: ["QA17 inclusion"],
    bidDeadline,
  });
  say(`created package ${csiDivision} "${String(tradeName).slice(0, 34)}..." ${id}`);
  return id;
}

async function createContractor(pkgId, companyName, email) {
  const id = await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId,
    companyName,
    contactEmail: email,
    phone: "+1 (212) 555-0177",
    licenseNumber: "NY-QA17-0001",
    licenseStatus: "Active / Verified (QA17)",
    sourceUrl: "https://qa17.example.invalid",
    rfqStatus: "invited",
  });
  say(`created contractor "${companyName}" ${id}`);
  return id;
}

async function createBid(pkgId, contractorId, name, amount) {
  const res = await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkgId,
    contractorId,
    subcontractorName: name,
    baseBidAmount: amount,
    lineItems: [{ item: "QA17 base scope", unit: "LS", quantity: 1, unitCost: amount, totalCost: amount }],
    identifiedExclusions: [],
    valueEngineeringAlternates: [],
    longLeadEquipmentWeeks: 4,
    leadTimePenalty: 0,
    coiComplianceStatus: "compliant",
    coiPenalty: 0,
  });
  say(`created bid ${res.bidId} on ${pkgId} $${amount}`);
  return res.bidId;
}

async function setStatus(pkgId, status) {
  await c.mutation("tradePackages:updateStatus", { tradePackageId: pkgId, status });
  return pkgId;
}

function buildLongName() {
  const base = "AUDIT-QA17 Long-Name Ribbon Probe - Structural Steel, Miscellaneous Metals, Architectural Precast, Expansion Joints, Spray Fireproofing, Special Inspections ";
  let s = (base.repeat(6)).slice(0, 500);
  if (s.endsWith(" ")) s = s.slice(0, 499) + "Z";
  return s.trim();
}

async function main() {
  const now = new Date();
  const utcToday = utcDate(now);
  const nyToday = zonedDate(now, "America/New_York");
  const twoDaysLocal = addDays(nyToday, -1);
  say(`clock now=${now.toISOString()} utcToday=${utcToday} nyToday=${nyToday}`);

  for (const t of [DEADLINE, NAME]) await hardDelete(t);

  // ---------------- DEADLINE fixture ----------------
  const dId = await createProject(DEADLINE, "QA17 Deadline Monitor Fixture");
  const dlLocalTodayNoBids = await createPackage(dId, "26 00 00", "AUDIT-QA17 DL Local Today NoBids", nyToday, { budgetEstimate: 150_000 });
  const dlUtcTodayNoBids = await createPackage(dId, "23 00 00", "AUDIT-QA17 DL UTC Today NoBids", utcToday, { budgetEstimate: 150_000 });
  const dlLocalTodayWithBids = await createPackage(dId, "22 00 00", "AUDIT-QA17 DL Local Today WithBids", nyToday, { budgetEstimate: 150_000 });
  const dlUtcTodayWithBids = await createPackage(dId, "21 00 00", "AUDIT-QA17 DL UTC Today WithBids", utcToday, { budgetEstimate: 150_000 });
  await setStatus(dlLocalTodayNoBids, "rfqs_dispatched");
  await setStatus(dlUtcTodayNoBids, "rfqs_dispatched");
  await setStatus(dlLocalTodayWithBids, "rfqs_dispatched");
  await setStatus(dlUtcTodayWithBids, "rfqs_dispatched");

  const cLocal = await createContractor(dlLocalTodayWithBids, "AUDIT-QA17 DL Local Bidder", "qa17.dl.local@qa17.invalid");
  const bLocal = await createBid(dlLocalTodayWithBids, cLocal, "AUDIT-QA17 DL Local Bidder", 135_000);
  const cUtc = await createContractor(dlUtcTodayWithBids, "AUDIT-QA17 DL UTC Bidder", "qa17.dl.utc@qa17.invalid");
  const bUtc = await createBid(dlUtcTodayWithBids, cUtc, "AUDIT-QA17 DL UTC Bidder", 135_000);

  // Attempt the "two days local" (two days before UTC today) deadline: validator expected to reject.
  let twoDaysLocalCreation = null;
  try {
    const id = await createPackage(dId, "20 00 00", "AUDIT-QA17 DL Two Days Local", twoDaysLocal, { budgetEstimate: 100_000 });
    twoDaysLocalCreation = { ok: true, id };
    say(`UNEXPECTED: two-days-local deadline ${twoDaysLocal} accepted (${id})`);
  } catch (err) {
    twoDaysLocalCreation = { ok: false, data: String(err?.data ?? err?.message ?? err) };
    say(`two-days-local deadline ${twoDaysLocal} rejected as expected: ${twoDaysLocalCreation.data}`);
  }

  // ---------------- NAME fixture (10 packages) ----------------
  const nId = await createProject(NAME, "QA17 Long-Name Ribbon Fixture");
  const LONG = buildLongName();
  say(`long name len=${LONG.length} head="${LONG.slice(0, 48)}"`);
  const np = {};
  np.long1 = await createPackage(nId, "01 00 00", LONG, "2026-12-01", { budgetEstimate: 250_000 });
  np.short2 = await createPackage(nId, "02 00 00", "AUDIT-QA17 Short HVAC", "2026-12-02", { budgetEstimate: 220_000 });
  np.short3 = await createPackage(nId, "03 00 00", "AUDIT-QA17 Mid-Length Plumbing & Process Piping Scope Envelope", "2026-12-03", { budgetEstimate: 180_000 });
  np.short4 = await createPackage(nId, "04 00 00", "HVAC", "2026-12-04", { budgetEstimate: 120_000 });
  np.short5 = await createPackage(nId, "05 00 00", "AUDIT-QA17 Short 05", "2026-12-05", { budgetEstimate: 130_000 });
  np.short6 = await createPackage(nId, "06 00 00", "AUDIT-QA17 Short 06", "2026-12-06", { budgetEstimate: 140_000 });
  np.short7 = await createPackage(nId, "07 00 00", "AUDIT-QA17 Short 07", "2026-12-07", { budgetEstimate: 150_000 });
  np.short8 = await createPackage(nId, "08 00 00", "AUDIT-QA17 Short 08", "2026-12-08", { budgetEstimate: 160_000 });
  np.short9 = await createPackage(nId, "09 00 00", "AUDIT-QA17 Short 09", "2026-12-09", { budgetEstimate: 170_000 });
  np.short10 = await createPackage(nId, "10 00 00", "AUDIT-QA17 Short 10", "2026-12-10", { budgetEstimate: 180_000 });

  await setStatus(np.long1, "rfqs_dispatched");
  await setStatus(np.short2, "rfqs_dispatched");
  const ncLong = await createContractor(np.long1, "AUDIT-QA17 Long Bidder", "qa17.name.long@qa17.invalid");
  const nbLong = await createBid(np.long1, ncLong, "AUDIT-QA17 Long Bidder", 230_000);
  const nc2 = await createContractor(np.short2, "AUDIT-QA17 Smoke Bidder", "qa17.name.smoke@qa17.invalid");
  const nb2 = await createBid(np.short2, nc2, "AUDIT-QA17 Smoke Bidder", 200_000);

  const map = {
    generatedAt: new Date().toISOString(),
    clock: { utcToday, nyToday, twoDaysLocal, nowIso: now.toISOString() },
    deadline: {
      title: DEADLINE,
      id: dId,
      packages: {
        localTodayNoBids: dlLocalTodayNoBids,
        utcTodayNoBids: dlUtcTodayNoBids,
        localTodayWithBids: dlLocalTodayWithBids,
        utcTodayWithBids: dlUtcTodayWithBids,
      },
      bids: { local: bLocal, utc: bUtc },
      twoDaysLocalCreation,
    },
    name: {
      title: NAME,
      id: nId,
      longName: LONG,
      packages: np,
      longBid: nbLong,
      smokeBid: nb2,
      smokePackage: np.short2,
    },
    mainProjectTitle: NAME,
    smoke: {
      packageId: np.short2,
      packageName: "AUDIT-QA17 Short HVAC",
      bidderName: "AUDIT-QA17 Smoke Bidder",
      bidId: nb2,
    },
  };
  writeEvidence("fixtures", map);
  writeLog("fixtures", log);
  console.log("fixtures done");
}

main().catch((e) => {
  console.error(e);
  writeLog("fixtures-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});