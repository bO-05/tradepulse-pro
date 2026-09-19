/**
 * QA21-01 fixtures (AUDIT-QA21-* only; purge touches nothing else):
 *  - AUDIT-QA21-NOHVAC : Div 26 package + 1 bid (no Div 23) -> scan prerequisite.
 *  - AUDIT-QA21-NOBIDS : Div 26 + Div 23 packages, zero bids -> scan prerequisite.
 *  - AUDIT-QA21-FULL   : Div 26 + Div 23, 1 bid each -> scan computed summary.
 *  - AUDIT-QA21-LIFE   : Div 26, 2 bidders/bids, Alpha awarded + execution recorded
 *                        (A20-02 viewer a11y, A20-03 void refresh, A19-01 ingest default,
 *                        A19-03/A20-04 readable errors).
 *  - AUDIT-QA21-ADDENDUM: Div 26 + contractor + PM-certified RFI (A20-01).
 */
import { client, fixtureTitle, writeEvidence, writeLog, sleep, purgeQa21, plusDays } from "./qa21-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const NOHVAC = fixtureTitle("NOHVAC");
const NOBIDS = fixtureTitle("NOBIDS");
const FULL = fixtureTitle("FULL");
const LIFE = fixtureTitle("LIFE");
const ADDENDUM = fixtureTitle("ADDENDUM");

