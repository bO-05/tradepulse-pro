/**
 * QA23-01 fixtures (AUDIT-QA23-* only; purge touches nothing else).
 *  - PARTIAL: Div 26 priced (1 bid), Div 23 unpriced (contractor only) -> A21-01.
 *  - VOID:    Div 26, 2 bidders, Alpha awarded + execution recorded -> A21-02 UI.
 *  - SMOKE:   p1 Electrical (Alpha executed + Beta losing bid),
 *             p2 Plumbing (2 contractors + 1 bid; RFI + modal reset + deep-link),
 *             p3 Concrete (deadline -1d, zero bids, dispatched) -> cron no-bids,
 *             p4 Concrete w/ bid (deadline -1d, dispatched) -> cron close control.
 *  - CSV:     formula-prefixed bidder names -> export neutralization.
 */
import { client, fixtureTitle, writeEvidence, writeLog, sleep, purgeQa23, localDate, utcDate } from "./qa23-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const PARTIAL = fixtureTitle("PARTIAL");
const VOID = fixtureTitle("VOID");
const SMOKE = fixtureTitle("SMOKE");
const CSV = fixtureTitle("CSV");

const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function makeProject({ title, location, budget, gc }) {
  const id = await c.mutation("projects:createProject", {
    title,
    location,
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: budget,
    targetCompletionWeeks: 52,
    specDocumentText: `${title} QA23 fixture scope. Divisions 22-26 coverage.`,
    isDemoProject: false,
    generalContractorName: gc,
  });
  say(`created project ${title} ${id}`);
  return id;
}

async function makePackage({ projectId, csi, name, budget, deadline, inclusions }) {
  const id = await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision: csi,
    tradeName: name,
    budgetEstimate: budget,
    scopeSummary: `${name} full scope per CSI ${csi} for QA23 fixtures.`,
    mandatoryInclusions: inclusions,
    bidDeadline: deadline,
  });
  say(`created package ${csi} "${name}" ${id}`);
  return id;
}

async function makeContractor({ pkgId, name, email, license }) {
  const id = await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId,
    companyName: name,
    contactEmail: email,
    phone: "+1 (206) 555-0143",
    licenseNumber: license,
    licenseStatus: "Active / Verified (QA23)",
    sourceUrl: "https://qa23.example.invalid/license",
    rfqStatus: "invited",
  });
  say(`created contractor "${name}" ${id}`);
  return id;
}

async function makeBid({ pkgId, contractorId, name, base, exclusions = [] }) {
  const res = await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkgId,
    contractorId,
    subcontractorName: name,
    baseBidAmount: base,
    identifiedExclusions: exclusions,
    valueEngineeringAlternates: [],
    longLeadEquipmentWeeks: 8,
    leadTimePenalty: 0,
    coiComplianceStatus: "compliant",
    coiPenalty: 0,
  });
  say(`created bid ${res.bidId} for "${name}" $${base} leveled=$${res.leveledTotalCost}`);
  return res.bidId;
}

