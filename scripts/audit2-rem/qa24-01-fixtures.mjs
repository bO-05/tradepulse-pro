/**
 * QA24-01 fixtures (AUDIT-QA24-* only). Purges prior QA24 fixtures first.
 * Projects:
 *  INTENT  - Div26 + Div23, ZERO bids (both-unpriced intent-logging path)
 *  REPEAT  - Div26 + Div23, one bid each (real two-sided clash operations)
 *  VOID    - Div26, two bids (void -> re-award -> execute -> void again)
 *  REGISTER- Div26, three bids pre-cycled so the register has 1 active
 *            executed agreement + 2 superseded agreements for UI checks.
 */
import {
  client, fixtureTitle, writeEvidence, writeLog, sleep, localDate, utcDate,
} from "./qa24-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

export async function purgeQa24() {
  const projects = (await c.query("projects:listProjects", {})) || [];
  for (const p of projects.filter((x) => x.title.startsWith("AUDIT-QA24-"))) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await c.mutation("agreements:voidExecutedAgreement", {
          agreementId: a._id,
          reason: "QA24 fixture teardown of executed record before cleanup.",
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

const plusDays = (n, base = new Date()) => new Date(base.getTime() + n * 86400000).toISOString().slice(0, 10);

async function makeProject({ title, location, budget, weeks = 52, gc }) {
  return await c.mutation("projects:createProject", {
    title, location,
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: budget,
    targetCompletionWeeks: weeks,
    specDocumentText: `${title} automated QA24 fixture scope.`,
    isDemoProject: false,
    generalContractorName: gc,
  });
}

async function makePackage({ projectId, csi, name, budget, deadline, inclusions }) {
  return await c.mutation("tradePackages:createTradePackage", {
    projectId, csiDivision: csi, tradeName: name, budgetEstimate: budget,
    scopeSummary: `${name} full scope per CSI ${csi} for QA24 fixtures.`,
    mandatoryInclusions: inclusions,
    bidDeadline: deadline,
  });
}

async function makeContractor({ pkgId, name, email, license }) {
  return await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId, companyName: name, contactEmail: email,
    phone: "+1 (206) 555-0199", licenseNumber: license,
    licenseStatus: "Active / Verified (QA24)", sourceUrl: "https://qa24.example.invalid/license",
    rfqStatus: "invited",
  });
}

async function makeBid({ pkgId, contractorId, name, base, exclusions = [], ve = [], leadPenalty = 0, weeks = 8 }) {
  const res = await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkgId, contractorId, subcontractorName: name,
    baseBidAmount: base, identifiedExclusions: exclusions, valueEngineeringAlternates: ve,
    longLeadEquipmentWeeks: weeks, leadTimePenalty: leadPenalty,
    coiComplianceStatus: "compliant", coiPenalty: 0,
  });
  return { bidId: res.bidId, leveled: res.leveledTotalCost, base };
}

