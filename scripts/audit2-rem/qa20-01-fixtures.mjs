/**
 * QA20-01 fixtures: create fresh deterministic fixture projects (AUDIT-QA20-*).
 * Purges only projects whose title starts with AUDIT-QA20-. Idempotent.
 */
import {
  client,
  fixtureTitle,
  writeEvidence,
  writeLog,
  findProjectByTitle,
  sleep,
} from "./qa20-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const today = new Date();
const plusDays = (n) => {
  const d = new Date(today.getTime() + n * 86400000);
  return d.toISOString().slice(0, 10);
};
const minusDays = (n) => plusDays(-n);

export async function purgeQa20() {
  const projects = (await c.query("projects:listProjects", {})) || [];
  for (const p of projects.filter((x) => x.title.startsWith("AUDIT-QA20-"))) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await c.mutation("agreements:voidExecutedAgreement", {
          agreementId: a._id,
          reason: "QA20 fixture teardown of executed record before cleanup.",
        });
      } catch (err) {
        say(`purge void ${a.agreementNumber} failed: ${err?.data ?? err?.message}`);
      }
    }
    try {
      await c.mutation("projects:deleteProject", { projectId: p._id });
      say(`purged ${p.title}`);
    } catch (err) {
      say(`purge ${p.title} failed: ${err?.data ?? err?.message}`);
    }
    await sleep(200);
  }
}

async function makeProject({ title, location, budget, weeks = 52, gc }) {
  const id = await c.mutation("projects:createProject", {
    title,
    location,
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: budget,
    targetCompletionWeeks: weeks,
    specDocumentText: `${title} automated QA fixture scope.`,
    isDemoProject: false,
    generalContractorName: gc,
  });
  return id;
}

async function makePackage({ projectId, csi, name, budget, deadline, inclusions }) {
  return await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision: csi,
    tradeName: name,
    budgetEstimate: budget,
    scopeSummary: `${name} full scope per CSI ${csi} for QA20 fixtures.`,
    mandatoryInclusions: inclusions,
    bidDeadline: deadline,
  });
}

async function makeContractor({ pkgId, name, email, license }) {
  return await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId,
    companyName: name,
    contactEmail: email,
    phone: "+1 (206) 555-0142",
    licenseNumber: license,
    licenseStatus: "Active / Verified (QA20)",
    sourceUrl: "https://qa20.example.invalid/license",
    rfqStatus: "invited",
  });
}

async function makeBid({ pkgId, contractorId, name, base, exclusions = [], leadPenalty = 0, ve = [] }) {
  const activeExclusions = exclusions.reduce((s, e) => s + (e.isWaived ? 0 : e.costImpact), 0);
  const deduct = ve.reduce((s, v) => s + (v.isAccepted ? v.costDeduct : 0), 0);
  const leveled = Math.max(0, base + activeExclusions + leadPenalty - deduct);
  const res = await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkgId,
    contractorId,
    subcontractorName: name,
    baseBidAmount: base,
    identifiedExclusions: exclusions,
    valueEngineeringAlternates: ve,
    longLeadEquipmentWeeks: 8,
    leadTimePenalty: leadPenalty,
    coiComplianceStatus: "compliant",
    coiPenalty: 0,
  });
  return { bidId: res.bidId, leveled: res.leveledTotalCost };
}

