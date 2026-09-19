/**
 * QA25-01 fixtures (AUDIT-QA25-* only; purge touches nothing else).
 *  - CREDITS:  Div26 + Div23, ZERO bids at creation -> both-unpriced + one-sided
 *              refusal matrix and later priced credit application.
 *  - NOEVPKG:  Div26 + Div23, ZERO bids -> detect truthful no-evidence probe.
 *  - NOEVONE:  Div26 only, ZERO bids -> detect scope-guard probe.
 *  - REGISTER: 3 packages left with one executed, one generated, one superseded
 *              agreement -> A23-01/A24-02/A24-03 register checks.
 *  - SMOKE:    p1 Electrical (executed, losing bid), p2 Plumbing (RFI + modal
 *              reset + deep-link), core regression fixtures.
 *  - CSV:      formula-prefixed bidder names -> export neutralization.
 */
import { client, fixtureTitle, writeEvidence, writeLog, sleep } from "./qa25-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const deadline = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function purgeQa25() {
  const projects = (await c.query("projects:listProjects", {})) || [];
  for (const p of projects.filter((x) => x.title.startsWith("AUDIT-QA25-"))) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await c.mutation("agreements:voidExecutedAgreement", {
          agreementId: a._id,
          reason: "QA25 fixture teardown of an executed record before cleanup.",
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

async function makeProject({ title, location, budget, gc }) {
  return await c.mutation("projects:createProject", {
    title,
    location,
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: budget,
    targetCompletionWeeks: 52,
    specDocumentText: `${title} QA25 fixture scope. Divisions 03-31 coverage.`,
    isDemoProject: false,
    generalContractorName: gc,
  });
}

async function makePackage({ projectId, csi, name, budget, deadline: dl, inclusions }) {
  return await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision: csi,
    tradeName: name,
    budgetEstimate: budget,
    scopeSummary: `${name} full scope per CSI ${csi} for QA25 fixtures.`,
    mandatoryInclusions: inclusions,
    bidDeadline: dl ?? deadline,
  });
}

async function makeContractor({ pkgId, name, email, license }) {
  return await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId,
    companyName: name,
    contactEmail: email,
    phone: "+1 (206) 555-0188",
    licenseNumber: license,
    licenseStatus: "Active / Verified (QA25)",
    sourceUrl: "https://qa25.example.invalid/license",
    rfqStatus: "invited",
  });
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
  return { bidId: res.bidId, leveled: res.leveledTotalCost, base };
}

