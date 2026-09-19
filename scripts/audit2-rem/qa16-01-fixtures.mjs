import { client, fixtureTitle, writeEvidence, writeLog, sleep, utcDate } from "./qa16-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const A = fixtureTitle("A");
const B = fixtureTitle("B");
const EDGE = fixtureTitle("EDGE");

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
    say(`WARN could not delete ${title}: ${e.message}`);
  }
}

async function createProject(title, type, location = "New York, NY") {
  const id = await c.mutation("projects:createProject", {
    title,
    location,
    projectType: type,
    estBudget: 3_500_000,
    targetCompletionWeeks: 52,
    specDocumentText: `${title} fixture spec. Division 26 electrical, Division 23 HVAC, Division 22 plumbing.`,
    isDemoProject: false,
    generalContractorName: "AUDIT-QA16 General Contractor LLC",
  });
  say(`created project ${title} ${id}`);
  return id;
}

async function createPackage(projectId, csiDivision, tradeName, bidDeadline, opts = {}) {
  const id = await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision,
    tradeName,
    budgetEstimate: opts.budgetEstimate ?? 1_000_000,
    scopeSummary: opts.scopeSummary ?? `${tradeName} fixture scope for QA16.`,
    mandatoryInclusions: opts.mandatoryInclusions ?? ["QA16 inclusion A", "QA16 inclusion B"],
    bidDeadline,
  });
  say(`created package ${csiDivision} "${String(tradeName).slice(0, 40)}" ${id}`);
  return id;
}

async function setStatus(pkgId, status) {
  await c.mutation("tradePackages:updateStatus", { tradePackageId: pkgId, status });
  say(`package ${pkgId} status -> ${status}`);
  return pkgId;
}

async function createContractor(pkgId, companyName, email, rfqStatus = "invited") {
  const id = await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId,
    companyName,
    contactEmail: email,
    phone: "+1 (212) 555-0144",
    licenseNumber: "NY-QA16-0001",
    licenseStatus: "Active / Verified (QA16)",
    sourceUrl: "https://qa16.example.invalid",
    rfqStatus,
  });
  say(`created contractor "${String(companyName).slice(0, 40)}" ${id}`);
  return id;
}

async function createBid(pkgId, contractorId, name, amount, opts = {}) {
  const res = await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkgId,
    contractorId,
    subcontractorName: name,
    baseBidAmount: amount,
    lineItems: opts.lineItems ?? [
      { item: "QA16 base scope", unit: "LS", quantity: 1, unitCost: amount, totalCost: amount },
    ],
    identifiedExclusions: opts.identifiedExclusions ?? [],
    valueEngineeringAlternates: opts.valueEngineeringAlternates ?? [],
    longLeadEquipmentWeeks: opts.longLeadEquipmentWeeks ?? 8,
    leadTimePenalty: opts.leadTimePenalty ?? 0,
    coiComplianceStatus: opts.coiComplianceStatus ?? "compliant",
    coiPenalty: opts.coiPenalty ?? 0,
  });
  say(`created bid ${res.bidId} on ${pkgId} $${amount}`);
  return res.bidId;
}

