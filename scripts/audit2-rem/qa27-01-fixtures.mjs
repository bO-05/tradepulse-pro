/**
 * QA27-01 fixtures (AUDIT-QA27-* only; purge touches nothing else).
 *  - CREDIT:   Div26-A priced / Div26-B unpriced / Div23 priced -> target-scoped
 *              credit evidence (FIX-NEW-60).
 *  - CLASH:    Div26 + Div23 both priced -> known-clash allowlist (FIX-NEW-61)
 *              and scope-void assignment idempotency (FIX-NEW-62).
 *  - AWARD:    Div26 bid -> award/execute audit wording (FIX-NEW-63).
 *  - NOEVBIDS: Div26 + Div23, zero bids -> detect truthful zeros regression.
 *  - SMOKE:    p1 Electrical (executed + losing bid) -> executed immutability,
 *              inline confirm errors, print popup; p2 Plumbing -> F1 RFI,
 *              modal draft reset, deep-link package persistence.
 *  - CSV:      formula-prefixed bidder names -> export neutralization.
 *  - REGISTER: executed + generated + superseded agreements -> register rows.
 */
import { client, fixtureTitle, writeEvidence, writeLog, sleep, plusDays } from "./qa27-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const deadline = plusDays(21);

async function purgeQa27() {
  const projects = (await c.query("projects:listProjects", {})) || [];
  for (const p of projects.filter((x) => x.title.startsWith("AUDIT-QA27-"))) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await c.mutation("agreements:voidExecutedAgreement", {
          agreementId: a._id,
          reason: "QA27 fixture teardown of an executed record before cleanup.",
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
    specDocumentText: `${title} QA27 fixture scope. Divisions 03-31 coverage.`,
    isDemoProject: false,
    generalContractorName: gc,
  });
}

async function makePackage({ projectId, csi, name, budget, inclusions }) {
  return await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision: csi,
    tradeName: name,
    budgetEstimate: budget,
    scopeSummary: `${name} full scope per CSI ${csi} for QA27 fixtures.`,
    mandatoryInclusions: inclusions,
    bidDeadline: deadline,
  });
}