async function main() {
  const purged = await purgeQa23(c, say);
  say(`purged ${purged} pre-existing AUDIT-QA23-* fixture(s)`);

  const deadline = plusDays(21);

  // ---------- PARTIAL (A21-01) ----------
  const partialId = await makeProject({
    title: PARTIAL, location: "Austin, TX", budget: 1_500_000, gc: "QA23 Lone Star GC, LLC",
  });
  const ppElec = await makePackage({
    projectId: partialId, csi: "26 00 00", name: "QA23 PARTIAL Electrical", budget: 600_000, deadline,
    inclusions: ["QA23 switchgear commissioning"],
  });
  const ppHvac = await makePackage({
    projectId: partialId, csi: "23 00 00", name: "QA23 PARTIAL HVAC", budget: 450_000, deadline,
    inclusions: ["QA23 TAB report"],
  });
  const ppElecC = await makeContractor({ pkgId: ppElec, name: "AUDIT-QA23 PARTIAL Electric", email: "qa23.partial.e@qa23.invalid", license: "TX-QA23-PE1" });
  const ppHvacC = await makeContractor({ pkgId: ppHvac, name: "AUDIT-QA23 PARTIAL Mechanical", email: "qa23.partial.h@qa23.invalid", license: "TX-QA23-PH1" });
  const ppElecBid = await makeBid({ pkgId: ppElec, contractorId: ppElecC, name: "AUDIT-QA23 PARTIAL Electric", base: 410_000 });

  // ---------- VOID (A21-02) ----------
  const voidId = await makeProject({
    title: VOID, location: "Seattle, WA", budget: 3_200_000, gc: "QA23 Cascade Builders, LP",
  });
  const vPkg = await makePackage({
    projectId: voidId, csi: "26 00 00", name: "QA23 VOID Electrical", budget: 1_200_000, deadline,
    inclusions: ["QA23 crane hoisting"],
  });
  const vAlpha = await makeContractor({ pkgId: vPkg, name: "AUDIT-QA23 VOID Alpha Electric", email: "qa23.void.alpha@qa23.invalid", license: "WA-QA23-VA1" });
  const vBeta = await makeContractor({ pkgId: vPkg, name: "AUDIT-QA23 VOID Beta Power", email: "qa23.void.beta@qa23.invalid", license: "WA-QA23-VB2" });
  const vAlphaBid = await makeBid({
    pkgId: vPkg, contractorId: vAlpha, name: "AUDIT-QA23 VOID Alpha Electric", base: 1_150_000,
    exclusions: [{ description: "QA23 sealed conduit allowance excluded", costImpact: 40_000, severity: "moderate" }],
  });
  const vBetaBid = await makeBid({
    pkgId: vPkg, contractorId: vBeta, name: "AUDIT-QA23 VOID Beta Power", base: 1_240_000,
    exclusions: [{ description: "QA23 firestop excluded", costImpact: 45_000, severity: "critical" }],
  });
  const vAgr = await c.mutation("agreements:generateAgreement", { bidId: vAlphaBid, tradePackageId: vPkg });
  const vAgrId = vAgr?._id ?? vAgr?.id ?? null;
  if (!vAgrId) throw new Error("VOID generateAgreement returned no id");
  await c.mutation("agreements:executeAgreement", { agreementId: vAgrId });
  say(`VOID awarded + execution recorded: agreement ${vAgrId}`);

  // ---------- SMOKE ----------
  const smokeId = await makeProject({
    title: SMOKE, location: "Denver, CO", budget: 4_000_000, gc: "QA23 Mile High GC, Inc",
  });
  const sP1 = await makePackage({
    projectId: smokeId, csi: "26 00 00", name: "QA23 SMOKE Electrical", budget: 800_000, deadline,
    inclusions: ["QA23 feeder testing"],
  });
  const sP1A = await makeContractor({ pkgId: sP1, name: "AUDIT-QA23 SMOKE Alpha Electric", email: "qa23.smoke.alpha@qa23.invalid", license: "CO-QA23-S1A" });
  const sP1B = await makeContractor({ pkgId: sP1, name: "AUDIT-QA23 SMOKE Beta Electric", email: "qa23.smoke.beta@qa23.invalid", license: "CO-QA23-S1B" });
  const sP1BidA = await makeBid({ pkgId: sP1, contractorId: sP1A, name: "AUDIT-QA23 SMOKE Alpha Electric", base: 500_000 });
  const sP1BidB = await makeBid({ pkgId: sP1, contractorId: sP1B, name: "AUDIT-QA23 SMOKE Beta Electric", base: 520_000 });
  const sP1Agr = await c.mutation("agreements:generateAgreement", { bidId: sP1BidA, tradePackageId: sP1 });
  const sP1AgrId = sP1Agr?._id ?? sP1Agr?.id ?? null;
  if (!sP1AgrId) throw new Error("SMOKE p1 generateAgreement returned no id");
  await c.mutation("agreements:executeAgreement", { agreementId: sP1AgrId });
  say(`SMOKE p1 awarded + execution recorded: agreement ${sP1AgrId}`);

  const sP2 = await makePackage({
    projectId: smokeId, csi: "22 00 00", name: "QA23 SMOKE Plumbing", budget: 300_000, deadline,
    inclusions: ["QA23 triplex pump commissioning"],
  });
  const sP2A = await makeContractor({ pkgId: sP2, name: "AUDIT-QA23 SMOKE Plumbing One", email: "qa23.smoke.p1@qa23.invalid", license: "CO-QA23-S2A" });
  const sP2B = await makeContractor({ pkgId: sP2, name: "AUDIT-QA23 SMOKE Plumbing Two", email: "qa23.smoke.p2@qa23.invalid", license: "CO-QA23-S2B" });
  const sP2Bid = await makeBid({ pkgId: sP2, contractorId: sP2A, name: "AUDIT-QA23 SMOKE Plumbing One", base: 280_000 });

  const sP3 = await makePackage({
    projectId: smokeId, csi: "03 00 00", name: "QA23 SMOKE Concrete No Bids", budget: 120_000, deadline: plusDays(-1),
    inclusions: ["QA23 vapor barrier"],
  });
  await c.mutation("tradePackages:updateStatus", { tradePackageId: sP3, status: "rfqs_dispatched" });

  const sP4 = await makePackage({
    projectId: smokeId, csi: "31 00 00", name: "QA23 SMOKE Sitework With Bid", budget: 200_000, deadline: plusDays(-1),
    inclusions: ["QA23 erosion control"],
  });
  const sP4A = await makeContractor({ pkgId: sP4, name: "AUDIT-QA23 SMOKE Sitework Co", email: "qa23.smoke.s4@qa23.invalid", license: "CO-QA23-S4A" });
  const sP4Bid = await makeBid({ pkgId: sP4, contractorId: sP4A, name: "AUDIT-QA23 SMOKE Sitework Co", base: 188_000 });
  await c.mutation("tradePackages:updateStatus", { tradePackageId: sP4, status: "rfqs_dispatched" });

  // ---------- CSV ----------
  const csvId = await makeProject({
    title: CSV, location: "Miami, FL", budget: 900_000, gc: "QA23 Gulf GC",
  });
  const cCsv = await makePackage({
    projectId: csvId, csi: "26 00 00", name: "QA23 CSV Electrical", budget: 400_000, deadline,
    inclusions: ["QA23 panel schedules"],
  });
  const cCsvA = await makeContractor({ pkgId: cCsv, name: "=1+1", email: "qa23.csv.a@qa23.invalid", license: "FL-QA23-C1" });
  const cCsvB = await makeContractor({ pkgId: cCsv, name: "@SUM(1+1)", email: "qa23.csv.b@qa23.invalid", license: "FL-QA23-C2" });
  const cCsvBidA = await makeBid({ pkgId: cCsv, contractorId: cCsvA, name: "=1+1", base: 380_000 });
  const cCsvBidB = await makeBid({ pkgId: cCsv, contractorId: cCsvB, name: "@SUM(1+1)", base: 360_000 });

  await sleep(400);

  const fixtures = {
    createdAt: new Date().toISOString(),
    partial: {
      title: PARTIAL, id: partialId, elecPackageId: ppElec, hvacPackageId: ppHvac,
      contractors: { elec: ppElecC, hvac: ppHvacC }, elecBidId: ppElecBid,
    },
    void: {
      title: VOID, id: voidId, packageId: vPkg,
      contractors: { alpha: vAlpha, beta: vBeta }, bids: { alpha: vAlphaBid, beta: vBetaBid },
      agreementId: vAgrId,
    },
    smoke: {
      title: SMOKE, id: smokeId,
      p1: { id: sP1, contractors: { alpha: sP1A, beta: sP1B }, bids: { alpha: sP1BidA, beta: sP1BidB }, agreementId: sP1AgrId },
      p2: { id: sP2, contractors: { one: sP2A, two: sP2B }, bidId: sP2Bid },
      p3: { id: sP3 },
      p4: { id: sP4, contractor: sP4A, bidId: sP4Bid },
    },
    csv: { title: CSV, id: csvId, packageId: cCsv, contractors: { a: cCsvA, b: cCsvB }, bids: { a: cCsvBidA, b: cCsvBidB } },
    dates: { plus21: deadline, minus1: plusDays(-1), todayLocal: localDate(), todayUtc: utcDate() },
  };
  writeEvidence("01-fixtures", fixtures);
  writeLog("01-fixtures", log);
  console.log("fixtures ready");
}

main().catch((e) => {
  console.error(e);
  writeLog("01-fixtures-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});