async function main() {
  const todayUtc = utcDate(new Date());
  say(`clock UTC date=${todayUtc} at ${new Date().toISOString()}`);

  for (const t of [A, B, EDGE]) await hardDelete(t);

  // ---------- Fixture A: concurrency / two-tab / claims / award ----------
  const aId = await createProject(A, "QA16 Concurrency Fixture");
  const aP1 = await createPackage(aId, "26 00 00", "AUDIT-QA16 Electrical Main", "2026-12-15", { budgetEstimate: 950_000 });
  const aP2 = await createPackage(aId, "23 00 00", "AUDIT-QA16 HVAC Main", "2026-12-20", { budgetEstimate: 900_000 });
  const aP3 = await createPackage(aId, "22 00 00", "AUDIT-QA16 Plumbing Draft", "2026-12-28", { budgetEstimate: 400_000 });
  const aP4 = await createPackage(aId, "27 00 00", "AUDIT-QA16 Delete Target Comms", "2026-12-30", { budgetEstimate: 250_000 });
  await setStatus(aP1, "rfqs_dispatched");
  await setStatus(aP2, "rfqs_dispatched");
  await setStatus(aP3, "rfqs_dispatched");

  const aC1 = await createContractor(aP1, "AUDIT-QA16 Electric One", "qa16.elec1@qa16.invalid");
  const aC2 = await createContractor(aP1, "AUDIT-QA16 Electric Two", "qa16.elec2@qa16.invalid");
  const aB1 = await createBid(aP1, aC1, "AUDIT-QA16 Electric One", 900_000, {
    identifiedExclusions: [{ description: "QA16 temporary power", costImpact: 20_000, severity: "medium" }],
  });
  const aB2 = await createBid(aP1, aC2, "AUDIT-QA16 Electric Two", 880_000, {
    valueEngineeringAlternates: [{ description: "QA16 LED package", costDeduct: 15_000, isAccepted: true }],
  });

  const aC3 = await createContractor(aP2, "AUDIT-QA16 HVAC Co", "qa16.hvac@qa16.invalid");
  const aB3 = await createBid(aP2, aC3, "AUDIT-QA16 HVAC Co", 780_000);

  // ---------- Fixture B: second project for two-tab interleave ----------
  const bId = await createProject(B, "QA16 Second Project Fixture", "Chicago, IL");
  const bP1 = await createPackage(bId, "21 00 00", "AUDIT-QA16-B Fire Protection", "2026-12-22", { budgetEstimate: 500_000 });
  await setStatus(bP1, "rfqs_dispatched");
  const bC1 = await createContractor(bP1, "AUDIT-QA16-B Sprinkler Co", "qa16.b@qa16.invalid");
  const bB1 = await createBid(bP1, bC1, "AUDIT-QA16-B Sprinkler Co", 430_000);

  // ---------- Fixture EDGE: unusual but valid states ----------
  const edgeId = await createProject(EDGE, "QA16 Edge-State Fixture");
  const longName = ("AUDIT-QA16 超長Électricité " + "X".repeat(480)).slice(0, 500);
  const eP1 = await createPackage(edgeId, "26 00 00", longName, "2026-12-31", {
    budgetEstimate: 120_000,
    scopeSummary: "Edge: zero mandatory inclusions.",
    mandatoryInclusions: [],
  });
  await setStatus(eP1, "rfqs_dispatched");
  const eC1 = await createContractor(eP1, "株式会社テスト電気", "qa16.unicode@qa16.invalid");
  const eB1 = await createBid(eP1, eC1, "株式会社テスト電気", 100_000, { lineItems: [], longLeadEquipmentWeeks: 0 });

  const eP2 = await createPackage(edgeId, "23 00 00", "AUDIT-QA16 🚧 Électricité ⚡ HVAC 空調", "2026-12-31", {
    budgetEstimate: 220_000,
    scopeSummary: "Edge: emoji + unicode trade name.",
    mandatoryInclusions: ["", "  ", "AUDIT-QA16 real inclusion"],
  });
  await setStatus(eP2, "rfqs_dispatched");
  const eC2 = await createContractor(eP2, "AUDIT-QA16 Edge Bidder", "qa16.edge2@qa16.invalid");
  await createBid(eP2, eC2, "AUDIT-QA16 Edge Bidder", 210_000, {
    lineItems: [{ item: "", unit: "", quantity: 0, unitCost: 0, totalCost: 0 }],
    longLeadEquipmentWeeks: 0,
  });

  const map = {
    generatedAt: new Date().toISOString(),
    todayUtc,
    projectA: { title: A, id: aId, packages: { p1: aP1, p2: aP2, p3: aP3, p4: aP4 }, contractors: { c1: aC1, c2: aC2, c3: aC3 }, bids: { b1: aB1, b2: aB2, b3: aB3 } },
    projectB: { title: B, id: bId, package: bP1, contractor: bC1, bid: bB1 },
    projectEdge: { title: EDGE, id: edgeId, p1: eP1, p2: eP2, contractor: eC1, bid: eB1 },
  };
  writeEvidence("fixtures", map);
  writeLog("fixtures", log);
  console.log("fixtures:", JSON.stringify(map, null, 1));
}

main().catch((e) => {
  console.error(e);
  writeLog("fixtures-crash", [String(e && e.stack ? e.stack : e)]);
  process.exit(1);
});