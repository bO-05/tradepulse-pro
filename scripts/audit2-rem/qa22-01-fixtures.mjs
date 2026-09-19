/**
 * QA22-01 fixtures (AUDIT-QA22-* only). Purges prior QA22 fixtures first.
 * Projects: STATE (guards/state machine), EXEC (executed immutability),
 * CSV (injection export), SCAN (clash scan guard), DEADLINE (local-day close).
 */
import {
  client, fixtureTitle, writeEvidence, writeLog, sleep, localDate, utcDate,
} from "./qa22-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

export async function purgeQa22() {
  const projects = (await c.query("projects:listProjects", {})) || [];
  for (const p of projects.filter((x) => x.title.startsWith("AUDIT-QA22-"))) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await c.mutation("agreements:voidExecutedAgreement", {
          agreementId: a._id,
          reason: "QA22 fixture teardown of executed record before cleanup.",
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
    await sleep(250);
  }
}

const plusDays = (n, base = new Date()) => new Date(base.getTime() + n * 86400000).toISOString().slice(0, 10);

async function makeProject({ title, location, budget, weeks = 52, gc, spec }) {
  return await c.mutation("projects:createProject", {
    title, location,
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: budget,
    targetCompletionWeeks: weeks,
    specDocumentText: spec || `${title} automated QA fixture scope.`,
    isDemoProject: false,
    generalContractorName: gc,
  });
}

async function makePackage({ projectId, csi, name, budget, deadline, inclusions }) {
  return await c.mutation("tradePackages:createTradePackage", {
    projectId, csiDivision: csi, tradeName: name, budgetEstimate: budget,
    scopeSummary: `${name} full scope per CSI ${csi} for QA22 fixtures.`,
    mandatoryInclusions: inclusions,
    bidDeadline: deadline,
  });
}

async function makeContractor({ pkgId, name, email, license, status = "invited" }) {
  return await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId, companyName: name, contactEmail: email,
    phone: "+1 (206) 555-0199", licenseNumber: license,
    licenseStatus: "Active / Verified (QA22)", sourceUrl: "https://qa22.example.invalid/license",
    rfqStatus: status,
  });
}

async function makeBid({ pkgId, contractorId, name, base, exclusions = [], leadPenalty = 0, ve = [], weeks = 8 }) {
  const res = await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkgId, contractorId, subcontractorName: name,
    baseBidAmount: base, identifiedExclusions: exclusions, valueEngineeringAlternates: ve,
    longLeadEquipmentWeeks: weeks, leadTimePenalty: leadPenalty,
    coiComplianceStatus: "compliant", coiPenalty: 0,
  });
  return { bidId: res.bidId, leveled: res.leveledTotalCost, base };
}

