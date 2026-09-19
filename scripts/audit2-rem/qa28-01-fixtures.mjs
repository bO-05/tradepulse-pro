/**
 * QA28-01 fixtures (AUDIT-QA28-* only; never touches demo / GC-AUDIT / AUDIT-5 / prior AUDIT-QA*).
 * Projects:
 *  CRED   - Div26 + Div23 + Div03(concrete) packages, zero bids initially (credit matrix)
 *  MANUAL - Div26 + Div23, both priced; Div26 bid gets a MANUAL accepted VE "VFD..." of $1,000
 *           exactly as the Bid Leveling "Add Alternate" UI writes it (tests detector truth)
 *  ZERO   - Div26 + Div23, both priced (zero-amount credit probe)
 *  OVER   - Div26 + Div23, both priced, HVAC base 500k (oversized-credit probe)
 *  AWARD  - Div26 bids A(low)/B, Div23 bid D (award/execute/void/re-award audit truth)
 */
import { client, fixtureTitle, writeEvidence, writeLog, sleep } from "./qa28-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

export async function purgeQa28() {
  const projects = (await c.query("projects:listProjects", {})) || [];
  for (const p of projects.filter((x) => x.title.startsWith("AUDIT-QA28-"))) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await c.mutation("agreements:voidExecutedAgreement", {
          agreementId: a._id,
          reason: "QA28 fixture teardown of executed record before cleanup.",
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

const deadline = () => new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);

async function makeProject({ title, budget, gc, location = "Austin, TX" }) {
  return await c.mutation("projects:createProject", {
    title,
    location,
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: budget,
    targetCompletionWeeks: 52,
    specDocumentText: `${title} automated QA28 fixture scope.`,
    isDemoProject: false,
    generalContractorName: gc,
  });
}

async function makePackage({ projectId, csi, name, budget, dl }) {
  return await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision: csi,
    tradeName: name,
    budgetEstimate: budget,
    scopeSummary: `${name} full scope per CSI ${csi} for QA28 fixtures.`,
    mandatoryInclusions: ["QA28 baseline inclusion"],
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
    licenseStatus: "Active / Verified (QA28)",
    sourceUrl: "https://qa28.example.invalid/license",
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

async function makeStandardProject(tag, hBase) {
  const id = await makeProject({ title: fixtureTitle(tag), budget: 1600000, gc: `QA28 ${tag} GC` });
  const dl = deadline();
  const p26 = await makePackage({ projectId: id, csi: "26 00 00", name: `QA28 ${tag} Electrical`, budget: 900000, dl });
  const p23 = await makePackage({ projectId: id, csi: "23 00 00", name: `QA28 ${tag} HVAC`, budget: 600000, dl });
  const c26 = await makeContractor({ pkgId: p26, name: `AUDIT-QA28 ${tag} Electric`, email: `estimating@qa28-${tag.toLowerCase()}-e.invalid`, license: `TX-QA28-${tag}-E` });
  const c23 = await makeContractor({ pkgId: p23, name: `AUDIT-QA28 ${tag} Mechanical`, email: `estimating@qa28-${tag.toLowerCase()}-m.invalid`, license: `TX-QA28-${tag}-M` });
  const b26 = await makeBid({ pkgId: p26, contractorId: c26, name: `AUDIT-QA28 ${tag} Electric`, base: 800000 });
  const b23 = await makeBid({ pkgId: p23, contractorId: c23, name: `AUDIT-QA28 ${tag} Mechanical`, base: hBase });
  return { id, p26, p23, c26, c23, b26, b23 };
}

async function main() {
  await purgeQa28();
  const dl = deadline();
  const state = { createdAt: new Date().toISOString(), deadlines: { plus20: dl } };

  // ---------- CRED: no bids; three priced-capable packages ----------
  const credId = await makeProject({ title: fixtureTitle("CRED"), budget: 1700000, gc: "QA28 Credit GC" });
  const credP26 = await makePackage({ projectId: credId, csi: "26 00 00", name: "QA28 CRED Electrical", budget: 900000, dl });
  const credP23 = await makePackage({ projectId: credId, csi: "23 00 00", name: "QA28 CRED HVAC", budget: 600000, dl });
  const credP03 = await makePackage({ projectId: credId, csi: "03 30 00", name: "QA28 CRED Concrete", budget: 250000, dl });
  const credC26 = await makeContractor({ pkgId: credP26, name: "AUDIT-QA28 CRED Electric", email: "estimating@qa28-cred-e.invalid", license: "TX-QA28-CR-E" });
  const credC23 = await makeContractor({ pkgId: credP23, name: "AUDIT-QA28 CRED Mechanical", email: "estimating@qa28-cred-m.invalid", license: "TX-QA28-CR-M" });
  const credC03 = await makeContractor({ pkgId: credP03, name: "AUDIT-QA28 CRED Concrete", email: "estimating@qa28-cred-c.invalid", license: "TX-QA28-CR-C" });
  state.cred = { id: credId, p26: credP26, p23: credP23, p03: credP03, contractors: { c26: credC26, c23: credC23, c03: credC03 } };

  // ---------- ZERO / OVER: both priced ----------
  state.zero = await makeStandardProject("ZERO", 480000);
  state.over = await makeStandardProject("OVER", 500000);

  // ---------- MANUAL: both priced; add manual VFD VE post-bid (UI Add Alternate path) ----------
  const manualId = await makeProject({ title: fixtureTitle("MANUAL"), budget: 1600000, gc: "QA28 Manual GC" });
  const mP26 = await makePackage({ projectId: manualId, csi: "26 00 00", name: "QA28 MANUAL Electrical", budget: 900000, dl });
  const mP23 = await makePackage({ projectId: manualId, csi: "23 00 00", name: "QA28 MANUAL HVAC", budget: 600000, dl });
  const mC26 = await makeContractor({ pkgId: mP26, name: "AUDIT-QA28 MANUAL Electric", email: "estimating@qa28-manual-e.invalid", license: "TX-QA28-M-E" });
  const mC23 = await makeContractor({ pkgId: mP23, name: "AUDIT-QA28 MANUAL Mechanical", email: "estimating@qa28-manual-m.invalid", license: "TX-QA28-M-M" });
  const mB26 = await makeBid({ pkgId: mP26, contractorId: mC26, name: "AUDIT-QA28 MANUAL Electric", base: 780000 });
  const mB23 = await makeBid({ pkgId: mP23, contractorId: mC23, name: "AUDIT-QA28 MANUAL Mechanical", base: 470000 });
  // exactly what the UI "Add Alternate" + Save Adjustments writes (accepted: true)
  const mAdjust = await c.mutation("bids:updateBidAdjustments", {
    bidId: mB26.bidId,
    identifiedExclusions: [],
    valueEngineeringAlternates: [
      { description: "VFD factory pricing credit (manual entry)", costDeduct: 1000, isAccepted: true },
    ],
    leadTimePenalty: 0,
    coiPenalty: 0,
  });
  state.manual = {
    id: manualId, p26: mP26, p23: mP23,
    contractors: { c26: mC26, c23: mC23 }, bids: { b26: mB26, b23: mB23 }, adjustLeveled: mAdjust.leveledTotalCost,
  };

  // ---------- AWARD ----------
  const awardId = await makeProject({ title: fixtureTitle("AWARD"), budget: 1400000, gc: "QA28 Award GC", location: "Denver, CO" });
  const aP26 = await makePackage({ projectId: awardId, csi: "26 00 00", name: "QA28 AWARD Electrical", budget: 900000, dl });
  const aP23 = await makePackage({ projectId: awardId, csi: "23 00 00", name: "QA28 AWARD HVAC", budget: 500000, dl });
  const aC26A = await makeContractor({ pkgId: aP26, name: "AUDIT-QA28 AWARD Electric A", email: "estimating@qa28-award-a.invalid", license: "CO-QA28-AA" });
  const aC26B = await makeContractor({ pkgId: aP26, name: "AUDIT-QA28 AWARD Electric B", email: "estimating@qa28-award-b.invalid", license: "CO-QA28-AB" });
  const aC23D = await makeContractor({ pkgId: aP23, name: "AUDIT-QA28 AWARD Mechanical D", email: "estimating@qa28-award-d.invalid", license: "CO-QA28-AD" });
  const aBidA = await makeBid({ pkgId: aP26, contractorId: aC26A, name: "AUDIT-QA28 AWARD Electric A", base: 700000 });
  const aBidB = await makeBid({
    pkgId: aP26, contractorId: aC26B, name: "AUDIT-QA28 AWARD Electric B", base: 660000,
    exclusions: [{ description: "QA28 switchgear excluded", costImpact: 40000, severity: "critical" }],
  });
  const aBidD = await makeBid({ pkgId: aP23, contractorId: aC23D, name: "AUDIT-QA28 AWARD Mechanical D", base: 470000 });
  state.award = {
    id: awardId, p26: aP26, p23: aP23,
    contractors: { a: aC26A, b: aC26B, d: aC23D },
    bids: { a: aBidA, b: aBidB, d: aBidD },
  };

  say(`cred=${credId} zero=${state.zero.id} over=${state.over.id} manual=${manualId} award=${awardId}`);
  say(`manual p26 leveled after manual VE = ${mAdjust.leveledTotalCost} (expected 779000)`);
  writeEvidence("fixtures", state);
  writeLog("fixtures", log);
  console.log("fixtures ready");
}

main().catch((e) => {
  console.error(e);
  writeLog("fixtures-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});