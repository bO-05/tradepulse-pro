/**
 * QA34-01 fixtures (AUDIT-QA34-* only; never touches demo / GC-AUDIT / AUDIT-5-* / other AUDIT-QA*).
 * Projects (all backend-created, one pair of Div26+Div23 packages unless noted):
 *  SM  - 26(800k) + 23(480k): main mixed-operation fuzz (deduct/reverse/manual/unaccept/award).
 *  EQ  - 26(800k) + 23(480k) with an accepted manual VFD credit $26,500 -> BOTH clash
 *        redundancies collapse to $12,000 (equal-amount collision probes).
 *  MB  - 26(800k) + 23 two bids B1(480k)/B2(497k): carrier-based reversal after award switch.
 *  REG - 26 with two bids 800k/780k + 23(480k): register/viewer/award truth after void/re-award.
 */
import { client, fixtureTitle, writeEvidence, writeLog, sleep } from "./qa34-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

export async function purgeQa34(cx = c) {
  const projects = (await cx.query("projects:listProjects", {})) || [];
  for (const p of projects.filter((x) => x.title.startsWith("AUDIT-QA34-"))) {
    const agrs = (await cx.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await cx.mutation("agreements:voidExecutedAgreement", {
          agreementId: a._id,
          reason: "QA34 fixture teardown of executed record before cleanup.",
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

const deadline = () => new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);

async function makeProject({ title, budget, gc }) {
  return await c.mutation("projects:createProject", {
    title,
    location: "Austin, TX",
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: budget,
    targetCompletionWeeks: 52,
    specDocumentText: `${title} automated QA34 fixture scope.`,
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
    scopeSummary: `${name} full scope per CSI ${csi} for QA34 fixtures.`,
    mandatoryInclusions: ["QA34 general scope per plans and specifications"],
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
    licenseStatus: "Active / Verified (QA34)",
    sourceUrl: "https://qa34.example.invalid/license",
    rfqStatus: "invited",
  });
}

async function makeBid({ pkgId, contractorId, name, base, ve = [] }) {
  const res = await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkgId,
    contractorId,
    subcontractorName: name,
    baseBidAmount: base,
    identifiedExclusions: [],
    valueEngineeringAlternates: ve,
    longLeadEquipmentWeeks: 8,
    leadTimePenalty: 0,
    coiComplianceStatus: "compliant",
    coiPenalty: 0,
  });
  return { bidId: res.bidId, leveled: res.leveledTotalCost, base };
}

async function pair({ tag, hBase = 480000, twoHvacBids = false, twoElecBids = false }) {
  const id = await makeProject({ title: fixtureTitle(tag), budget: 1600000, gc: `QA34 ${tag} GC` });
  const dl = deadline();
  const p26 = await makePackage({ projectId: id, csi: "26 00 00", name: `QA34 ${tag} Electrical`, budget: 900000, dl });
  const p23 = await makePackage({ projectId: id, csi: "23 00 00", name: `QA34 ${tag} HVAC`, budget: 600000, dl });
  const c26 = await makeContractor({ pkgId: p26, name: `AUDIT-QA34 ${tag} Electric`, email: `estimating@qa34-${tag.toLowerCase()}-e.invalid`, license: `TX-QA34-${tag}-E` });
  const c23 = await makeContractor({ pkgId: p23, name: `AUDIT-QA34 ${tag} Mechanical`, email: `estimating@qa34-${tag.toLowerCase()}-m.invalid`, license: `TX-QA34-${tag}-M` });
  const b26 = await makeBid({ pkgId: p26, contractorId: c26, name: `AUDIT-QA34 ${tag} Electric`, base: 800000 });
  const b23 = await makeBid({ pkgId: p23, contractorId: c23, name: `AUDIT-QA34 ${tag} Mechanical`, base: hBase });
  let c23b = null, b23b = null, c26b = null, b26b = null;
  if (twoHvacBids) {
    c23b = await makeContractor({ pkgId: p23, name: `AUDIT-QA34 ${tag} Mechanical Alt`, email: `estimating@qa34-${tag.toLowerCase()}-m2.invalid`, license: `TX-QA34-${tag}-M2` });
    b23b = await makeBid({ pkgId: p23, contractorId: c23b, name: `AUDIT-QA34 ${tag} Mechanical Alt`, base: 497000 });
  }
  if (twoElecBids) {
    c26b = await makeContractor({ pkgId: p26, name: `AUDIT-QA34 ${tag} Electric Alt`, email: `estimating@qa34-${tag.toLowerCase()}-e2.invalid`, license: `TX-QA34-${tag}-E2` });
    b26b = await makeBid({ pkgId: p26, contractorId: c26b, name: `AUDIT-QA34 ${tag} Electric Alt`, base: 780000 });
  }
  return { id, p26, p23, c26, c23, c23b, c26b, b26, b23, b23b, b26b };
}

async function main() {
  await purgeQa34();
  const state = { createdAt: new Date().toISOString() };

  state.sm = await pair({ tag: "SM" });
  state.eq = await pair({ tag: "EQ" });
  state.mb = await pair({ tag: "MB", twoHvacBids: true });
  state.reg = await pair({ tag: "REG", twoElecBids: true });

  // EQ: accepted manual VFD credit $26,500 -> VFD redundancy 38,500 - 26,500 = 12,000
  // and the disconnect redundancy is already 12,000. Equal-amount collision precondition.
  const eqAdjust = await c.mutation("bids:updateBidAdjustments", {
    bidId: state.eq.b23.bidId,
    identifiedExclusions: [],
    valueEngineeringAlternates: [
      { description: "VFD factory pricing credit (manual entry)", costDeduct: 26500, isAccepted: true },
    ],
    leadTimePenalty: 0,
    coiPenalty: 0,
  });
  state.eq.manualLeveled = eqAdjust.leveledTotalCost;

  say(`sm=${state.sm.id} eq=${state.eq.id} mb=${state.mb.id} reg=${state.reg.id}`);
  writeEvidence("fixtures", state);
  writeLog("fixtures", log);
  console.log("fixtures ready");
}

main().catch((e) => {
  console.error(e);
  writeLog("fixtures-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});