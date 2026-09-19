/**
 * QA32-01 fixtures (AUDIT-QA32-* only; never touches demo / GC-AUDIT / AUDIT-5-* / other AUDIT-QA*).
 * Projects:
 *  SM    - Div26(800k) + Div23(480k), one bid each (deduct/reverse state machine on both clashes)
 *  MB    - Div26(800k) + Div23 with two bids B1(480k) / B2(497k) (award-switch between deduct and reverse)
 *  UNACC - Div26(800k) + Div23(480k) (UI: un-accept/delete the applied credit -> stale resolution)
 *  MAN   - Div26(800k) + Div23(480k) with manual accepted VEs: HVAC "VFD factory pricing credit" $1,000,
 *          Electrical "Switchgear arc-flash study credit" $5,000 (alias must NOT cover the disconnect clash)
 *  VOID  - Div26(800k) + Div23(480k) (scope-void assign idempotency / symmetry)
 */
import { client, fixtureTitle, writeEvidence, writeLog, sleep } from "./qa32-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

export async function purgeQa32(cx = c) {
  const projects = (await cx.query("projects:listProjects", {})) || [];
  for (const p of projects.filter((x) => x.title.startsWith("AUDIT-QA32-"))) {
    const agrs = (await cx.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await cx.mutation("agreements:voidExecutedAgreement", {
          agreementId: a._id,
          reason: "QA32 fixture teardown of executed record before cleanup.",
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
    specDocumentText: `${title} automated QA32 fixture scope.`,
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
    scopeSummary: `${name} full scope per CSI ${csi} for QA32 fixtures.`,
    mandatoryInclusions: ["QA32 general scope per plans and specifications"],
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
    licenseStatus: "Active / Verified (QA32)",
    sourceUrl: "https://qa32.example.invalid/license",
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

async function pair({ tag, hBase = 480000, twoHvacBids = false }) {
  const id = await makeProject({ title: fixtureTitle(tag), budget: 1600000, gc: `QA32 ${tag} GC` });
  const dl = deadline();
  const p26 = await makePackage({ projectId: id, csi: "26 00 00", name: `QA32 ${tag} Electrical`, budget: 900000, dl });
  const p23 = await makePackage({ projectId: id, csi: "23 00 00", name: `QA32 ${tag} HVAC`, budget: 600000, dl });
  const c26 = await makeContractor({ pkgId: p26, name: `AUDIT-QA32 ${tag} Electric`, email: `estimating@qa32-${tag.toLowerCase()}-e.invalid`, license: `TX-QA32-${tag}-E` });
  const c23 = await makeContractor({ pkgId: p23, name: `AUDIT-QA32 ${tag} Mechanical`, email: `estimating@qa32-${tag.toLowerCase()}-m.invalid`, license: `TX-QA32-${tag}-M` });
  const b26 = await makeBid({ pkgId: p26, contractorId: c26, name: `AUDIT-QA32 ${tag} Electric`, base: 800000 });
  const b23 = await makeBid({ pkgId: p23, contractorId: c23, name: `AUDIT-QA32 ${tag} Mechanical`, base: hBase });
  let c23b = null;
  let b23b = null;
  if (twoHvacBids) {
    c23b = await makeContractor({ pkgId: p23, name: `AUDIT-QA32 ${tag} Mechanical Alt`, email: `estimating@qa32-${tag.toLowerCase()}-m2.invalid`, license: `TX-QA32-${tag}-M2` });
    b23b = await makeBid({ pkgId: p23, contractorId: c23b, name: `AUDIT-QA32 ${tag} Mechanical Alt`, base: 497000 });
  }
  return { id, p26, p23, c26, c23, c23b, b26, b23, b23b };
}

async function main() {
  await purgeQa32();
  const state = { createdAt: new Date().toISOString() };

  state.sm = await pair({ tag: "SM" });
  state.mb = await pair({ tag: "MB", twoHvacBids: true });
  state.unacc = await pair({ tag: "UNACC" });
  state.man = await pair({ tag: "MAN" });
  state.void = await pair({ tag: "VOID" });

  // MAN: manual accepted alternates exactly as the Bid Leveling "Add Alternate + Save" UI writes them.
  const man23 = await c.mutation("bids:updateBidAdjustments", {
    bidId: state.man.b23.bidId,
    identifiedExclusions: [],
    valueEngineeringAlternates: [
      { description: "VFD factory pricing credit (manual entry)", costDeduct: 1000, isAccepted: true },
    ],
    leadTimePenalty: 0,
    coiPenalty: 0,
  });
  const man26 = await c.mutation("bids:updateBidAdjustments", {
    bidId: state.man.b26.bidId,
    identifiedExclusions: [],
    valueEngineeringAlternates: [
      { description: "Switchgear arc-flash study credit (manual entry)", costDeduct: 5000, isAccepted: true },
    ],
    leadTimePenalty: 0,
    coiPenalty: 0,
  });
  state.man.manualLeveled = { b26: man26.leveledTotalCost, b23: man23.leveledTotalCost };

  say(`sm=${state.sm.id} mb=${state.mb.id} unacc=${state.unacc.id}`);
  say(`man=${state.man.id} void=${state.void.id}`);
  writeEvidence("fixtures", state);
  writeLog("fixtures", log);
  console.log("fixtures ready");
}

main().catch((e) => {
  console.error(e);
  writeLog("fixtures-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});