async function main() {
  await purgeQa22();

  // ---------- STATE ----------
  const stateId = await makeProject({ title: fixtureTitle("STATE"), location: "Austin, TX", budget: 2500000, gc: "QA22 Lone Star GC, LLC" });
  const s1 = await makePackage({ projectId: stateId, csi: "26 00 00", name: "QA22 Electrical & Lighting", budget: 800000, deadline: plusDays(14), inclusions: ["Temp power", "Seismic bracing"] });
  const s1A = await makeContractor({ pkgId: s1, name: "AUDIT-QA22 Alpha Electric", email: "estimating@qa22-alpha.invalid", license: "TX-QA22-AL1" });
  const s1B = await makeContractor({ pkgId: s1, name: "AUDIT-QA22 Beta Power", email: "estimating@qa22-beta.invalid", license: "TX-QA22-BT2" });
  const s1C = await makeContractor({ pkgId: s1, name: "AUDIT-QA22 Gamma Current", email: "estimating@qa22-gamma.invalid", license: "TX-QA22-GM3" });
  const s1BidA = await makeBid({ pkgId: s1, contractorId: s1A, name: "AUDIT-QA22 Alpha Electric", base: 780000, exclusions: [{ description: "QA22 sealed conduit allowance excluded", costImpact: 40000, severity: "moderate" }] });
  const s1BidB = await makeBid({ pkgId: s1, contractorId: s1B, name: "AUDIT-QA22 Beta Power", base: 700000, exclusions: [{ description: "QA22 crane hoisting excluded", costImpact: 60000, severity: "critical" }, { description: "QA22 firestop excluded", costImpact: 45000, severity: "critical" }], leadPenalty: 12000 });
  const s1BidC = await makeBid({ pkgId: s1, contractorId: s1C, name: "AUDIT-QA22 Gamma Current", base: 690000, exclusions: [{ description: "QA22 switchgear excluded", costImpact: 200000, severity: "critical" }] });

  const s2 = await makePackage({ projectId: stateId, csi: "23 00 00", name: "QA22 HVAC Systems", budget: 500000, deadline: plusDays(14), inclusions: ["TAB report"] });
  const s2A = await makeContractor({ pkgId: s2, name: "AUDIT-QA22 State Air One", email: "estimating@qa22-s2.invalid", license: "TX-QA22-S2" });
  const s2Bid = await makeBid({ pkgId: s2, contractorId: s2A, name: "AUDIT-QA22 State Air One", base: 470000 });

  const s3 = await makePackage({ projectId: stateId, csi: "22 00 00", name: "QA22 Plumbing Systems", budget: 300000, deadline: localDate(), inclusions: ["Triplex pump commissioning"] });
  const s3A = await makeContractor({ pkgId: s3, name: "AUDIT-QA22 Plumbing One", email: "estimating@qa22-s3.invalid", license: "TX-QA22-S3" });
  const s3Bid = await makeBid({ pkgId: s3, contractorId: s3A, name: "AUDIT-QA22 Plumbing One", base: 280000 });

  const s4 = await makePackage({ projectId: stateId, csi: "03 00 00", name: "QA22 Concrete (deadline yesterday, no bids)", budget: 120000, deadline: plusDays(-1), inclusions: ["Vapor barrier"] });

  // ---------- EXEC (immutability) ----------
  const execId = await makeProject({ title: fixtureTitle("EXEC"), location: "Denver, CO", budget: 1200000, gc: "QA22 Front Range GC" });
  const e1 = await makePackage({ projectId: execId, csi: "26 00 00", name: "QA22 Exec Electrical", budget: 600000, deadline: plusDays(10), inclusions: ["Gear labeling"] });
  const e1A = await makeContractor({ pkgId: e1, name: "AUDIT-QA22 Exec Electric", email: "estimating@qa22-exec.invalid", license: "CO-QA22-EX1" });
  const e1Bid = await makeBid({ pkgId: e1, contractorId: e1A, name: "AUDIT-QA22 Exec Electric", base: 550000 });

  // ---------- CSV (injection characters as bidder names) ----------
  const csvId = await makeProject({ title: fixtureTitle("CSV"), location: "Miami, FL", budget: 900000, gc: "QA22 Gulf GC" });
  const v1 = await makePackage({ projectId: csvId, csi: "26 00 00", name: "QA22 CSV Electrical", budget: 400000, deadline: plusDays(9), inclusions: ["Panel schedules"] });
  const v1A = await makeContractor({ pkgId: v1, name: "=1+1", email: "estimating@qa22-csv1.invalid", license: "FL-QA22-C1" });
  const v1B = await makeContractor({ pkgId: v1, name: "@SUM(1+1)", email: "estimating@qa22-csv2.invalid", license: "FL-QA22-C2" });
  const v1BidA = await makeBid({ pkgId: v1, contractorId: v1A, name: "=1+1", base: 380000 });
  const v1BidB = await makeBid({ pkgId: v1, contractorId: v1B, name: "@SUM(1+1)", base: 360000 });

  // ---------- SCAN (Div 26 only -> clash scan guard must refuse, no LLM) ----------
  const scanId = await makeProject({ title: fixtureTitle("SCAN"), location: "Phoenix, AZ", budget: 700000, gc: "QA22 Desert GC" });
  const c1 = await makePackage({ projectId: scanId, csi: "26 00 00", name: "QA22 Scan Electrical", budget: 300000, deadline: plusDays(9), inclusions: ["Conduit"] });
  const c1A = await makeContractor({ pkgId: c1, name: "AUDIT-QA22 Scan Electric", email: "estimating@qa22-scan.invalid", license: "AZ-QA22-SC1" });
  const c1Bid = await makeBid({ pkgId: c1, contractorId: c1A, name: "AUDIT-QA22 Scan Electric", base: 290000 });

  const fixtures = {
    createdAt: new Date().toISOString(),
    state: { id: stateId, s1, s2, s3, s4, contractors: { s1A, s1B, s1C, s2A, s3A }, bids: { s1BidA, s1BidB, s1BidC, s2Bid, s3Bid } },
    exec: { id: execId, pkg: e1, contractor: e1A, bid: e1Bid },
    csv: { id: csvId, pkg: v1, contractors: { a: v1A, b: v1B }, bids: { a: v1BidA, b: v1BidB } },
    scan: { id: scanId, pkg: c1, contractor: c1A, bid: c1Bid },
    deadlines: { plus14: plusDays(14), plus10: plusDays(10), plus9: plusDays(9), minus1: plusDays(-1), todayUtc: utcDate(), todayLocal: localDate() },
  };
  say(`state=${stateId} exec=${execId} csv=${csvId} scan=${scanId}`);
  say(`state bids: A=${s1BidA.leveled} B=${s1BidB.leveled} C=${s1BidC.leveled} | deadline todayLocal=${fixtures.deadlines.todayLocal}`);
  writeEvidence("fixtures", fixtures);
  writeLog("fixtures", log);
  console.log("fixtures ready");
}

main().catch((e) => {
  console.error(e);
  writeLog("fixtures-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});