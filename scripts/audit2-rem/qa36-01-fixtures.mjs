/**
 * QA36-01 fixtures (AUDIT-QA36-* only; never touches demo / GC-AUDIT / AUDIT-5-* / AUDIT-QA35-* / other AUDIT-QA*).
 * Projects:
 *  SM   - 26(800k) + 23(480k): mixed-operation identity fuzz (deduct/reverse/manual/unaccept/stale/award).
 *  EQ   - 26(800k) + 23(480k) with accepted manual VFD $26,500 -> BOTH clash rows exactly $12,000
 *         (equal-amount collision probes, the A34-01/A34-02 regression surface).
 *  MB   - 26(800k) + 23 two bids B1(480k)/B2(497k): award-switch carrier flows.
 *  ISOA - 26(800k) + 23(480k): multi-project isolation A (same clash ids as ISOB).
 *  ISOB - 26(850k) + 23(520k): multi-project isolation B.
 *  UIA  - 26(800k) + 23(470k): UI journey A (CSV + print + reverse).
 *  UIB  - 26(760k) + 23(530k): UI journey B (isolation spot check).
 */
import { client, fixtureTitle, writeEvidence, writeLog, sleep, findProjectByTitle } from "./qa36-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

export async function purgeQa36(cx = c) {
  const projects = (await cx.query("projects:listProjects", {})) || [];
  for (const p of projects.filter((x) => x.title.startsWith("AUDIT-QA36-"))) {
    const agrs = (await cx.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await cx.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA36 fixture teardown of executed record before cleanup." });
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
    title, location: "Austin, TX", projectType: "Class-A Commercial Mixed-Use",
    estBudget: budget, targetCompletionWeeks: 52,
    specDocumentText: `${title} automated QA36 fixture scope.`,
    isDemoProject: false, generalContractorName: gc,
  });
}
async function makePackage({ projectId, csi, name, budget, dl }) {
  return await c.mutation("tradePackages:createTradePackage", {
    projectId, csiDivision: csi, tradeName: name, budgetEstimate: budget,
    scopeSummary: `${name} full scope per CSI ${csi} for QA36 fixtures.`,
    mandatoryInclusions: ["QA36 general scope per plans and specifications"],
    bidDeadline: dl,
  });
}
async function makeContractor({ pkgId, name, email, license }) {
  return await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId, companyName: name, contactEmail: email,
    phone: "+1 (206) 555-0199", licenseNumber: license,
    licenseStatus: "Active / Verified (QA36)",
    sourceUrl: "https://qa36.example.invalid/license", rfqStatus: "invited",
  });
}
async function makeBid({ pkgId, contractorId, name, base, ve = [] }) {
  const res = await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkgId, contractorId, subcontractorName: name,
    baseBidAmount: base, identifiedExclusions: [], valueEngineeringAlternates: ve,
    longLeadEquipmentWeeks: 8, leadTimePenalty: 0, coiComplianceStatus: "compliant", coiPenalty: 0,
  });
  return { bidId: res.bidId, leveled: res.leveledTotalCost, base };
}

async function pair({ tag, hBase = 480000, eBase = 800000, twoHvacBids = false }) {
  const id = await makeProject({ title: fixtureTitle(tag), budget: 1600000, gc: `QA36 ${tag} GC` });
  const dl = deadline();
  const p26 = await makePackage({ projectId: id, csi: "26 00 00", name: `QA36 ${tag} Electrical`, budget: 900000, dl });
  const p23 = await makePackage({ projectId: id, csi: "23 00 00", name: `QA36 ${tag} HVAC`, budget: 600000, dl });
  const c26 = await makeContractor({ pkgId: p26, name: `AUDIT-QA36 ${tag} Electric`, email: `estimating@qa36-${tag.toLowerCase()}-e.invalid`, license: `TX-QA36-${tag}-E` });
  const c23 = await makeContractor({ pkgId: p23, name: `AUDIT-QA36 ${tag} Mechanical`, email: `estimating@qa36-${tag.toLowerCase()}-m.invalid`, license: `TX-QA36-${tag}-M` });
  const b26 = await makeBid({ pkgId: p26, contractorId: c26, name: `AUDIT-QA36 ${tag} Electric`, base: eBase });
  const b23 = await makeBid({ pkgId: p23, contractorId: c23, name: `AUDIT-QA36 ${tag} Mechanical`, base: hBase });
  let b23b = null;
  if (twoHvacBids) {
    const c23b = await makeContractor({ pkgId: p23, name: `AUDIT-QA36 ${tag} Mechanical Alt`, email: `estimating@qa36-${tag.toLowerCase()}-m2.invalid`, license: `TX-QA36-${tag}-M2` });
    b23b = await makeBid({ pkgId: p23, contractorId: c23b, name: `AUDIT-QA36 ${tag} Mechanical Alt`, base: 497000 });
  }
  return { id, p26, p23, c26, c23, b26, b23, b23b };
}

async function main() {
  await purgeQa36();
  const state = { createdAt: new Date().toISOString(), prefix: "AUDIT-QA36-" };

  state.sm = await pair({ tag: "SM" });
  state.eq = await pair({ tag: "EQ" });
  state.mb = await pair({ tag: "MB", twoHvacBids: true });
  state.isoA = await pair({ tag: "ISOA" });
  state.isoB = await pair({ tag: "ISOB", hBase: 520000, eBase: 850000 });
  state.uiA = await pair({ tag: "UIA", hBase: 470000 });
  state.uiB = await pair({ tag: "UIB", hBase: 530000, eBase: 760000 });

  // EQ precondition: accepted manual VFD $26,500 -> VFD redundancy 38,500-26,500 = 12,000
  // and the disconnect redundancy is 12,000 -> equal amounts on one bid.
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

  say(`sm=${state.sm.id} eq=${state.eq.id} mb=${state.mb.id} isoA=${state.isoA.id} isoB=${state.isoB.id} uiA=${state.uiA.id} uiB=${state.uiB.id}`);
  writeEvidence("fixtures", state);
  writeLog("fixtures", log);
  console.log("fixtures ready");
}

main().catch((e) => {
  console.error(e);
  writeLog("fixtures-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});