/**
 * QA38-01 fixtures (AUDIT-QA38-* only; never touches demo / GC-AUDIT / AUDIT-5-* / other AUDIT-QA*).
 *  SIB - 26 Elect(800k) + 23 HVAC(480k sub): sibling-package reversal re-verify (FIX-NEW-77).
 *  The full UI journey project is created through the UI by qa38-03.
 *  The HUNT project is created independently by qa38-04.
 */
import { client, fixtureTitle, writeEvidence, writeLog, sleep, plusDays } from "./qa38-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const dl = plusDays(20);
const SAFE_INC = "All labor and materials per plans and specifications per CSI scope";

export async function purgeQa38(cx = c) {
  const projects = (await cx.query("projects:listProjects", {})) || [];
  for (const p of projects.filter((x) => x.title.startsWith("AUDIT-QA38-"))) {
    const agrs = (await cx.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await cx.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA38 fixture teardown of executed record before cleanup." });
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
    title, location, projectType: "Class-A Commercial Mixed-Use",
    estBudget: budget, targetCompletionWeeks: 52,
    specDocumentText: `${title} automated QA38 fixture scope.`,
    isDemoProject: false, generalContractorName: gc,
  });
}

async function makePackage({ projectId, csi, name, budget, inclusions = [SAFE_INC] }) {
  return await c.mutation("tradePackages:createTradePackage", {
    projectId, csiDivision: csi, tradeName: name, budgetEstimate: budget,
    scopeSummary: `${name} full scope per CSI ${csi} for QA38 fixtures.`,
    mandatoryInclusions: inclusions, bidDeadline: dl,
  });
}

async function makeContractor({ pkgId, name, email, license }) {
  return await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId, companyName: name, contactEmail: email,
    phone: "+1 (206) 555-0199", licenseNumber: license,
    licenseStatus: "Active / Verified (QA38)",
    sourceUrl: "https://qa38.example.invalid/license", rfqStatus: "invited",
  });
}

async function makeBid({ pkgId, contractorId, name, base }) {
  const res = await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkgId, contractorId, subcontractorName: name,
    baseBidAmount: base, identifiedExclusions: [], valueEngineeringAlternates: [],
    longLeadEquipmentWeeks: 8, leadTimePenalty: 0, coiComplianceStatus: "compliant", coiPenalty: 0,
  });
  return { bidId: res.bidId, leveled: res.leveledTotalCost, base };
}

async function main() {
  await purgeQa38();
  const state = { createdAt: new Date().toISOString(), prefix: "AUDIT-QA38-" };

  {
    const id = await makeProject({ title: fixtureTitle("SIB"), budget: 1600000, gc: "QA38 SIB GC" });
    const p26 = await makePackage({ projectId: id, csi: "26 00 00", name: "QA38 SIB Electrical", budget: 900000 });
    const p23 = await makePackage({ projectId: id, csi: "23 00 00", name: "QA38 SIB HVAC", budget: 600000 });
    const c26 = await makeContractor({ pkgId: p26, name: "AUDIT-QA38 SIB Electric", email: "estimating@qa38-sib-e.invalid", license: "TX-QA38-SIB-E" });
    const c23 = await makeContractor({ pkgId: p23, name: "AUDIT-QA38 SIB Mechanical", email: "estimating@qa38-sib-m.invalid", license: "TX-QA38-SIB-M" });
    const b26 = await makeBid({ pkgId: p26, contractorId: c26, name: "AUDIT-QA38 SIB Electric", base: 800000 });
    const b23 = await makeBid({ pkgId: p23, contractorId: c23, name: "AUDIT-QA38 SIB Mechanical", base: 480000 });
    state.sib = { id, p26, p23, c26, c23, b26, b23 };
    say(`sib=${id} p26=${p26} p23=${p23} b26=${b26.bidId} b23=${b23.bidId}`);
  }

  writeEvidence("fixtures", state);
  writeLog("fixtures", log);
  console.log("fixtures ready");
}

main().catch((e) => {
  console.error(e);
  writeLog("fixtures-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});