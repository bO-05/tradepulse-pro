import { client, fixtureName, writeEvidence, writeLog, fullFixtureState, sleep } from "./qa10-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function findProject(title) {
  const projects = await c.query("projects:listProjects", {});
  return (projects || []).find((p) => p.title === title) || null;
}

async function ensureProject(title, extra = {}) {
  let p = await findProject(title);
  if (p) { say(`reuse project ${title} ${p._id}`); return { project: p, created: false }; }
  const id = await c.mutation("projects:createProject", {
    title,
    location: "Austin, TX",
    projectType: "Class-A Commercial Mixed-Use QA",
    estBudget: 2_000_000,
    targetCompletionWeeks: 40,
    specDocumentText: "QA10 fixture specification. Division 26 electrical, Division 23 HVAC.",
    isDemoProject: false,
    generalContractorName: "QA10 General Contractor LLC",
    ...extra,
  });
  p = await c.query("projects:getProject", { projectId: id });
  say(`created project ${title} ${id}`);
  return { project: p, created: true };
}

async function ensurePackage(projectId, csiDivision, tradeName, budget = 900000) {
  const pkgs = await c.query("tradePackages:listByProject", { projectId });
  const found = (pkgs || []).find((p) => p.csiDivision === csiDivision);
  if (found) { say(`reuse package ${csiDivision} ${found._id}`); return { pkg: found, created: false }; }
  const id = await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision,
    tradeName,
    budgetEstimate: budget,
    scopeSummary: `QA10 ${tradeName} scope summary for adversarial testing.`,
    mandatoryInclusions: [`QA10 inclusion for ${csiDivision}`],
    bidDeadline: "2026-12-31",
  });
  const pkg = await c.query("tradePackages:getPackage", { tradePackageId: id });
  say(`created package ${csiDivision} ${id}`);
  return { pkg, created: true };
}

async function ensureContractor(pkgId, companyName, email, rfqStatus = "invited") {
  const list = await c.query("contractors:listByPackage", { tradePackageId: pkgId });
  const found = (list || []).find((x) => x.contactEmail === email);
  if (found) { say(`reuse contractor ${companyName} ${found._id}`); return found; }
  const id = await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId,
    companyName,
    contactEmail: email,
    phone: "+1 (512) 555-0110",
    licenseNumber: "TX-QA10-0001",
    licenseStatus: "Active / Verified (TDLR-QA)",
    sourceUrl: "https://qa10.example.invalid",
    rfqStatus,
  });
  const list2 = await c.query("contractors:listByPackage", { tradePackageId: pkgId });
  say(`created contractor ${companyName} ${id}`);
  return (list2 || []).find((x) => x._id === id);
}

async function ensureBid(pkg, contractor, amount, exclusions = [], ve = []) {
  const bids = await c.query("bids:listByPackage", { tradePackageId: pkg._id });
  const found = (bids || []).find((b) => b.contractorId === contractor._id);
  if (found) { say(`reuse bid ${found._id}`); return found; }
  const res = await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkg._id,
    contractorId: contractor._id,
    subcontractorName: contractor.companyName,
    baseBidAmount: amount,
    lineItems: [
      { item: "QA10 Base Scope", unit: "LS", quantity: 1, unitCost: amount, totalCost: amount },
    ],
    identifiedExclusions: exclusions,
    valueEngineeringAlternates: ve,
    longLeadEquipmentWeeks: 12,
    leadTimePenalty: 0,
    coiComplianceStatus: "compliant",
    coiPenalty: 0,
  });
  const bids2 = await c.query("bids:listByPackage", { tradePackageId: pkg._id });
  say(`created bid ${res.bidId} leveled=${res.leveledTotalCost}`);
  return (bids2 || []).find((b) => b._id === res.bidId);
}

async function main() {
  const map = { alpha: {}, bravo: {}, malformed: {} };

  // ---------- ALPHA: leveling / derived / realtime / UI fixture ----------
  const alpha = await ensureProject(fixtureName("ALPHA"));
  map.alpha.projectId = alpha.project._id;
  const a1 = await ensurePackage(alpha.project._id, "26 00 00", "QA10 Electrical Alpha", 1000000);
  const a2 = await ensurePackage(alpha.project._id, "23 00 00", "QA10 HVAC Alpha", 1000000);
  map.alpha.elecPackageId = a1.pkg._id;
  map.alpha.hvacPackageId = a2.pkg._id;

  const cA = await ensureContractor(a1.pkg._id, "AUDIT-QA10 Alpha Electric", "alpha.electric@qa10.invalid");
  const cB = await ensureContractor(a1.pkg._id, 'AUDIT-QA10 "Quote",=SUM(A1) <b>RTL:مقاول 😀', "alpha.quote@qa10.invalid");
  await ensureContractor(a2.pkg._id, "AUDIT-QA10 Alpha Mechanical", "alpha.mech@qa10.invalid");
  map.alpha.contractorA = cA._id;
  map.alpha.contractorB = cB._id;

  const bidA = await ensureBid(a1.pkg, cA, 850000, [], []);
  const bidB = await ensureBid(a1.pkg, cB, 800000, [
    { description: "QA10 excluded crane hoisting", costImpact: 45000, severity: "critical" },
    { description: "QA10 excluded firestop", costImpact: 22000, severity: "moderate", isWaived: false },
  ], [
    { description: "QA10 VE deduct", costDeduct: 30000, isAccepted: false },
  ]);
  map.alpha.bidA = bidA._id;
  map.alpha.bidB = bidB._id;

  // ---------- BRAVO: isolation partner ----------
  const bravo = await ensureProject(fixtureName("BRAVO"));
  map.bravo.projectId = bravo.project._id;
  const b1 = await ensurePackage(bravo.project._id, "26 00 00", "QA10 Electrical Bravo", 1000000);
  map.bravo.elecPackageId = b1.pkg._id;
  const bC = await ensureContractor(b1.pkg._id, "AUDIT-QA10 Bravo Electric", "bravo.electric@qa10.invalid");
  map.bravo.contractor = bC._id;
  const bidBr = await ensureBid(b1.pkg, bC, 750000, [], []);
  map.bravo.bid = bidBr._id;

  // ---------- MALFORMED: mutation battery + immutability ----------
  const mal = await ensureProject(fixtureName("MALFORMED"));
  map.malformed.projectId = mal.project._id;
  const m1 = await ensurePackage(mal.project._id, "26 00 00", "QA10 Electrical Malformed", 1000000);
  map.malformed.elecPackageId = m1.pkg._id;
  const mC = await ensureContractor(m1.pkg._id, "AUDIT-QA10 Malformed Electric", "malformed.electric@qa10.invalid");
  map.malformed.contractor = mC._id;
  const mBid = await ensureBid(m1.pkg, mC, 640000, [], []);
  map.malformed.bid = mBid._id;

  // executed agreement for immutability probes
  const gen = await c.mutation("agreements:generateAgreement", {
    bidId: mBid._id,
    tradePackageId: m1.pkg._id,
  });
  map.malformed.agreement = gen._id;
  const exec = await c.mutation("agreements:executeAgreement", { agreementId: gen._id });
  map.malformed.executed = exec;
  say(`malformed agreement ${gen._id} executed=${JSON.stringify(exec)}`);

  map.generatedAt = new Date().toISOString();
  writeEvidence("fixtures", map);
  writeLog("fixtures", log);
  const state = await fullFixtureState(c, map.alpha.projectId);
  console.log(`ALPHA state: packages=${state.packages.length} contractors=${state.contractors.length} bids=${state.bids.length}`);
  await sleep(200);
}

main().catch((e) => { console.error(e); process.exit(1); });