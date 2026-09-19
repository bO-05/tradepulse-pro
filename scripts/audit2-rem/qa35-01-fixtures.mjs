/**
 * QA35-01 fixtures (AUDIT-QA35-* only; never touches demo / GC-AUDIT / AUDIT-5-* / other AUDIT-QA*).
 * Projects (all backend-created unless noted):
 *  FIXEQ   - 26(800k) + 23(480k) with an accepted manual VFD credit $26,500 -> BOTH clash
 *            redundancies collapse to exactly $12,000 (equal-amount collision, backend+UI fix pass).
 *  LEGACY  - 26(800k) + 23(480k); used for the synthetic legacy-format credit recognition probe.
 *  REG     - 26 with two bids 800k/780k + 23(480k): register/executed-immutability checks.
 *  SMOKE   - p1 Electrical executed (alpha awarded, beta losing) + p2 Plumbing two contractors
 *            one bid (F1 RFI, modal reset, print, deep-link, inline confirm).
 *  CSV     - formula-prefixed bidder names "=1+1" / "@SUM(1+1)" (CSV neutralization).
 *  NOEV    - Div26 + Div23 packages, zero bids (truthful empty detect).
 *  NOEVONE - Div26 package only, zero bids (one-sided empty detect).
 *  NOEVNOPKG- project with no packages (no-evidence empty detect).
 * JOURNEY is created through the UI by qa35-05.
 */
import { client, fixtureTitle, writeEvidence, writeLog, sleep, plusDays } from "./qa35-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const dl = plusDays(21);
const SAFE_INC = "All labor and materials per plans and specifications per CSI scope";

export async function purgeQa35(cx = c) {
  const projects = (await cx.query("projects:listProjects", {})) || [];
  for (const p of projects.filter((x) => x.title.startsWith("AUDIT-QA35-"))) {
    const agrs = (await cx.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await cx.mutation("agreements:voidExecutedAgreement", {
          agreementId: a._id,
          reason: "QA35 fixture teardown of executed record before cleanup.",
        });
      } catch (err) {
        say(`purge void ${a.agreementNumber} failed: ${err?.data ?? err?.message}`);
      }
    }
    try {
      await cx.mutation("projects:deleteProject", { projectId: p._id });
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
    specDocumentText: `${title} automated QA35 fixture scope.`,
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
    scopeSummary: `${name} full scope per CSI ${csi} for QA35 fixtures.`,
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
    licenseStatus: "Active / Verified (QA35)",
    sourceUrl: "https://qa35.example.invalid/license",
    rfqStatus: "invited",
  });
}

async function makeBid({ pkgId, contractorId, name, base, exclusions = [], ve = [] }) {
  const res = await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkgId,
    contractorId,
    subcontractorName: name,
    baseBidAmount: base,
    identifiedExclusions: exclusions,
    valueEngineeringAlternates: ve,
    longLeadEquipmentWeeks: 8,
    leadTimePenalty: 0,
    coiComplianceStatus: "compliant",
    coiPenalty: 0,
  });
  return { bidId: res.bidId, leveled: res.leveledTotalCost, base };
}

