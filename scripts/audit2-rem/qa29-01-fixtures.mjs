/**
 * QA29-01 fixtures (AUDIT-QA29-* ONLY; never touches demo / GC-AUDIT / AUDIT-5 / other AUDIT-QA*).
 * Projects created here and removed by qa29-99-cleanup:
 *  BASFALSE - Div26 + Div23 priced; inclusion "Base building general conditions allowance"
 *             (A28-01 false-positive: BAS void must stay OPEN)
 *  BASBAS   - Div26 + Div23 priced; inclusion "24V BAS control wiring ..." (true positive)
 *  BASAUTO  - Div26 + Div23 priced; inclusion "Building automation system ..." (true positive)
 *  MANUAL   - Div26 + Div23 priced; Div26 bid gets a manual accepted VE "VFD..." $1,000 (A28-02)
 *  ZERO     - Div26 + Div23 priced (A28-03 zero-value credit refusal)
 *  OVER     - Div26 + Div23 priced; HVAC base 500k (A28-04 oversized-credit ceiling)
 *  SMOKE    - p1 Electrical executed + losing bid; p2 Plumbing (regression: RFI, modal, deep-link,
 *             inline confirm, print popup)
 *  CSV      - formula-prefixed bidder names (regression: CSV neutralization)
 *  REGISTER - executed + generated + superseded agreements (regression: superseded row)
 *  NOEVBIDS - Div26 + Div23, zero bids (regression: truthful empty detect)
 */
import { client, fixtureTitle, writeEvidence, writeLog, sleep, plusDays } from "./qa29-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const dl = plusDays(21);
const SAFE_INC = "All labor and materials per plans and specifications per CSI scope";