async function main() {
  await purgeQa25();

  // ---------- CREDITS (zero bids at creation) ----------
  const credId = await makeProject({ title: fixtureTitle("CREDITS"), location: "Austin, TX", budget: 1500000, gc: "QA25 Credits GC, LLC" });
  const p26 = await makePackage({ projectId: credId, csi: "26 00 00", name: "QA25 Credits Electrical", budget: 800000, inclusions: ["QA25 feeder testing"] });
  const p23 = await makePackage({ projectId: credId, csi: "23 00 00", name: "QA25 Credits HVAC", budget: 500000, inclusions: ["QA25 TAB report"] });
  const c26 = await makeContractor({ pkgId: p26, name: "AUDIT-QA25 Credits Electric", email: "qa25.credits.e@qa25.invalid", license: "TX-QA25-CE" });
  const c23 = await makeContractor({ pkgId: p23, name: "AUDIT-QA25 Credits Mechanical", email: "qa25.credits.h@qa25.invalid", license: "TX-QA25-CH" });

  // ---------- NOEVPKG (Div26 + Div23, zero bids) ----------
  const noevPkgId = await makeProject({ title: fixtureTitle("NOEVPKG"), location: "Boise, ID", budget: 700000, gc: "QA25 No-Evidence GC" });
  const noevP26 = await makePackage({ projectId: noevPkgId, csi: "26 00 00", name: "QA25 NOEVPKG Electrical", budget: 400000, inclusions: ["QA25 temp power"] });
  const noevP23 = await makePackage({ projectId: noevPkgId, csi: "23 00 00", name: "QA25 NOEVPKG HVAC", budget: 300000, inclusions: ["QA25 crane pick"] });
  const noevP23C = await makeContractor({ pkgId: noevP23, name: "AUDIT-QA25 NOEVPKG Mechanical", email: "qa25.noevpkg.h@qa25.invalid", license: "ID-QA25-NH" });

  // ---------- NOEVONE (single Div26, zero bids) ----------
  const noevOneId = await makeProject({ title: fixtureTitle("NOEVONE"), location: "Reno, NV", budget: 500000, gc: "QA25 One-Trade GC" });
  const noevOneP26 = await makePackage({ projectId: noevOneId, csi: "26 00 00", name: "QA25 NOEVONE Electrical", budget: 300000, inclusions: ["QA25 gear labeling"] });

  // ---------- NOEVBIDS (Div26 + Div23, zero bids, untouched by the credit script) ----------
  const noevBidsId = await makeProject({ title: fixtureTitle("NOEVBIDS"), location: "Tulsa, OK", budget: 650000, gc: "QA25 No-Bid GC" });
  await makePackage({ projectId: noevBidsId, csi: "26 00 00", name: "QA25 NOEVBIDS Electrical", budget: 350000, inclusions: ["QA25 feeder testing"] });
  await makePackage({ projectId: noevBidsId, csi: "23 00 00", name: "QA25 NOEVBIDS HVAC", budget: 300000, inclusions: ["QA25 TAB report"] });

  // ---------- REGISTER (executed + generated + superseded) ----------
  const regId = await makeProject({ title: fixtureTitle("REGISTER"), location: "Miami, FL", budget: 1800000, gc: "QA25 Register GC" });
  const rExec = await makePackage({ projectId: regId, csi: "26 00 00", name: "QA25 Register Electrical", budget: 700000, inclusions: ["QA25 panel schedules"] });
  const rGen = await makePackage({ projectId: regId, csi: "23 00 00", name: "QA25 Register HVAC", budget: 500000, inclusions: ["QA25 TAB report"] });
  const rSup = await makePackage({ projectId: regId, csi: "25 00 00", name: "QA25 Register Controls", budget: 300000, inclusions: ["QA25 controls programming"] });
  const rExecC = await makeContractor({ pkgId: rExec, name: "AUDIT-QA25 Register Electric", email: "qa25.reg.e@qa25.invalid", license: "FL-QA25-RE" });
  const rGenC = await makeContractor({ pkgId: rGen, name: "AUDIT-QA25 Register Mechanical", email: "qa25.reg.h@qa25.invalid", license: "FL-QA25-RH" });
  const rSupC = await makeContractor({ pkgId: rSup, name: "AUDIT-QA25 Register Controls", email: "qa25.reg.c@qa25.invalid", license: "FL-QA25-RC" });
  const rExecBid = await makeBid({ pkgId: rExec, contractorId: rExecC, name: "AUDIT-QA25 Register Electric", base: 700000 });
  const rGenBid = await makeBid({ pkgId: rGen, contractorId: rGenC, name: "AUDIT-QA25 Register Mechanical", base: 400000 });
  const rSupBid = await makeBid({ pkgId: rSup, contractorId: rSupC, name: "AUDIT-QA25 Register Controls", base: 200000 });
  const agrExec = await c.mutation("agreements:generateAgreement", { bidId: rExecBid.bidId, tradePackageId: rExec });
  await c.mutation("agreements:executeAgreement", { agreementId: agrExec._id });
  const agrGen = await c.mutation("agreements:generateAgreement", { bidId: rGenBid.bidId, tradePackageId: rGen });
  const agrSup = await c.mutation("agreements:generateAgreement", { bidId: rSupBid.bidId, tradePackageId: rSup });
  await c.mutation("agreements:executeAgreement", { agreementId: agrSup._id });
  await c.mutation("agreements:voidExecutedAgreement", {
    agreementId: agrSup._id,
    reason: "QA25 register fixture: execution recorded against a superseded scope, voided for replacement.",
  });

  // ---------- SMOKE ----------
  const smokeId = await makeProject({ title: fixtureTitle("SMOKE"), location: "Denver, CO", budget: 4000000, gc: "QA25 Mile High GC, Inc" });
  const sP1 = await makePackage({ projectId: smokeId, csi: "26 00 00", name: "QA25 SMOKE Electrical", budget: 800000, inclusions: ["QA25 feeder testing"] });
  const sP1A = await makeContractor({ pkgId: sP1, name: "AUDIT-QA25 SMOKE Alpha Electric", email: "qa25.smoke.alpha@qa25.invalid", license: "CO-QA25-S1A" });
  const sP1B = await makeContractor({ pkgId: sP1, name: "AUDIT-QA25 SMOKE Beta Electric", email: "qa25.smoke.beta@qa25.invalid", license: "CO-QA25-S1B" });
  const sP1BidA = await makeBid({ pkgId: sP1, contractorId: sP1A, name: "AUDIT-QA25 SMOKE Alpha Electric", base: 500000 });
  const sP1BidB = await makeBid({ pkgId: sP1, contractorId: sP1B, name: "AUDIT-QA25 SMOKE Beta Electric", base: 520000 });
  const sP1Agr = await c.mutation("agreements:generateAgreement", { bidId: sP1BidA.bidId, tradePackageId: sP1 });
  await c.mutation("agreements:executeAgreement", { agreementId: sP1Agr._id });

  const sP2 = await makePackage({ projectId: smokeId, csi: "22 00 00", name: "QA25 SMOKE Plumbing", budget: 300000, inclusions: ["QA25 triplex pump commissioning"] });
  const sP2A = await makeContractor({ pkgId: sP2, name: "AUDIT-QA25 SMOKE Plumbing One", email: "qa25.smoke.p1@qa25.invalid", license: "CO-QA25-S2A" });
  const sP2B = await makeContractor({ pkgId: sP2, name: "AUDIT-QA25 SMOKE Plumbing Two", email: "qa25.smoke.p2@qa25.invalid", license: "CO-QA25-S2B" });
  const sP2Bid = await makeBid({ pkgId: sP2, contractorId: sP2A, name: "AUDIT-QA25 SMOKE Plumbing One", base: 280000 });

  // ---------- CSV ----------
  const csvId = await makeProject({ title: fixtureTitle("CSV"), location: "Miami, FL", budget: 900000, gc: "QA25 Gulf GC" });
  const csvPkg = await makePackage({ projectId: csvId, csi: "26 00 00", name: "QA25 CSV Electrical", budget: 400000, inclusions: ["QA25 panel schedules"] });
  const csvA = await makeContractor({ pkgId: csvPkg, name: "=1+1", email: "qa25.csv.a@qa25.invalid", license: "FL-QA25-C1" });
  const csvB = await makeContractor({ pkgId: csvPkg, name: "@SUM(1+1)", email: "qa25.csv.b@qa25.invalid", license: "FL-QA25-C2" });
  const csvBidA = await makeBid({ pkgId: csvPkg, contractorId: csvA, name: "=1+1", base: 380000 });
  const csvBidB = await makeBid({ pkgId: csvPkg, contractorId: csvB, name: "@SUM(1+1)", base: 360000 });

  await sleep(400);

  const fixtures = {
    createdAt: new Date().toISOString(),
    credits: {
      id: credId, p26, p23, contractors: { c26, c23 },
    },
    noevPkg: { id: noevPkgId, elecPackageId: noevP26, hvacPackageId: noevP23, hvacContractorId: noevP23C },
    noevOne: { id: noevOneId, packageId: noevOneP26 },
    noevBids: { id: noevBidsId },
    register: {
      id: regId,
      pExec: { id: rExec, contractor: rExecC, bidId: rExecBid.bidId, agreementId: agrExec._id, agreementNumber: agrExec.agreementNumber },
      pGen: { id: rGen, contractor: rGenC, bidId: rGenBid.bidId, agreementId: agrGen._id, agreementNumber: agrGen.agreementNumber },
      pSup: { id: rSup, contractor: rSupC, bidId: rSupBid.bidId, agreementId: agrSup._id, agreementNumber: agrSup.agreementNumber },
    },
    smoke: {
      id: smokeId,
      p1: { id: sP1, contractors: { alpha: sP1A, beta: sP1B }, bids: { alpha: sP1BidA.bidId, beta: sP1BidB.bidId }, agreementId: sP1Agr._id },
      p2: { id: sP2, contractors: { one: sP2A, two: sP2B }, bidId: sP2Bid.bidId },
    },
    csv: { id: csvId, packageId: csvPkg, contractors: { a: csvA, b: csvB }, bids: { a: csvBidA.bidId, b: csvBidB.bidId } },
    dates: { plus21: deadline, minus1: plusDays(-1) },
  };
  say(`credits=${credId} noevPkg=${noevPkgId} noevOne=${noevOneId} register=${regId} smoke=${smokeId} csv=${csvId}`);
  say(`register agreements: exec=${agrExec.agreementNumber} gen=${agrGen.agreementNumber} sup=${agrSup.agreementNumber}`);
  writeEvidence("fixtures", fixtures);
  writeLog("fixtures", log);
  console.log("fixtures ready");
}

main().catch((e) => {
  console.error(e);
  writeLog("fixtures-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});