/**
 * QA30-01 fixtures (AUDIT-QA30-* only; never touches demo / GC-AUDIT / AUDIT-5-* / AUDIT-QA*).
 * Projects:
 *  BASE    - Div26(800k) + Div23(480k), clean inclusions (valid credit/assign matrix)
 *  EDGE    - Div26(800k) + Div23(40k), clean inclusions (bounds: equal-to-leveled credit)
 *  TRAP    - Div26 inclusions ["Base building general conditions allowance"],
 *            Div23 inclusions ["Smoke evacuation shaft dampers", "Low voltage cabling allowance"]
 *            -> substring traps that must NOT assign either void
 *  ALIAS   - Div26 inclusions ["BAS control wiring and BMS integration", "Duct smoke detector installation and FACP tie-in"]
 *            -> true aliases that must assign both voids to Div26
 *  MAN     - both priced; accepted manual VEs: Div26 "VFD factory pricing credit" $1,000,
 *            Div23 "Switchgear arc-flash study credit" $5,000 (alias coverage probes)
 *  ONEWAY  - Div26 priced only (one-sided pricing evidence gate)
 *  NOBID   - Div26+Div23 priced, Div03 package with contractor but zero bids (target without bid)
 *  PHANTOM - both priced (deduct -> manual VE removal -> phantom detection)
 */
import { client, fixtureTitle, writeEvidence, writeLog, sleep } from "./qa30-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

export async function purgeQa30() {
  const projects = (await c.query("projects:listProjects", {})) || [];
  for (const p of projects.filter((x) => x.title.startsWith("AUDIT-QA30-"))) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await c.mutation("agreements:voidExecutedAgreement", {
          agreementId: a._id,
          reason: "QA30 fixture teardown of executed record before cleanup.",
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
    specDocumentText: `${title} automated QA30 fixture scope.`,
    isDemoProject: false,
    generalContractorName: gc,
  });
}

async function makePackage({ projectId, csi, name, budget, dl, inclusions = ["QA30 general scope per plans and specifications"] }) {
  return await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision: csi,
    tradeName: name,
    budgetEstimate: budget,
    scopeSummary: `${name} full scope per CSI ${csi} for QA30 fixtures.`,
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
    licenseStatus: "Active / Verified (QA30)",
    sourceUrl: "https://qa30.example.invalid/license",
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

async function pair({ tag, hBase = 480000, eInclusions, hInclusions, priceBoth = true, extraPkg = false }) {
  const id = await makeProject({ title: fixtureTitle(tag), budget: 1600000, gc: `QA30 ${tag} GC` });
  const dl = deadline();
  const p26 = await makePackage({
    projectId: id, csi: "26 00 00", name: `QA30 ${tag} Electrical`, budget: 900000, dl,
    inclusions: eInclusions || ["QA30 general scope per plans and specifications"],
  });
  const p23 = await makePackage({
    projectId: id, csi: "23 00 00", name: `QA30 ${tag} HVAC`, budget: 600000, dl,
    inclusions: hInclusions || ["QA30 general scope per plans and specifications"],
  });
  const c26 = await makeContractor({ pkgId: p26, name: `AUDIT-QA30 ${tag} Electric`, email: `estimating@qa30-${tag.toLowerCase()}-e.invalid`, license: `TX-QA30-${tag}-E` });
  const c23 = await makeContractor({ pkgId: p23, name: `AUDIT-QA30 ${tag} Mechanical`, email: `estimating@qa30-${tag.toLowerCase()}-m.invalid`, license: `TX-QA30-${tag}-M` });
  const b26 = await makeBid({ pkgId: p26, contractorId: c26, name: `AUDIT-QA30 ${tag} Electric`, base: 800000 });
  const b23 = priceBoth
    ? await makeBid({ pkgId: p23, contractorId: c23, name: `AUDIT-QA30 ${tag} Mechanical`, base: hBase })
    : null;
  let p03 = null;
  let c03 = null;
  if (extraPkg) {
    p03 = await makePackage({ projectId: id, csi: "03 30 00", name: `QA30 ${tag} Concrete`, budget: 250000, dl });
    c03 = await makeContractor({ pkgId: p03, name: `AUDIT-QA30 ${tag} Concrete`, email: `estimating@qa30-${tag.toLowerCase()}-c.invalid`, license: `TX-QA30-${tag}-C` });
  }
  return { id, p26, p23, p03, c26, c23, c03, b26, b23 };
}

async function main() {
  await purgeQa30();
  const state = { createdAt: new Date().toISOString() };

  state.base = await pair({ tag: "BASE" });
  state.edge = await pair({ tag: "EDGE", hBase: 40000 });
  state.trap = await pair({
    tag: "TRAP",
    eInclusions: ["Base building general conditions allowance"],
    hInclusions: ["Smoke evacuation shaft dampers", "Low voltage cabling allowance"],
  });
  state.alias = await pair({
    tag: "ALIAS",
    eInclusions: ["BAS control wiring and BMS integration", "Duct smoke detector installation and FACP tie-in"],
  });
  state.man = await pair({ tag: "MAN" });
  state.oneway = await pair({ tag: "ONEWAY", priceBoth: false });
  state.nobid = await pair({ tag: "NOBID", extraPkg: true });
  state.phantom = await pair({ tag: "PHANTOM" });

  // MAN: manual accepted VEs exactly as the Bid Leveling "Add Alternate + Save" UI writes them.
  const manAdjust26 = await c.mutation("bids:updateBidAdjustments", {
    bidId: state.man.b26.bidId,
    identifiedExclusions: [],
    valueEngineeringAlternates: [
      { description: "VFD factory pricing credit (manual entry)", costDeduct: 1000, isAccepted: true },
    ],
    leadTimePenalty: 0,
    coiPenalty: 0,
  });
  const manAdjust23 = await c.mutation("bids:updateBidAdjustments", {
    bidId: state.man.b23.bidId,
    identifiedExclusions: [],
    valueEngineeringAlternates: [
      { description: "Switchgear arc-flash study credit (manual entry)", costDeduct: 5000, isAccepted: true },
    ],
    leadTimePenalty: 0,
    coiPenalty: 0,
  });
  state.man.manualLeveled = { b26: manAdjust26.leveledTotalCost, b23: manAdjust23.leveledTotalCost };

  say(`base=${state.base.id} edge=${state.edge.id} trap=${state.trap.id} alias=${state.alias.id}`);
  say(`man=${state.man.id} oneway=${state.oneway.id} nobid=${state.nobid.id} phantom=${state.phantom.id}`);
  writeEvidence("fixtures", state);
  writeLog("fixtures", log);
  console.log("fixtures ready");
}

main().catch((e) => {
  console.error(e);
  writeLog("fixtures-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});