async function pair({ tag, hBase = 480000, twoHvacBids = false, twoElecBids = false }) {
  const id = await makeProject({ title: fixtureTitle(tag), budget: 1600000, gc: `QA35 ${tag} GC` });
  const p26 = await makePackage({ projectId: id, csi: "26 00 00", name: `QA35 ${tag} Electrical`, budget: 900000 });
  const p23 = await makePackage({ projectId: id, csi: "23 00 00", name: `QA35 ${tag} HVAC`, budget: 600000 });
  const c26 = await makeContractor({ pkgId: p26, name: `AUDIT-QA35 ${tag} Electric`, email: `estimating@qa35-${tag.toLowerCase()}-e.invalid`, license: `TX-QA35-${tag}-E` });
  const c23 = await makeContractor({ pkgId: p23, name: `AUDIT-QA35 ${tag} Mechanical`, email: `estimating@qa35-${tag.toLowerCase()}-m.invalid`, license: `TX-QA35-${tag}-M` });
  const b26 = await makeBid({ pkgId: p26, contractorId: c26, name: `AUDIT-QA35 ${tag} Electric`, base: 800000 });
  const b23 = await makeBid({ pkgId: p23, contractorId: c23, name: `AUDIT-QA35 ${tag} Mechanical`, base: hBase });
  let c23b = null, b23b = null, c26b = null, b26b = null;
  if (twoHvacBids) {
    c23b = await makeContractor({ pkgId: p23, name: `AUDIT-QA35 ${tag} Mechanical Alt`, email: `estimating@qa35-${tag.toLowerCase()}-m2.invalid`, license: `TX-QA35-${tag}-M2` });
    b23b = await makeBid({ pkgId: p23, contractorId: c23b, name: `AUDIT-QA35 ${tag} Mechanical Alt`, base: 497000 });
  }
  if (twoElecBids) {
    c26b = await makeContractor({ pkgId: p26, name: `AUDIT-QA35 ${tag} Electric Alt`, email: `estimating@qa35-${tag.toLowerCase()}-e2.invalid`, license: `TX-QA35-${tag}-E2` });
    b26b = await makeBid({ pkgId: p26, contractorId: c26b, name: `AUDIT-QA35 ${tag} Electric Alt`, base: 780000 });
  }
  return { id, p26, p23, c26, c23, c23b, c26b, b26, b23, b23b, b26b };
}