async function makeProject({ title, location, budget, gc }) {
  const id = await c.mutation("projects:createProject", {
    title,
    location,
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: budget,
    targetCompletionWeeks: 52,
    specDocumentText: `${title} QA21 fixture scope. Divisions 22-26 coverage.`,
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
    scopeSummary: `${name} full scope per CSI ${csi} for QA21 fixtures.`,
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
    phone: "+1 (206) 555-0142",
    licenseNumber: license,
    licenseStatus: "Active / Verified (QA21)",
    sourceUrl: "https://qa21.example.invalid/license",
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
  say(`created bid ${res.bidId} for "${name}" $${base}`);
  return res.bidId;
}

async function main() {
  const purged = await purgeQa21(c, say);
  say(`purged ${purged} pre-existing AUDIT-QA21-* fixture(s)`);

  const deadline = plusDays(21);

  // ---------- NOHVAC (only Div 26) ----------
  const nohvacId = await makeProject({
    title: NOHVAC, location: "Austin, TX", budget: 1_500_000, gc: "QA21 Lone Star GC, LLC",
  });
  const nP1 = await makePackage({
    projectId: nohvacId, csi: "26 00 00", name: "QA21 NOHVAC Electrical", budget: 600_000, deadline,
    inclusions: ["QA21 switchgear commissioning"],
  });
  const nC1 = await makeContractor({ pkgId: nP1, name: "AUDIT-QA21 NOHVAC Electric", email: "qa21.nohvac@qa21.invalid", license: "TX-QA21-NH1" });
  const nB1 = await makeBid({ pkgId: nP1, contractorId: nC1, name: "AUDIT-QA21 NOHVAC Electric", base: 480_000 });

  // ---------- NOBIDS (both packages, no proposals) ----------
  const nobidsId = await makeProject({
    title: NOBIDS, location: "Denver, CO", budget: 1_400_000, gc: "QA21 Mile High GC, Inc",
  });
  const nbE = await makePackage({
    projectId: nobidsId, csi: "26 00 00", name: "QA21 NOBIDS Electrical", budget: 500_000, deadline,
    inclusions: ["QA21 feeder testing"],
  });
  const nbH = await makePackage({
    projectId: nobidsId, csi: "23 00 00", name: "QA21 NOBIDS HVAC", budget: 400_000, deadline,
    inclusions: ["QA21 TAB report"],
  });

  // ---------- FULL (both packages, one bid each) ----------
  const fullId = await makeProject({
    title: FULL, location: "Phoenix, AZ", budget: 2_000_000, gc: "QA21 Desert GC, LLC",
  });
  const fE = await makePackage({
    projectId: fullId, csi: "26 00 00", name: "QA21 FULL Electrical", budget: 600_000, deadline,
    inclusions: ["QA21 lightning protection"],
  });
  const fH = await makePackage({
    projectId: fullId, csi: "23 00 00", name: "QA21 FULL HVAC", budget: 450_000, deadline,
    inclusions: ["QA21 TAB report"],
  });
  const fEC = await makeContractor({ pkgId: fE, name: "AUDIT-QA21 FULL Electric", email: "qa21.full.e@qa21.invalid", license: "AZ-QA21-FE1" });
  const fHC = await makeContractor({ pkgId: fH, name: "AUDIT-QA21 FULL Mechanical", email: "qa21.full.h@qa21.invalid", license: "AZ-QA21-FH1" });
  const fEB = await makeBid({ pkgId: fE, contractorId: fEC, name: "AUDIT-QA21 FULL Electric", base: 410_000 });
  const fHB = await makeBid({ pkgId: fH, contractorId: fHC, name: "AUDIT-QA21 FULL Mechanical", base: 250_000 });

  // ---------- LIFE (award + execution recorded) ----------
  const lifeId = await makeProject({
    title: LIFE, location: "Seattle, WA", budget: 3_200_000, gc: "QA21 Cascade Builders, LP",
  });
  const lP1 = await makePackage({
    projectId: lifeId, csi: "26 00 00", name: "QA21 LIFE Electrical", budget: 1_200_000, deadline,
    inclusions: ["QA21 crane hoisting", "QA21 seismic bracing"],
  });
  const lAlpha = await makeContractor({ pkgId: lP1, name: "AUDIT-QA21 LIFE Alpha Electric", email: "qa21.life.alpha@qa21.invalid", license: "WA-QA21-LA1" });
  const lBeta = await makeContractor({ pkgId: lP1, name: "AUDIT-QA21 LIFE Beta Power", email: "qa21.life.beta@qa21.invalid", license: "WA-QA21-LB2" });
  const lBidA = await makeBid({
    pkgId: lP1, contractorId: lAlpha, name: "AUDIT-QA21 LIFE Alpha Electric", base: 1_150_000,
    exclusions: [{ description: "QA21 sealed conduit allowance excluded", costImpact: 40000, severity: "moderate" }],
  });
  const lBidB = await makeBid({
    pkgId: lP1, contractorId: lBeta, name: "AUDIT-QA21 LIFE Beta Power", base: 1_240_000,
    exclusions: [{ description: "QA21 firestop excluded", costImpact: 45000, severity: "critical" }],
  });
  const lifeAgreement = await c.mutation("agreements:generateAgreement", { bidId: lBidA, tradePackageId: lP1 });
  const lifeAgreementId = lifeAgreement?._id ?? lifeAgreement?.id ?? null;
  if (!lifeAgreementId) throw new Error("generateAgreement returned no id");
  await c.mutation("agreements:executeAgreement", { agreementId: lifeAgreementId });
  say(`LIFE awarded + execution recorded: agreement ${lifeAgreementId}`);

  // ---------- ADDENDUM (certified RFI) ----------
  const addId = await makeProject({
    title: ADDENDUM, location: "Chicago, IL", budget: 1_800_000, gc: "QA21 Windy City GC, LLC",
  });
  const aP1 = await makePackage({
    projectId: addId, csi: "26 00 00", name: "QA21 ADDENDUM Electrical", budget: 700_000, deadline,
    inclusions: ["QA21 addendum scope"],
  });
  const aC1 = await makeContractor({ pkgId: aP1, name: "AUDIT-QA21 ADDENDUM Electric", email: "qa21.addendum@qa21.invalid", license: "IL-QA21-AD1" });
  const rfiRes = await c.mutation("simulation:submitCustomRfi", {
    tradePackageId: aP1,
    contractorId: aC1,
    subject: "QA21 conduit derating clarification",
    question: "Confirm whether feeder derating at 90C is required for the QA21 riser per spec section 26 05 19.",
  });
  const conversationId = rfiRes?.conversationId ?? null;
  say(`ADDENDUM RFI submitted conversation=${conversationId}`);

  // Wait briefly for the autonomous review to settle, then certify via PM review.
  let convoStatus = null;
  for (let i = 0; i < 30; i++) {
    const convos = (await c.query("rfq:listConversations", { tradePackageId: aP1 })) || [];
    const convo = convos.find((x) => x._id === conversationId) || convos[0];
    convoStatus = convo?.status ?? null;
    if (convoStatus && convoStatus !== "pending_analysis") break;
    await sleep(2000);
  }
  await c.mutation("rfq:reviewEscalatedRfi", {
    conversationId,
    status: "clarified",
    reviewNote: "QA21 fixture: certified for addendum verification.",
  });
  say(`ADDENDUM RFI status before certification=${convoStatus}; certified via PM review`);

  const fixtures = {
    createdAt: new Date().toISOString(),
    nohvac: { title: NOHVAC, id: nohvacId, packageId: nP1, contractorId: nC1, bidId: nB1 },
    nobids: { title: NOBIDS, id: nobidsId, elecPackageId: nbE, hvacPackageId: nbH },
    full: { title: FULL, id: fullId, elecPackageId: fE, hvacPackageId: fH, elecBidId: fEB, hvacBidId: fHB },
    life: {
      title: LIFE, id: lifeId, packageId: lP1,
      contractors: { alpha: lAlpha, beta: lBeta },
      bids: { alpha: lBidA, beta: lBidB },
      agreementId: lifeAgreementId,
    },
    addendum: { title: ADDENDUM, id: addId, packageId: aP1, contractorId: aC1, conversationId },
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