async function main() {
  await purgeQa24();
  const deadline = plusDays(20);
  const state = {};

  // ---------- INTENT (no bids at fixture time) ----------
  const intentId = await makeProject({ title: fixtureTitle("INTENT"), location: "Austin, TX", budget: 1300000, gc: "QA24 Intent GC, LLC" });
  const i26 = await makePackage({ projectId: intentId, csi: "26 00 00", name: "QA24 Intent Electrical", budget: 800000, deadline, inclusions: ["Temp power"] });
  const i23 = await makePackage({ projectId: intentId, csi: "23 00 00", name: "QA24 Intent HVAC", budget: 500000, deadline, inclusions: ["TAB report"] });
  const i26A = await makeContractor({ pkgId: i26, name: "AUDIT-QA24 Intent Electric", email: "estimating@qa24-intent-e.invalid", license: "TX-QA24-IE" });
  const i23A = await makeContractor({ pkgId: i23, name: "AUDIT-QA24 Intent Mechanical", email: "estimating@qa24-intent-m.invalid", license: "TX-QA24-IM" });

  // ---------- REPEAT (both sides priced) ----------
  const repeatId = await makeProject({ title: fixtureTitle("REPEAT"), location: "Denver, CO", budget: 1400000, gc: "QA24 Repeat GC" });
  const r26 = await makePackage({ projectId: repeatId, csi: "26 00 00", name: "QA24 Repeat Electrical", budget: 800000, deadline, inclusions: ["Gear labeling"] });
  const r23 = await makePackage({ projectId: repeatId, csi: "23 00 00", name: "QA24 Repeat HVAC", budget: 500000, deadline, inclusions: ["Crane pick"] });
  const r26A = await makeContractor({ pkgId: r26, name: "AUDIT-QA24 Repeat Electric", email: "estimating@qa24-repeat-e.invalid", license: "CO-QA24-RE" });
  const r23A = await makeContractor({ pkgId: r23, name: "AUDIT-QA24 Repeat Mechanical", email: "estimating@qa24-repeat-m.invalid", license: "CO-QA24-RM" });
  const r26Bid = await makeBid({
    pkgId: r26, contractorId: r26A, name: "AUDIT-QA24 Repeat Electric", base: 780000,
    exclusions: [{ description: "QA24 switchgear excluded", costImpact: 40000, severity: "critical" }],
  });
  const r23Bid = await makeBid({ pkgId: r23, contractorId: r23A, name: "AUDIT-QA24 Repeat Mechanical", base: 470000 });

  // ---------- VOID (two bids, one awarded later) ----------
  const voidId = await makeProject({ title: fixtureTitle("VOID"), location: "Phoenix, AZ", budget: 900000, gc: "QA24 Void GC" });
  const v26 = await makePackage({ projectId: voidId, csi: "26 00 00", name: "QA24 Void Electrical", budget: 700000, deadline, inclusions: ["Gear labeling"] });
  const v26A = await makeContractor({ pkgId: v26, name: "AUDIT-QA24 Void Electric A", email: "estimating@qa24-void-a.invalid", license: "AZ-QA24-VA" });
  const v26B = await makeContractor({ pkgId: v26, name: "AUDIT-QA24 Void Electric B", email: "estimating@qa24-void-b.invalid", license: "AZ-QA24-VB" });
  const vBidA = await makeBid({ pkgId: v26, contractorId: v26A, name: "AUDIT-QA24 Void Electric A", base: 700000 });
  const vBidB = await makeBid({
    pkgId: v26, contractorId: v26B, name: "AUDIT-QA24 Void Electric B", base: 690000,
    exclusions: [
      { description: "QA24 crane hoisting excluded", costImpact: 60000, severity: "critical" },
      { description: "QA24 firestop excluded", costImpact: 45000, severity: "critical" },
    ],
  });

  // ---------- REGISTER (three bids -> award/void cycles leave 1 active + 2 superseded) ----------
  const registerId = await makeProject({ title: fixtureTitle("REGISTER"), location: "Miami, FL", budget: 1600000, gc: "QA24 Register GC" });
  const g26 = await makePackage({ projectId: registerId, csi: "26 00 00", name: "QA24 Register Electrical", budget: 900000, deadline, inclusions: ["Panel schedules"] });
  const g26A = await makeContractor({ pkgId: g26, name: "AUDIT-QA24 Register Electric A", email: "estimating@qa24-reg-a.invalid", license: "FL-QA24-RA" });
  const g26B = await makeContractor({ pkgId: g26, name: "AUDIT-QA24 Register Electric B", email: "estimating@qa24-reg-b.invalid", license: "FL-QA24-RB" });
  const g26C = await makeContractor({ pkgId: g26, name: "AUDIT-QA24 Register Electric C", email: "estimating@qa24-reg-c.invalid", license: "FL-QA24-RC" });
  const gBidA = await makeBid({ pkgId: g26, contractorId: g26A, name: "AUDIT-QA24 Register Electric A", base: 700000 });
  const gBidB = await makeBid({ pkgId: g26, contractorId: g26B, name: "AUDIT-QA24 Register Electric B", base: 690000 });
  const gBidC = await makeBid({ pkgId: g26, contractorId: g26C, name: "AUDIT-QA24 Register Electric C", base: 680000 });

  // Pre-cycle: A gen -> B gen -> C gen -> C exec -> C void -> A reaward -> A exec
  // Leaves: agrA executed (active), agrB + agrC superseded.
  const agrA = await c.mutation("agreements:generateAgreement", { bidId: gBidA.bidId, tradePackageId: g26 });
  const agrB = await c.mutation("agreements:generateAgreement", { bidId: gBidB.bidId, tradePackageId: g26 });
  const agrC = await c.mutation("agreements:generateAgreement", { bidId: gBidC.bidId, tradePackageId: g26 });
  await c.mutation("agreements:executeAgreement", { agreementId: agrC._id });
  await c.mutation("agreements:voidExecutedAgreement", {
    agreementId: agrC._id,
    reason: "QA24 register fixture: cycle-1 execution recorded in error, superseded for cycle 2.",
  });
  const agrA2 = await c.mutation("agreements:generateAgreement", { bidId: gBidA.bidId, tradePackageId: g26 });
  await c.mutation("agreements:executeAgreement", { agreementId: agrA2._id });

  const fixtures = {
    createdAt: new Date().toISOString(),
    intent: { id: intentId, p26: i26, p23: i23, contractors: { c26: i26A, c23: i23A } },
    repeat: { id: repeatId, p26: r26, p23: r23, contractors: { c26: r26A, c23: r23A }, bids: { b26: r26Bid, b23: r23Bid } },
    void: { id: voidId, p26: v26, contractors: { a: v26A, b: v26B }, bids: { a: vBidA, b: vBidB } },
    register: {
      id: registerId, p26: g26, contractors: { a: g26A, b: g26B, c: g26C },
      bids: { a: gBidA, b: gBidB, c: gBidC },
      agreements: { a: agrA._id, b: agrB._id, c: agrC._id },
      agreementNumbers: { a: agrA.agreementNumber, b: agrB.agreementNumber, c: agrC.agreementNumber },
    },
    deadlines: { plus20: deadline, todayUtc: utcDate(), todayLocal: localDate() },
  };
  say(`intent=${intentId} repeat=${repeatId} void=${voidId} register=${registerId}`);
  say(`repeat p26bid=${r26Bid.leveled} p23bid=${r23Bid.leveled}`);
  say(`register agreements: A=${agrA.agreementNumber} B=${agrB.agreementNumber} C=${agrC.agreementNumber}`);
  writeEvidence("fixtures", fixtures);
  writeLog("fixtures", log);
  console.log("fixtures ready");
}

main().catch((e) => {
  console.error(e);
  writeLog("fixtures-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});