async function main() {
  await purgeQa20();

  // ---------- Journey project ----------
  const journeyId = await makeProject({
    title: fixtureTitle("JOURNEY"),
    location: "Seattle, WA",
    budget: 3200000,
    gc: "QA20 Cascade Builders, LP",
  });
  const j1 = await makePackage({
    projectId: journeyId,
    csi: "26 00 00",
    name: "QA20 Electrical & Lighting",
    budget: 1200000,
    deadline: plusDays(21),
    inclusions: ["Crane hoisting", "Seismic bracing", "Temporary power"],
  });
  const jA = await makeContractor({ pkgId: j1, name: "AUDIT-QA20 Alpha Electric", email: "estimating@qa20-alpha.invalid", license: "WA-QA20-AL1" });
  const jB = await makeContractor({ pkgId: j1, name: "AUDIT-QA20 Beta Power", email: "estimating@qa20-beta.invalid", license: "WA-QA20-BT2" });
  const jBidA = await makeBid({
    pkgId: j1, contractorId: jA, name: "AUDIT-QA20 Alpha Electric", base: 1150000,
    exclusions: [{ description: "QA20 sealed conduit allowance excluded", costImpact: 40000, severity: "moderate" }],
  });
  const jBidB = await makeBid({
    pkgId: j1, contractorId: jB, name: "AUDIT-QA20 Beta Power", base: 1090000,
    exclusions: [
      { description: "QA20 crane hoisting excluded", costImpact: 60000, severity: "critical" },
      { description: "QA20 firestop excluded", costImpact: 45000, severity: "critical" },
    ],
    leadPenalty: 12000,
  });

  // ---------- State project ----------
  const stateId = await makeProject({
    title: fixtureTitle("STATE"),
    location: "Austin, TX",
    budget: 2500000,
    gc: "QA20 Lone Star GC, LLC",
  });
  const s1 = await makePackage({
    projectId: stateId, csi: "23 00 00", name: "QA20 HVAC Systems", budget: 800000, deadline: plusDays(14),
    inclusions: ["TAB certified report", "BACnet gateway"],
  });
  const s1A = await makeContractor({ pkgId: s1, name: "AUDIT-QA20 State Air One", email: "estimating@qa20-s1a.invalid", license: "TX-QA20-S1A" });
  const s1B = await makeContractor({ pkgId: s1, name: "AUDIT-QA20 State Air Two", email: "estimating@qa20-s1b.invalid", license: "TX-QA20-S1B" });
  const s1BidA = await makeBid({
    pkgId: s1, contractorId: s1A, name: "AUDIT-QA20 State Air One", base: 700000,
    exclusions: [{ description: "QA20 S1 gap A", costImpact: 40000, severity: "moderate" }],
  });
  const s1BidB = await makeBid({
    pkgId: s1, contractorId: s1B, name: "AUDIT-QA20 State Air Two", base: 680000,
    exclusions: [{ description: "QA20 S1 gap B", costImpact: 30000, severity: "moderate" }],
  });
  const s2 = await makePackage({
    projectId: stateId, csi: "22 00 00", name: "QA20 Plumbing Systems", budget: 500000, deadline: plusDays(14),
    inclusions: ["Triplex pump commissioning"],
  });
  const s2A = await makeContractor({ pkgId: s2, name: "AUDIT-QA20 State Plumbing", email: "estimating@qa20-s2a.invalid", license: "TX-QA20-S2A" });
  const s2Bid = await makeBid({ pkgId: s2, contractorId: s2A, name: "AUDIT-QA20 State Plumbing", base: 430000 });
  const s3 = await makePackage({
    projectId: stateId, csi: "03 00 00", name: "QA20 Concrete (deadline yesterday, no bids)", budget: 120000, deadline: minusDays(1),
    inclusions: ["Vapor barrier"],
  });

  const fixtures = {
    createdAt: new Date().toISOString(),
    journey: { id: journeyId, packageId: j1, packageName: "QA20 Electrical & Lighting", contractors: { a: jA, b: jB }, bids: { a: jBidA, b: jBidB } },
    state: { id: stateId, s1, s2, s3, contractors: { s1A, s1B, s2A }, bids: { s1A: s1BidA, s1B: s1BidB, s2: s2Bid } },
    deadlines: { plus21: plusDays(21), plus14: plusDays(14), minus3: minusDays(3), todayUtc: today.toISOString().slice(0, 10) },
  };
  say(`journey=${journeyId} s1=${s1} s2=${s2} s3=${s3}`);
  say(`journey bids: alpha=${jBidA} beta=${jBidB}`);
  writeEvidence("fixtures", fixtures);
  writeLog("fixtures", log);
  console.log("fixtures ready");
}

main().catch((e) => {
  console.error(e);
  writeLog("fixtures-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});