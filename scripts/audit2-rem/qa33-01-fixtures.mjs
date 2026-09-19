/**
 * QA33-01 fixtures (AUDIT-QA33-* only; never touches demo / GC-AUDIT / AUDIT-5-* / other AUDIT-QA*).
 * Projects:
 *  MB     - Div26(800k) + Div23 two bids B1(480k)/B2(497k) (A32-01 carrier reversal, backend)
 *  MBUI   - same shape, reserved for the A32-01 UI reverse-from-card pass
 *  STALE  - Div26(800k) + Div23(480k) (A32-02 stale record clear, backend)
 *  STALEUI- same shape, reserved for the A32-02/A31-05 UI pass
 *  SMOKE  - p1 Electrical executed (alpha awarded, beta losing) + p2 Plumbing two
 *           contractors one bid (F1 RFI, inline confirm, modal reset, deep-link, print)
 *  CSV    - formula-prefixed bidder names "=1+1" / "@SUM(1+1)" (CSV neutralization)
 *  REGISTER - executed + generated + superseded agreements (superseded register row)
 *  NOEV     - Div26 + Div23 packages, zero bids (truthful empty detect)
 *  NOEVONE  - Div26 package only, zero bids (one-sided empty detect)
 *  NOEVNOPKG- project with no packages (no-evidence empty detect)
 */
import { client, fixtureTitle, writeEvidence, writeLog, sleep, plusDays } from "./qa33-lib.mjs";
import { pathToFileURL } from "node:url";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const dl = plusDays(21);
const SAFE_INC = "All labor and materials per plans and specifications per CSI scope";