export async function purgeQa29() {
  const projects = (await c.query("projects:listProjects", {})) || [];
  for (const p of projects.filter((x) => x.title.startsWith("AUDIT-QA29-"))) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await c.mutation("agreements:voidExecutedAgreement", {
          agreementId: a._id,
          reason: "QA29 fixture teardown of executed record before cleanup.",
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

async function makeProject({ title, budget, gc, location = "Austin, TX" }) {
  return await c.mutation("projects:createProject", {
    title,
    location,
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: budget,
    targetCompletionWeeks: 52,
    specDocumentText: `${title} automated QA29 fixture scope.`,
    isDemoProject: false,
    generalContractorName: gc,
  });
}

async function makePackage({ projectId, csi, name, budget, inclusions = [SAFE_INC] }) {
  return await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision: csi,
    tradeName: name,
    budgetEstimate: budget,
    scopeSummary: `${name} full scope per CSI ${csi} for QA29 fixtures.`,
    mandatoryInclusions: inclusions,
    bidDeadline: dl,
  });
}

async function makeContractor({ pkgId, name, email, license }) {
  return await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId,
    companyName: name,
    contactEmail: email,
    phone: "+1 (206) 555-0199",
    licenseNumber: license,
    licenseStatus: "Active / Verified (QA29)",
    sourceUrl: "https://qa29.example.invalid/license",
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

async function makeTwoTradeProject({ tag, hBase = 470000, inclusions = [SAFE_INC] }) {
  const id = await makeProject({ title: fixtureTitle(tag), budget: 1600000, gc: `QA29 ${tag} GC` });
  const p26 = await makePackage({ projectId: id, csi: "26 00 00", name: `QA29 ${tag} Electrical`, budget: 900000, inclusions });
  const p23 = await makePackage({ projectId: id, csi: "23 00 00", name: `QA29 ${tag} HVAC`, budget: 600000, inclusions });
  const c26 = await makeContractor({ pkgId: p26, name: `AUDIT-QA29 ${tag} Electric`, email: `estimating@qa29-${tag.toLowerCase()}-e.invalid`, license: `TX-QA29-${tag}-E` });
  const c23 = await makeContractor({ pkgId: p23, name: `AUDIT-QA29 ${tag} Mechanical`, email: `estimating@qa29-${tag.toLowerCase()}-m.invalid`, license: `TX-QA29-${tag}-M` });
  const b26 = await makeBid({ pkgId: p26, contractorId: c26, name: `AUDIT-QA29 ${tag} Electric`, base: 800000 });
  const b23 = await makeBid({ pkgId: p23, contractorId: c23, name: `AUDIT-QA29 ${tag} Mechanical`, base: hBase });
  return { id, p26, p23, c26, c23, b26, b23 };
}

async function main() {
  await purgeQa29();
  const state = { createdAt: new Date().toISOString(), prefix: "AUDIT-QA29-" };

  // ---------- A28-01: BAS matching ----------
  const basFalse = await makeTwoTradeProject({ tag: "BASFALSE", inclusions: ["Base building general conditions allowance"] });
  state.basFalse = basFalse;
  const basBas = await makeTwoTradeProject({ tag: "BASBAS", inclusions: ["24V BAS control wiring and DDC interlocks by Electrical"] });
  state.basBas = basBas;
  const basAuto = await makeTwoTradeProject({ tag: "BASAUTO", inclusions: ["Building automation system integration and commissioning included"] });
  state.basAuto = basAuto;

  // ---------- A28-02: MANUAL (manual accepted VFD VE on the electrical bid) ----------
  const manualId = await makeProject({ title: fixtureTitle("MANUAL"), budget: 1600000, gc: "QA29 Manual GC" });
  const mP26 = await makePackage({ projectId: manualId, csi: "26 00 00", name: "QA29 MANUAL Electrical", budget: 900000 });
  const mP23 = await makePackage({ projectId: manualId, csi: "23 00 00", name: "QA29 MANUAL HVAC", budget: 600000 });
  const mC26 = await makeContractor({ pkgId: mP26, name: "AUDIT-QA29 MANUAL Electric", email: "estimating@qa29-manual-e.invalid", license: "TX-QA29-M-E" });
  const mC23 = await makeContractor({ pkgId: mP23, name: "AUDIT-QA29 MANUAL Mechanical", email: "estimating@qa29-manual-m.invalid", license: "TX-QA29-M-M" });
  const mB26 = await makeBid({ pkgId: mP26, contractorId: mC26, name: "AUDIT-QA29 MANUAL Electric", base: 780000 });
  const mB23 = await makeBid({ pkgId: mP23, contractorId: mC23, name: "AUDIT-QA29 MANUAL Mechanical", base: 470000 });
  const mAdjust = await c.mutation("bids:updateBidAdjustments", {
    bidId: mB26.bidId,
    identifiedExclusions: [],
    valueEngineeringAlternates: [
      { description: "VFD factory pricing credit (manual entry)", costDeduct: 1000, isAccepted: true },
    ],
    leadTimePenalty: 0,
    coiPenalty: 0,
  });
  state.manual = { id: manualId, p26: mP26, p23: mP23, c26: mC26, c23: mC23, b26: mB26, b23: mB23, adjustLeveled: mAdjust.leveledTotalCost };

  // ---------- A28-03: ZERO ----------
  state.zero = await makeTwoTradeProject({ tag: "ZERO", hBase: 480000 });

  // ---------- A28-04: OVER ----------
  state.over = await makeTwoTradeProject({ tag: "OVER", hBase: 500000 });

  // ---------- SMOKE (regression) ----------
  const smokeId = await makeProject({ title: fixtureTitle("SMOKE"), budget: 4000000, gc: "QA29 Mile High GC, Inc" });
  const sP1 = await makePackage({ projectId: smokeId, csi: "26 00 00", name: "QA29 SMOKE Electrical", budget: 800000 });
  const sP1A = await makeContractor({ pkgId: sP1, name: "AUDIT-QA29 SMOKE Alpha Electric", email: "qa29.smoke.alpha@qa29.invalid", license: "CO-QA29-S1A" });
  const sP1B = await makeContractor({ pkgId: sP1, name: "AUDIT-QA29 SMOKE Beta Electric", email: "qa29.smoke.beta@qa29.invalid", license: "CO-QA29-S1B" });
  const sP1BidA = await makeBid({ pkgId: sP1, contractorId: sP1A, name: "AUDIT-QA29 SMOKE Alpha Electric", base: 500000 });
  const sP1BidB = await makeBid({ pkgId: sP1, contractorId: sP1B, name: "AUDIT-QA29 SMOKE Beta Electric", base: 520000 });
  const sP1Agr = await c.mutation("agreements:generateAgreement", { bidId: sP1BidA.bidId, tradePackageId: sP1 });
  await c.mutation("agreements:executeAgreement", { agreementId: sP1Agr._id });
  const sP2 = await makePackage({ projectId: smokeId, csi: "22 00 00", name: "QA29 SMOKE Plumbing", budget: 300000 });
  const sP2A = await makeContractor({ pkgId: sP2, name: "AUDIT-QA29 SMOKE Plumbing One", email: "qa29.smoke.p1@qa29.invalid", license: "CO-QA29-S2A" });
  const sP2B = await makeContractor({ pkgId: sP2, name: "AUDIT-QA29 SMOKE Plumbing Two", email: "qa29.smoke.p2@qa29.invalid", license: "CO-QA29-S2B" });
  const sP2Bid = await makeBid({ pkgId: sP2, contractorId: sP2A, name: "AUDIT-QA29 SMOKE Plumbing One", base: 280000 });
  state.smoke = {
    id: smokeId,
    p1: { id: sP1, contractors: { alpha: sP1A, beta: sP1B }, bids: { alpha: sP1BidA.bidId, beta: sP1BidB.bidId }, agreementId: sP1Agr._id },
    p2: { id: sP2, contractors: { one: sP2A, two: sP2B }, bidId: sP2Bid.bidId },
  };

  // ---------- CSV (regression) ----------
  const csvId = await makeProject({ title: fixtureTitle("CSV"), budget: 900000, gc: "QA29 Gulf GC", location: "Miami, FL" });
  const csvPkg = await makePackage({ projectId: csvId, csi: "26 00 00", name: "QA29 CSV Electrical", budget: 400000 });
  const csvA = await makeContractor({ pkgId: csvPkg, name: "=1+1", email: "qa29.csv.a@qa29.invalid", license: "FL-QA29-C1" });
  const csvB = await makeContractor({ pkgId: csvPkg, name: "@SUM(1+1)", email: "qa29.csv.b@qa29.invalid", license: "FL-QA29-C2" });
  const csvBidA = await makeBid({ pkgId: csvPkg, contractorId: csvA, name: "=1+1", base: 380000 });
  const csvBidB = await makeBid({ pkgId: csvPkg, contractorId: csvB, name: "@SUM(1+1)", base: 360000 });
  state.csv = { id: csvId, packageId: csvPkg, contractors: { a: csvA, b: csvB }, bids: { a: csvBidA.bidId, b: csvBidB.bidId } };

  // ---------- REGISTER (regression) ----------
  const regId = await makeProject({ title: fixtureTitle("REGISTER"), budget: 1800000, gc: "QA29 Register GC", location: "Miami, FL" });
  const rExec = await makePackage({ projectId: regId, csi: "26 00 00", name: "QA29 Register Electrical", budget: 700000 });
  const rGen = await makePackage({ projectId: regId, csi: "23 00 00", name: "QA29 Register HVAC", budget: 500000 });
  const rSup = await makePackage({ projectId: regId, csi: "25 00 00", name: "QA29 Register Controls", budget: 300000 });
  const rExecC = await makeContractor({ pkgId: rExec, name: "AUDIT-QA29 Register Electric", email: "qa29.reg.e@qa29.invalid", license: "FL-QA29-RE" });
  const rGenC = await makeContractor({ pkgId: rGen, name: "AUDIT-QA29 Register Mechanical", email: "qa29.reg.h@qa29.invalid", license: "FL-QA29-RH" });
  const rSupC = await makeContractor({ pkgId: rSup, name: "AUDIT-QA29 Register Controls", email: "qa29.reg.c@qa29.invalid", license: "FL-QA29-RC" });
  const rExecBid = await makeBid({ pkgId: rExec, contractorId: rExecC, name: "AUDIT-QA29 Register Electric", base: 700000 });
  const rGenBid = await makeBid({ pkgId: rGen, contractorId: rGenC, name: "AUDIT-QA29 Register Mechanical", base: 400000 });
  const rSupBid = await makeBid({ pkgId: rSup, contractorId: rSupC, name: "AUDIT-QA29 Register Controls", base: 200000 });
  const agrExec = await c.mutation("agreements:generateAgreement", { bidId: rExecBid.bidId, tradePackageId: rExec });
  await c.mutation("agreements:executeAgreement", { agreementId: agrExec._id });
  const agrGen = await c.mutation("agreements:generateAgreement", { bidId: rGenBid.bidId, tradePackageId: rGen });
  const agrSup = await c.mutation("agreements:generateAgreement", { bidId: rSupBid.bidId, tradePackageId: rSup });
  await c.mutation("agreements:executeAgreement", { agreementId: agrSup._id });
  await c.mutation("agreements:voidExecutedAgreement", {
    agreementId: agrSup._id,
    reason: "QA29 register fixture: execution recorded against a superseded scope, voided for replacement.",
  });
  state.register = {
    id: regId,
    pExec: { id: rExec, contractor: rExecC, bidId: rExecBid.bidId, agreementId: agrExec._id, agreementNumber: agrExec.agreementNumber },
    pGen: { id: rGen, contractor: rGenC, bidId: rGenBid.bidId, agreementId: agrGen._id, agreementNumber: agrGen.agreementNumber },
    pSup: { id: rSup, contractor: rSupC, bidId: rSupBid.bidId, agreementId: agrSup._id, agreementNumber: agrSup.agreementNumber },
  };

  // ---------- NOEVBIDS (regression) ----------
  const noevId = await makeProject({ title: fixtureTitle("NOEVBIDS"), budget: 650000, gc: "QA29 No-Bid GC", location: "Tulsa, OK" });
  await makePackage({ projectId: noevId, csi: "26 00 00", name: "QA29 NOEVBIDS Electrical", budget: 350000 });
  await makePackage({ projectId: noevId, csi: "23 00 00", name: "QA29 NOEVBIDS HVAC", budget: 300000 });
  state.noevBids = { id: noevId };

  state.dates = { plus21: dl };
  say(`basFalse=${basFalse.id} basBas=${basBas.id} basAuto=${basAuto.id} manual=${manualId} zero=${state.zero.id} over=${state.over.id}`);
  say(`smoke=${smokeId} csv=${csvId} register=${regId} noev=${noevId}`);
  say(`manual p26 leveled after manual VFD VE = ${mAdjust.leveledTotalCost} (expected 779000)`);
  writeEvidence("fixtures", state);
  writeLog("fixtures", log);
  console.log("fixtures ready");
}

main().catch((e) => {
  console.error(e);
  writeLog("fixtures-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});