async function main() {
  await purgeQa35();
  const state = { createdAt: new Date().toISOString(), prefix: "AUDIT-QA35-" };

  // ---------- equal-amount collision fixture (backend + UI fix pass) ----------
  state.eq = await pair({ tag: "FIXEQ" });
  const eqAdjust = await c.mutation("bids:updateBidAdjustments", {
    bidId: state.eq.b23.bidId,
    identifiedExclusions: [],
    valueEngineeringAlternates: [{ description: "VFD factory pricing credit (manual entry)", costDeduct: 26500, isAccepted: true }],
    leadTimePenalty: 0,
    coiPenalty: 0,
  });
  state.eq.manualLeveled = eqAdjust.leveledTotalCost;

  // ---------- legacy-format probe fixture ----------
  state.legacy = await pair({ tag: "LEGACY" });

  // ---------- register fixture (executed immutability) ----------
  state.reg = await pair({ tag: "REG", twoElecBids: true });

  // ---------- SMOKE regression (executed p1 + plumbing p2) ----------
  {
    const smokeId = await makeProject({ title: fixtureTitle("SMOKE"), budget: 4000000, gc: "QA35 Mile High GC, Inc", location: "Denver, CO" });
    const sP1 = await makePackage({ projectId: smokeId, csi: "26 00 00", name: "QA35 SMOKE Electrical", budget: 800000 });
    const sP1A = await makeContractor({ pkgId: sP1, name: "AUDIT-QA35 SMOKE Alpha Electric", email: "qa35.smoke.alpha@qa35.invalid", license: "CO-QA35-S1A" });
    const sP1B = await makeContractor({ pkgId: sP1, name: "AUDIT-QA35 SMOKE Beta Electric", email: "qa35.smoke.beta@qa35.invalid", license: "CO-QA35-S1B" });
    const sP1BidA = await makeBid({ pkgId: sP1, contractorId: sP1A, name: "AUDIT-QA35 SMOKE Alpha Electric", base: 500000 });
    const sP1BidB = await makeBid({ pkgId: sP1, contractorId: sP1B, name: "AUDIT-QA35 SMOKE Beta Electric", base: 520000 });
    const sP1Agr = await c.mutation("agreements:generateAgreement", { bidId: sP1BidA.bidId, tradePackageId: sP1 });
    await c.mutation("agreements:executeAgreement", { agreementId: sP1Agr._id });
    const sP2 = await makePackage({ projectId: smokeId, csi: "22 00 00", name: "QA35 SMOKE Plumbing", budget: 300000 });
    const sP2A = await makeContractor({ pkgId: sP2, name: "AUDIT-QA35 SMOKE Plumbing One", email: "qa35.smoke.p1@qa35.invalid", license: "CO-QA35-S2A" });
    const sP2B = await makeContractor({ pkgId: sP2, name: "AUDIT-QA35 SMOKE Plumbing Two", email: "qa35.smoke.p2@qa35.invalid", license: "CO-QA35-S2B" });
    const sP2Bid = await makeBid({ pkgId: sP2, contractorId: sP2A, name: "AUDIT-QA35 SMOKE Plumbing One", base: 280000 });
    state.smoke = {
      id: smokeId,
      p1: { id: sP1, contractors: { alpha: sP1A, beta: sP1B }, bids: { alpha: sP1BidA.bidId, beta: sP1BidB.bidId }, agreementId: sP1Agr._id, agreementNumber: sP1Agr.agreementNumber },
      p2: { id: sP2, contractors: { one: sP2A, two: sP2B }, bidId: sP2Bid.bidId },
    };
  }

  // ---------- CSV regression ----------
  {
    const csvId = await makeProject({ title: fixtureTitle("CSV"), budget: 900000, gc: "QA35 Gulf GC", location: "Miami, FL" });
    const csvPkg = await makePackage({ projectId: csvId, csi: "26 00 00", name: "QA35 CSV Electrical", budget: 400000 });
    const csvA = await makeContractor({ pkgId: csvPkg, name: "=1+1", email: "qa35.csv.a@qa35.invalid", license: "FL-QA35-C1" });
    const csvB = await makeContractor({ pkgId: csvPkg, name: "@SUM(1+1)", email: "qa35.csv.b@qa35.invalid", license: "FL-QA35-C2" });
    const csvBidA = await makeBid({ pkgId: csvPkg, contractorId: csvA, name: "=1+1", base: 380000 });
    const csvBidB = await makeBid({ pkgId: csvPkg, contractorId: csvB, name: "@SUM(1+1)", base: 360000 });
    state.csv = { id: csvId, packageId: csvPkg, contractors: { a: csvA, b: csvB }, bids: { a: csvBidA.bidId, b: csvBidB.bidId } };
  }

  // ---------- no-evidence projects ----------
  {
    const noevId = await makeProject({ title: fixtureTitle("NOEV"), budget: 650000, gc: "QA35 No-Bid GC", location: "Tulsa, OK" });
    await makePackage({ projectId: noevId, csi: "26 00 00", name: "QA35 NOEV Electrical", budget: 350000 });
    await makePackage({ projectId: noevId, csi: "23 00 00", name: "QA35 NOEV HVAC", budget: 300000 });
    state.noev = { id: noevId };

    const oneId = await makeProject({ title: fixtureTitle("NOEVONE"), budget: 500000, gc: "QA35 One-Sided GC", location: "Tulsa, OK" });
    await makePackage({ projectId: oneId, csi: "26 00 00", name: "QA35 NOEVONE Electrical", budget: 350000 });
    state.noevOne = { id: oneId };

    state.noevNoPkg = { id: await makeProject({ title: fixtureTitle("NOEVNOPKG"), budget: 400000, gc: "QA35 Empty GC", location: "Tulsa, OK" }) };
  }

  say(`eq=${state.eq.id} legacy=${state.legacy.id} reg=${state.reg.id}`);
  say(`smoke=${state.smoke.id} csv=${state.csv.id}`);
  say(`noev=${state.noev.id} noevOne=${state.noevOne.id} noevNoPkg=${state.noevNoPkg.id}`);
  writeEvidence("fixtures", state);
  writeLog("fixtures", log);
  console.log("fixtures ready");
}

main().catch((e) => {
  console.error(e);
  writeLog("fixtures-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});