export async function purgeTitle(title, cx = c) {
  const projects = (await cx.query("projects:listProjects", {})) || [];
  for (const p of projects.filter((x) => x.title === title)) {
    const agrs = (await cx.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await cx.mutation("agreements:voidExecutedAgreement", {
          agreementId: a._id,
          reason: "QA33 fixture teardown of executed record before cleanup.",
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

/** Delete and recreate a single AUDIT-QA33-* pair project for a deterministic scenario start. */
export async function rebuildPair(tag, { twoHvacBids = false } = {}) {
  await purgeTitle(fixtureTitle(tag));
  return await pair({ tag, twoHvacBids });
}

export async function purgeQa33(cx = c) {
  const projects = (await cx.query("projects:listProjects", {})) || [];
  for (const p of projects.filter((x) => x.title.startsWith("AUDIT-QA33-"))) {
    const agrs = (await cx.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await cx.mutation("agreements:voidExecutedAgreement", {
          agreementId: a._id,
          reason: "QA33 fixture teardown of executed record before cleanup.",
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
    specDocumentText: `${title} automated QA33 fixture scope.`,
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
    scopeSummary: `${name} full scope per CSI ${csi} for QA33 fixtures.`,
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
    licenseStatus: "Active / Verified (QA33)",
    sourceUrl: "https://qa33.example.invalid/license",
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

async function pair({ tag, twoHvacBids = false }) {
  const id = await makeProject({ title: fixtureTitle(tag), budget: 1600000, gc: `QA33 ${tag} GC` });
  const p26 = await makePackage({ projectId: id, csi: "26 00 00", name: `QA33 ${tag} Electrical`, budget: 900000 });
  const p23 = await makePackage({ projectId: id, csi: "23 00 00", name: `QA33 ${tag} HVAC`, budget: 600000 });
  const c26 = await makeContractor({ pkgId: p26, name: `AUDIT-QA33 ${tag} Electric`, email: `estimating@qa33-${tag.toLowerCase()}-e.invalid`, license: `TX-QA33-${tag}-E` });
  const c23 = await makeContractor({ pkgId: p23, name: `AUDIT-QA33 ${tag} Mechanical`, email: `estimating@qa33-${tag.toLowerCase()}-m.invalid`, license: `TX-QA33-${tag}-M` });
  const b26 = await makeBid({ pkgId: p26, contractorId: c26, name: `AUDIT-QA33 ${tag} Electric`, base: 800000 });
  const b23 = await makeBid({ pkgId: p23, contractorId: c23, name: `AUDIT-QA33 ${tag} Mechanical`, base: 480000 });
  let c23b = null;
  let b23b = null;
  if (twoHvacBids) {
    c23b = await makeContractor({ pkgId: p23, name: `AUDIT-QA33 ${tag} Mechanical Alt`, email: `estimating@qa33-${tag.toLowerCase()}-m2.invalid`, license: `TX-QA33-${tag}-M2` });
    b23b = await makeBid({ pkgId: p23, contractorId: c23b, name: `AUDIT-QA33 ${tag} Mechanical Alt`, base: 497000 });
  }
  return { id, p26, p23, c26, c23, c23b, b26, b23, b23b };
}

async function main() {
  await purgeQa33();
  const state = { createdAt: new Date().toISOString(), prefix: "AUDIT-QA33-" };

  // ---------- A32-01 carrier reversal (backend + UI) ----------
  state.mb = await pair({ tag: "MB", twoHvacBids: true });
  state.mbui = await pair({ tag: "MBUI", twoHvacBids: true });

  // ---------- A32-02 stale credit clear (backend + UI) ----------
  state.stale = await pair({ tag: "STALE" });
  state.staleui = await pair({ tag: "STALEUI" });

  // ---------- SMOKE regression ----------
  {
    const smokeId = await makeProject({ title: fixtureTitle("SMOKE"), budget: 4000000, gc: "QA33 Mile High GC, Inc" });
    const sP1 = await makePackage({ projectId: smokeId, csi: "26 00 00", name: "QA33 SMOKE Electrical", budget: 800000 });
    const sP1A = await makeContractor({ pkgId: sP1, name: "AUDIT-QA33 SMOKE Alpha Electric", email: "qa33.smoke.alpha@qa33.invalid", license: "CO-QA33-S1A" });
    const sP1B = await makeContractor({ pkgId: sP1, name: "AUDIT-QA33 SMOKE Beta Electric", email: "qa33.smoke.beta@qa33.invalid", license: "CO-QA33-S1B" });
    const sP1BidA = await makeBid({ pkgId: sP1, contractorId: sP1A, name: "AUDIT-QA33 SMOKE Alpha Electric", base: 500000 });
    const sP1BidB = await makeBid({ pkgId: sP1, contractorId: sP1B, name: "AUDIT-QA33 SMOKE Beta Electric", base: 520000 });
    const sP1Agr = await c.mutation("agreements:generateAgreement", { bidId: sP1BidA.bidId, tradePackageId: sP1 });
    await c.mutation("agreements:executeAgreement", { agreementId: sP1Agr._id });
    const sP2 = await makePackage({ projectId: smokeId, csi: "22 00 00", name: "QA33 SMOKE Plumbing", budget: 300000 });
    const sP2A = await makeContractor({ pkgId: sP2, name: "AUDIT-QA33 SMOKE Plumbing One", email: "qa33.smoke.p1@qa33.invalid", license: "CO-QA33-S2A" });
    const sP2B = await makeContractor({ pkgId: sP2, name: "AUDIT-QA33 SMOKE Plumbing Two", email: "qa33.smoke.p2@qa33.invalid", license: "CO-QA33-S2B" });
    const sP2Bid = await makeBid({ pkgId: sP2, contractorId: sP2A, name: "AUDIT-QA33 SMOKE Plumbing One", base: 280000 });
    state.smoke = {
      id: smokeId,
      p1: { id: sP1, contractors: { alpha: sP1A, beta: sP1B }, bids: { alpha: sP1BidA.bidId, beta: sP1BidB.bidId }, agreementId: sP1Agr._id, agreementNumber: sP1Agr.agreementNumber },
      p2: { id: sP2, contractors: { one: sP2A, two: sP2B }, bidId: sP2Bid.bidId },
    };
  }

  // ---------- CSV regression ----------
  {
    const csvId = await makeProject({ title: fixtureTitle("CSV"), budget: 900000, gc: "QA33 Gulf GC", location: "Miami, FL" });
    const csvPkg = await makePackage({ projectId: csvId, csi: "26 00 00", name: "QA33 CSV Electrical", budget: 400000 });
    const csvA = await makeContractor({ pkgId: csvPkg, name: "=1+1", email: "qa33.csv.a@qa33.invalid", license: "FL-QA33-C1" });
    const csvB = await makeContractor({ pkgId: csvPkg, name: "@SUM(1+1)", email: "qa33.csv.b@qa33.invalid", license: "FL-QA33-C2" });
    const csvBidA = await makeBid({ pkgId: csvPkg, contractorId: csvA, name: "=1+1", base: 380000 });
    const csvBidB = await makeBid({ pkgId: csvPkg, contractorId: csvB, name: "@SUM(1+1)", base: 360000 });
    state.csv = { id: csvId, packageId: csvPkg, contractors: { a: csvA, b: csvB }, bids: { a: csvBidA.bidId, b: csvBidB.bidId } };
  }

  // ---------- REGISTER regression ----------
  {
    const regId = await makeProject({ title: fixtureTitle("REGISTER"), budget: 1800000, gc: "QA33 Register GC", location: "Miami, FL" });
    const rExec = await makePackage({ projectId: regId, csi: "26 00 00", name: "QA33 Register Electrical", budget: 700000 });
    const rGen = await makePackage({ projectId: regId, csi: "23 00 00", name: "QA33 Register HVAC", budget: 500000 });
    const rSup = await makePackage({ projectId: regId, csi: "25 00 00", name: "QA33 Register Controls", budget: 300000 });
    const rExecC = await makeContractor({ pkgId: rExec, name: "AUDIT-QA33 Register Electric", email: "qa33.reg.e@qa33.invalid", license: "FL-QA33-RE" });
    const rGenC = await makeContractor({ pkgId: rGen, name: "AUDIT-QA33 Register Mechanical", email: "qa33.reg.h@qa33.invalid", license: "FL-QA33-RH" });
    const rSupC = await makeContractor({ pkgId: rSup, name: "AUDIT-QA33 Register Controls", email: "qa33.reg.c@qa33.invalid", license: "FL-QA33-RC" });
    const rExecBid = await makeBid({ pkgId: rExec, contractorId: rExecC, name: "AUDIT-QA33 Register Electric", base: 700000 });
    const rGenBid = await makeBid({ pkgId: rGen, contractorId: rGenC, name: "AUDIT-QA33 Register Mechanical", base: 400000 });
    const rSupBid = await makeBid({ pkgId: rSup, contractorId: rSupC, name: "AUDIT-QA33 Register Controls", base: 200000 });
    const agrExec = await c.mutation("agreements:generateAgreement", { bidId: rExecBid.bidId, tradePackageId: rExec });
    await c.mutation("agreements:executeAgreement", { agreementId: agrExec._id });
    const agrGen = await c.mutation("agreements:generateAgreement", { bidId: rGenBid.bidId, tradePackageId: rGen });
    const agrSup = await c.mutation("agreements:generateAgreement", { bidId: rSupBid.bidId, tradePackageId: rSup });
    await c.mutation("agreements:executeAgreement", { agreementId: agrSup._id });
    await c.mutation("agreements:voidExecutedAgreement", {
      agreementId: agrSup._id,
      reason: "QA33 register fixture: execution recorded against a superseded scope, voided for replacement.",
    });
    state.register = {
      id: regId,
      pExec: { id: rExec, contractor: rExecC, bidId: rExecBid.bidId, agreementId: agrExec._id, agreementNumber: agrExec.agreementNumber },
      pGen: { id: rGen, contractor: rGenC, bidId: rGenBid.bidId, agreementId: agrGen._id, agreementNumber: agrGen.agreementNumber },
      pSup: { id: rSup, contractor: rSupC, bidId: rSupBid.bidId, agreementId: agrSup._id, agreementNumber: agrSup.agreementNumber },
    };
  }

  // ---------- no-evidence projects ----------
  {
    const noevId = await makeProject({ title: fixtureTitle("NOEV"), budget: 650000, gc: "QA33 No-Bid GC", location: "Tulsa, OK" });
    await makePackage({ projectId: noevId, csi: "26 00 00", name: "QA33 NOEV Electrical", budget: 350000 });
    await makePackage({ projectId: noevId, csi: "23 00 00", name: "QA33 NOEV HVAC", budget: 300000 });
    state.noev = { id: noevId };

    const oneId = await makeProject({ title: fixtureTitle("NOEVONE"), budget: 500000, gc: "QA33 One-Sided GC", location: "Tulsa, OK" });
    await makePackage({ projectId: oneId, csi: "26 00 00", name: "QA33 NOEVONE Electrical", budget: 350000 });
    state.noevOne = { id: oneId };

    state.noevNoPkg = { id: await makeProject({ title: fixtureTitle("NOEVNOPKG"), budget: 400000, gc: "QA33 Empty GC", location: "Tulsa, OK" }) };
  }

  state.dates = { plus21: dl };
  say(`mb=${state.mb.id} mbui=${state.mbui.id} stale=${state.stale.id} staleui=${state.staleui.id}`);
  say(`smoke=${state.smoke.id} csv=${state.csv.id} register=${state.register.id}`);
  say(`noev=${state.noev.id} noevOne=${state.noevOne.id} noevNoPkg=${state.noevNoPkg.id}`);
  writeEvidence("fixtures", state);
  writeLog("fixtures", log);
  console.log("fixtures ready");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e);
    writeLog("fixtures-crash", [String(e?.stack ?? e)]);
    process.exit(1);
  });
}