/**
 * QA26-01 fixtures (AUDIT-QA26-* only). Purges prior QA26 fixtures first.
 * Projects:
 *  GATE  - Div26 + Div23, ZERO bids (evidence-gate convergence checks)
 *  AWARD - Div26 with bids A(low)/B + Div23 with bid D
 *          (base state for award truth cross-view + register labels)
 *  JOURNEY - created through the UI by qa26-05 (not here)
 */
import { client, fixtureTitle, writeEvidence, writeLog, sleep, localDate, utcDate } from "./qa26-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

export async function purgeQa26() {
  const projects = (await c.query("projects:listProjects", {})) || [];
  for (const p of projects.filter((x) => x.title.startsWith("AUDIT-QA26-"))) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await c.mutation("agreements:voidExecutedAgreement", {
          agreementId: a._id,
          reason: "QA26 fixture teardown of executed record before cleanup.",
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

async function makeProject({ title, location, budget, gc }) {
  return await c.mutation("projects:createProject", {
    title,
    location,
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: budget,
    targetCompletionWeeks: 52,
    specDocumentText: `${title} automated QA26 fixture scope.`,
    isDemoProject: false,
    generalContractorName: gc,
  });
}

async function makePackage({ projectId, csi, name, budget, deadline, inclusions }) {
  return await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision: csi,
    tradeName: name,
    budgetEstimate: budget,
    scopeSummary: `${name} full scope per CSI ${csi} for QA26 fixtures.`,
    mandatoryInclusions: inclusions,
    bidDeadline: deadline,
  });
}

async function makeContractor({ pkgId, name, email, license }) {
  return await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId,
    companyName: name,
    contactEmail: email,
    phone: "+1 (206) 555-0199",
    licenseNumber: license,
    licenseStatus: "Active / Verified (QA26)",
    sourceUrl: "https://qa26.example.invalid/license",
    rfqStatus: "invited",
  });
}

async function makeBid({ pkgId, contractorId, name, base, exclusions = [], ve = [], weeks = 8 }) {
  const res = await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkgId,
    contractorId,
    subcontractorName: name,
    baseBidAmount: base,
    identifiedExclusions: exclusions,
    valueEngineeringAlternates: ve,
    longLeadEquipmentWeeks: weeks,
    leadTimePenalty: 0,
    coiComplianceStatus: "compliant",
    coiPenalty: 0,
  });
  return { bidId: res.bidId, leveled: res.leveledTotalCost, base };
}

async function main() {
  await purgeQa26();
  const deadline = plusDays(20);
  const state = {};

  // ---------- GATE: no bids anywhere ----------
  const gateId = await makeProject({ title: fixtureTitle("GATE"), location: "Austin, TX", budget: 1300000, gc: "QA26 Gate GC, LLC" });
  const g26 = await makePackage({ projectId: gateId, csi: "26 00 00", name: "QA26 Gate Electrical", budget: 800000, deadline, inclusions: ["Temp power"] });
  const g23 = await makePackage({ projectId: gateId, csi: "23 00 00", name: "QA26 Gate HVAC", budget: 500000, deadline, inclusions: ["TAB report"] });
  const g26A = await makeContractor({ pkgId: g26, name: "AUDIT-QA26 Gate Electric", email: "estimating@qa26-gate-e.invalid", license: "TX-QA26-GE" });
  const g23A = await makeContractor({ pkgId: g23, name: "AUDIT-QA26 Gate Mechanical", email: "estimating@qa26-gate-m.invalid", license: "TX-QA26-GM" });

  // ---------- AWARD: Div26 bids A + B, Div23 bid D ----------
  const awardId = await makeProject({ title: fixtureTitle("AWARD"), location: "Denver, CO", budget: 1400000, gc: "QA26 Award GC" });
  const a26 = await makePackage({ projectId: awardId, csi: "26 00 00", name: "QA26 Award Electrical", budget: 900000, deadline, inclusions: ["Gear labeling"] });
  const a23 = await makePackage({ projectId: awardId, csi: "23 00 00", name: "QA26 Award HVAC", budget: 500000, deadline, inclusions: ["Crane pick"] });
  const a26A = await makeContractor({ pkgId: a26, name: "AUDIT-QA26 Award Electric A", email: "estimating@qa26-award-a.invalid", license: "CO-QA26-AA" });
  const a26B = await makeContractor({ pkgId: a26, name: "AUDIT-QA26 Award Electric B", email: "estimating@qa26-award-b.invalid", license: "CO-QA26-AB" });
  const a23D = await makeContractor({ pkgId: a23, name: "AUDIT-QA26 Award Mechanical D", email: "estimating@qa26-award-d.invalid", license: "CO-QA26-AD" });
  const aBidA = await makeBid({ pkgId: a26, contractorId: a26A, name: "AUDIT-QA26 Award Electric A", base: 700000 });
  const aBidB = await makeBid({
    pkgId: a26, contractorId: a26B, name: "AUDIT-QA26 Award Electric B", base: 660000,
    exclusions: [{ description: "QA26 switchgear excluded", costImpact: 40000, severity: "critical" }],
  });
  const aBidD = await makeBid({ pkgId: a23, contractorId: a23D, name: "AUDIT-QA26 Award Mechanical D", base: 470000 });

  const fixtures = {
    createdAt: new Date().toISOString(),
    gate: { id: gateId, p26: g26, p23: g23, contractors: { c26: g26A, c23: g23A } },
    award: {
      id: awardId, p26: a26, p23: a23,
      contractors: { a: a26A, b: a26B, d: a23D },
      bids: { a: aBidA, b: aBidB, d: aBidD },
    },
    deadlines: { plus20: deadline, todayUtc: utcDate(), todayLocal: localDate() },
  };
  say(`gate=${gateId} award=${awardId}`);
  say(`award bids: A=${aBidA.leveled} B=${aBidB.leveled} D=${aBidD.leveled}`);
  writeEvidence("fixtures", fixtures);
  writeLog("fixtures", log);
  console.log("fixtures ready");
}

main().catch((e) => {
  console.error(e);
  writeLog("fixtures-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});