async function makeContractor({ pkgId, name, email, license }) {
  return await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId,
    companyName: name,
    contactEmail: email,
    phone: "+1 (206) 555-0177",
    licenseNumber: license,
    licenseStatus: "Active / Verified (QA27)",
    sourceUrl: "https://qa27.example.invalid/license",
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
  await purgeQa27();

  // ---------- CREDIT: Div26-A priced, Div26-B unpriced, Div23 priced ----------
  const credId = await makeProject({ title: fixtureTitle("CREDIT"), location: "Austin, TX", budget: 1600000, gc: "QA27 Credit GC, LLC" });
  const p26a = await makePackage({ projectId: credId, csi: "26 00 00", name: "QA27 Credit Electrical A", budget: 800000, inclusions: ["QA27 feeder testing"] });
  const p26b = await makePackage({ projectId: credId, csi: "26 01 00", name: "QA27 Credit Electrical B", budget: 300000, inclusions: ["QA27 gear labeling"] });
  const p23 = await makePackage({ projectId: credId, csi: "23 00 00", name: "QA27 Credit HVAC", budget: 500000, inclusions: ["QA27 TAB report"] });
  const c26a = await makeContractor({ pkgId: p26a, name: "AUDIT-QA27 Credit Electric A", email: "qa27.credit.a@qa27.invalid", license: "TX-QA27-CA" });
  const c26b = await makeContractor({ pkgId: p26b, name: "AUDIT-QA27 Credit Electric B", email: "qa27.credit.b@qa27.invalid", license: "TX-QA27-CB" });
  const c23 = await makeContractor({ pkgId: p23, name: "AUDIT-QA27 Credit Mechanical", email: "qa27.credit.h@qa27.invalid", license: "TX-QA27-CH" });
  const bidA = await makeBid({ pkgId: p26a, contractorId: c26a, name: "AUDIT-QA27 Credit Electric A", base: 700000 });
  const bidH = await makeBid({ pkgId: p23, contractorId: c23, name: "AUDIT-QA27 Credit Mechanical", base: 470000 });

  // ---------- CLASH: Div26 + Div23 both priced ----------
  const clashId = await makeProject({ title: fixtureTitle("CLASH"), location: "Denver, CO", budget: 1500000, gc: "QA27 Clash GC" });
  const k26 = await makePackage({ projectId: clashId, csi: "26 00 00", name: "QA27 Clash Electrical", budget: 800000, inclusions: ["QA27 temp power"] });
  const k23 = await makePackage({ projectId: clashId, csi: "23 00 00", name: "QA27 Clash HVAC", budget: 500000, inclusions: ["QA27 crane pick"] });
  const k26c = await makeContractor({ pkgId: k26, name: "AUDIT-QA27 Clash Electric", email: "qa27.clash.e@qa27.invalid", license: "CO-QA27-KE" });
  const k23c = await makeContractor({ pkgId: k23, name: "AUDIT-QA27 Clash Mechanical", email: "qa27.clash.h@qa27.invalid", license: "CO-QA27-KH" });
  const k26bid = await makeBid({ pkgId: k26, contractorId: k26c, name: "AUDIT-QA27 Clash Electric", base: 760000 });
  const k23bid = await makeBid({ pkgId: k23, contractorId: k23c, name: "AUDIT-QA27 Clash Mechanical", base: 480000 });

  // ---------- AWARD: Div26 bid for audit-wording checks ----------
  const awardId = await makeProject({ title: fixtureTitle("AWARD"), location: "Boise, ID", budget: 900000, gc: "QA27 Award GC" });
  const w26 = await makePackage({ projectId: awardId, csi: "26 00 00", name: "QA27 Award Electrical", budget: 600000, inclusions: ["QA27 panel schedules"] });
  const w26c = await makeContractor({ pkgId: w26, name: "AUDIT-QA27 Award Electric", email: "qa27.award.e@qa27.invalid", license: "ID-QA27-WE" });
  const w26bid = await makeBid({ pkgId: w26, contractorId: w26c, name: "AUDIT-QA27 Award Electric", base: 550000 });

  // ---------- NOEVBIDS: two trades, zero bids ----------
  const noevId = await makeProject({ title: fixtureTitle("NOEVBIDS"), location: "Tulsa, OK", budget: 650000, gc: "QA27 No-Bid GC" });
  await makePackage({ projectId: noevId, csi: "26 00 00", name: "QA27 NOEVBIDS Electrical", budget: 350000, inclusions: ["QA27 feeder testing"] });
  await makePackage({ projectId: noevId, csi: "23 00 00", name: "QA27 NOEVBIDS HVAC", budget: 300000, inclusions: ["QA27 TAB report"] });

  // ---------- SMOKE: p1 executed + losing bid; p2 RFI / modal / deep-link ----------
  const smokeId = await makeProject({ title: fixtureTitle("SMOKE"), location: "Denver, CO", budget: 4000000, gc: "QA27 Mile High GC, Inc" });
  const sP1 = await makePackage({ projectId: smokeId, csi: "26 00 00", name: "QA27 SMOKE Electrical", budget: 800000, inclusions: ["QA27 feeder testing"] });
  const sP1A = await makeContractor({ pkgId: sP1, name: "AUDIT-QA27 SMOKE Alpha Electric", email: "qa27.smoke.alpha@qa27.invalid", license: "CO-QA27-S1A" });
  const sP1B = await makeContractor({ pkgId: sP1, name: "AUDIT-QA27 SMOKE Beta Electric", email: "qa27.smoke.beta@qa27.invalid", license: "CO-QA27-S1B" });
  const sP1BidA = await makeBid({ pkgId: sP1, contractorId: sP1A, name: "AUDIT-QA27 SMOKE Alpha Electric", base: 500000 });
  const sP1BidB = await makeBid({ pkgId: sP1, contractorId: sP1B, name: "AUDIT-QA27 SMOKE Beta Electric", base: 520000 });
  const sP1Agr = await c.mutation("agreements:generateAgreement", { bidId: sP1BidA.bidId, tradePackageId: sP1 });
  await c.mutation("agreements:executeAgreement", { agreementId: sP1Agr._id });

  const sP2 = await makePackage({ projectId: smokeId, csi: "22 00 00", name: "QA27 SMOKE Plumbing", budget: 300000, inclusions: ["QA27 triplex pump commissioning"] });
  const sP2A = await makeContractor({ pkgId: sP2, name: "AUDIT-QA27 SMOKE Plumbing One", email: "qa27.smoke.p1@qa27.invalid", license: "CO-QA27-S2A" });
  const sP2B = await makeContractor({ pkgId: sP2, name: "AUDIT-QA27 SMOKE Plumbing Two", email: "qa27.smoke.p2@qa27.invalid", license: "CO-QA27-S2B" });
  const sP2Bid = await makeBid({ pkgId: sP2, contractorId: sP2A, name: "AUDIT-QA27 SMOKE Plumbing One", base: 280000 });

  // ---------- CSV: formula-prefixed bidder names ----------
  const csvId = await makeProject({ title: fixtureTitle("CSV"), location: "Miami, FL", budget: 900000, gc: "QA27 Gulf GC" });
  const csvPkg = await makePackage({ projectId: csvId, csi: "26 00 00", name: "QA27 CSV Electrical", budget: 400000, inclusions: ["QA27 panel schedules"] });
  const csvA = await makeContractor({ pkgId: csvPkg, name: "=1+1", email: "qa27.csv.a@qa27.invalid", license: "FL-QA27-C1" });
  const csvB = await makeContractor({ pkgId: csvPkg, name: "@SUM(1+1)", email: "qa27.csv.b@qa27.invalid", license: "FL-QA27-C2" });
  const csvBidA = await makeBid({ pkgId: csvPkg, contractorId: csvA, name: "=1+1", base: 380000 });
  const csvBidB = await makeBid({ pkgId: csvPkg, contractorId: csvB, name: "@SUM(1+1)", base: 360000 });

  // ---------- REGISTER: executed + generated + superseded ----------
  const regId = await makeProject({ title: fixtureTitle("REGISTER"), location: "Miami, FL", budget: 1800000, gc: "QA27 Register GC" });
  const rExec = await makePackage({ projectId: regId, csi: "26 00 00", name: "QA27 Register Electrical", budget: 700000, inclusions: ["QA27 panel schedules"] });
  const rGen = await makePackage({ projectId: regId, csi: "23 00 00", name: "QA27 Register HVAC", budget: 500000, inclusions: ["QA27 TAB report"] });
  const rSup = await makePackage({ projectId: regId, csi: "25 00 00", name: "QA27 Register Controls", budget: 300000, inclusions: ["QA27 controls programming"] });
  const rExecC = await makeContractor({ pkgId: rExec, name: "AUDIT-QA27 Register Electric", email: "qa27.reg.e@qa27.invalid", license: "FL-QA27-RE" });
  const rGenC = await makeContractor({ pkgId: rGen, name: "AUDIT-QA27 Register Mechanical", email: "qa27.reg.h@qa27.invalid", license: "FL-QA27-RH" });
  const rSupC = await makeContractor({ pkgId: rSup, name: "AUDIT-QA27 Register Controls", email: "qa27.reg.c@qa27.invalid", license: "FL-QA27-RC" });
  const rExecBid = await makeBid({ pkgId: rExec, contractorId: rExecC, name: "AUDIT-QA27 Register Electric", base: 700000 });
  const rGenBid = await makeBid({ pkgId: rGen, contractorId: rGenC, name: "AUDIT-QA27 Register Mechanical", base: 400000 });
  const rSupBid = await makeBid({ pkgId: rSup, contractorId: rSupC, name: "AUDIT-QA27 Register Controls", base: 200000 });
  const agrExec = await c.mutation("agreements:generateAgreement", { bidId: rExecBid.bidId, tradePackageId: rExec });
  await c.mutation("agreements:executeAgreement", { agreementId: agrExec._id });
  const agrGen = await c.mutation("agreements:generateAgreement", { bidId: rGenBid.bidId, tradePackageId: rGen });
  const agrSup = await c.mutation("agreements:generateAgreement", { bidId: rSupBid.bidId, tradePackageId: rSup });
  await c.mutation("agreements:executeAgreement", { agreementId: agrSup._id });
  await c.mutation("agreements:voidExecutedAgreement", {
    agreementId: agrSup._id,
    reason: "QA27 register fixture: execution recorded against a superseded scope, voided for replacement.",
  });

  await sleep(400);

  const fixtures = {
    createdAt: new Date().toISOString(),
    credit: {
      id: credId,
      p26a: { id: p26a, contractor: c26a, bidId: bidA.bidId },
      p26b: { id: p26b, contractor: c26b },
      p23: { id: p23, contractor: c23, bidId: bidH.bidId },
    },
    clash: {
      id: clashId,
      p26: { id: k26, contractor: k26c, bidId: k26bid.bidId },
      p23: { id: k23, contractor: k23c, bidId: k23bid.bidId },
    },
    award: { id: awardId, p26: { id: w26, contractor: w26c, bidId: w26bid.bidId } },
    noevBids: { id: noevId },
    smoke: {
      id: smokeId,
      p1: { id: sP1, contractors: { alpha: sP1A, beta: sP1B }, bids: { alpha: sP1BidA.bidId, beta: sP1BidB.bidId }, agreementId: sP1Agr._id },
      p2: { id: sP2, contractors: { one: sP2A, two: sP2B }, bidId: sP2Bid.bidId },
    },
    csv: { id: csvId, packageId: csvPkg, contractors: { a: csvA, b: csvB }, bids: { a: csvBidA.bidId, b: csvBidB.bidId } },
    register: {
      id: regId,
      pExec: { id: rExec, contractor: rExecC, bidId: rExecBid.bidId, agreementId: agrExec._id, agreementNumber: agrExec.agreementNumber },
      pGen: { id: rGen, contractor: rGenC, bidId: rGenBid.bidId, agreementId: agrGen._id, agreementNumber: agrGen.agreementNumber },
      pSup: { id: rSup, contractor: rSupC, bidId: rSupBid.bidId, agreementId: agrSup._id, agreementNumber: agrSup.agreementNumber },
    },
    dates: { plus21: deadline },
  };
  say(`credit=${credId} clash=${clashId} award=${awardId} noev=${noevId} smoke=${smokeId} csv=${csvId} register=${regId}`);
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