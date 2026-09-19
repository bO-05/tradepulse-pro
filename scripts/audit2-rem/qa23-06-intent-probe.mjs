/**
 * QA23-06 probe (temporary AUDIT-QA23-INTENT fixture, deleted at the end):
 * the zero-evidence "credit logged before proposals" branch of deductDoubleBuyCredit
 * persists a deducted clash resolution without any target bid. Verify whether a later
 * real credit becomes impossible once bids arrive (no reverse mutation exists).
 */
import { client, fixtureTitle, writeEvidence, writeLog, purgeQa23, call, projectSnapshot, sleep } from "./qa23-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1000)}`);
};

const TITLE = fixtureTitle("INTENT");

async function main() {
  await purgeQa23(c, say);

  const projectId = await c.mutation("projects:createProject", {
    title: TITLE, location: "Tulsa, OK", projectType: "Class-A Commercial Mixed-Use", estBudget: 1_000_000,
    targetCompletionWeeks: 40, specDocumentText: "QA23 intent probe.", isDemoProject: false, generalContractorName: "QA23 Probe GC",
  });
  const deadline = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  const elec = await c.mutation("tradePackages:createTradePackage", {
    projectId, csiDivision: "26 00 00", tradeName: "QA23 INTENT Electrical", budgetEstimate: 400_000,
    scopeSummary: "QA23 intent electrical.", mandatoryInclusions: ["Gear labeling"], bidDeadline: deadline,
  });
  const hvac = await c.mutation("tradePackages:createTradePackage", {
    projectId, csiDivision: "23 00 00", tradeName: "QA23 INTENT HVAC", budgetEstimate: 300_000,
    scopeSummary: "QA23 intent HVAC.", mandatoryInclusions: ["TAB report"], bidDeadline: deadline,
  });

  // 1) Deduct with zero proposals on BOTH sides (allowed by the A21-01 gate).
  const intent = await call("deduct with no bids anywhere", () => c.mutation("coordination:deductDoubleBuyCredit", {
    projectId, clashId: "clash-vfd-01", tradePackageId: elec, deductAmount: 38500, description: "QA23 intent VFD credit",
  }));
  say(`intent deduct: ${JSON.stringify(intent.ok ? intent.value : intent.data)}`);

  // 2) Now price both sides.
  const eC = await c.mutation("contractors:createContractor", {
    tradePackageId: elec, companyName: "AUDIT-QA23 Intent Electric", contactEmail: "qa23.intent.e@qa23.invalid",
    licenseNumber: "OK-QA23-IE", licenseStatus: "Active / Verified (QA23)", sourceUrl: "https://qa23.example.invalid/ie", rfqStatus: "invited",
  });
  const hC = await c.mutation("contractors:createContractor", {
    tradePackageId: hvac, companyName: "AUDIT-QA23 Intent Mechanical", contactEmail: "qa23.intent.h@qa23.invalid",
    licenseNumber: "OK-QA23-IH", licenseStatus: "Active / Verified (QA23)", sourceUrl: "https://qa23.example.invalid/ih", rfqStatus: "invited",
  });
  const eBid = await c.mutation("bids:submitDirectBid", {
    tradePackageId: elec, contractorId: eC, subcontractorName: "AUDIT-QA23 Intent Electric", baseBidAmount: 410_000,
    identifiedExclusions: [], valueEngineeringAlternates: [], longLeadEquipmentWeeks: 8, leadTimePenalty: 0, coiComplianceStatus: "compliant", coiPenalty: 0,
  });
  await c.mutation("bids:submitDirectBid", {
    tradePackageId: hvac, contractorId: hC, subcontractorName: "AUDIT-QA23 Intent Mechanical", baseBidAmount: 250_000,
    identifiedExclusions: [], valueEngineeringAlternates: [], longLeadEquipmentWeeks: 8, leadTimePenalty: 0, coiComplianceStatus: "compliant", coiPenalty: 0,
  });

  // 3) detect claims the clash is deducted even though no bid got the credit.
  const detected = await c.query("coordination:detectCrossTradeClashes", { projectId });
  const vfd = (detected.doubleBuys || []).find((d) => d.id === "clash-vfd-01");
  const snap = await projectSnapshot(c, projectId);
  const eBidRow = snap.bids.find((b) => b._id === eBid.bidId);
  const veApplied = (eBidRow?.valueEngineeringAlternates || []).length;

  // 4) A real credit can no longer be applied.
  const realDeduct = await call("real deduct after bids arrive", () => c.mutation("coordination:deductDoubleBuyCredit", {
    projectId, clashId: "clash-vfd-01", tradePackageId: hvac, deductAmount: 38500, description: "QA23 real VFD credit",
  }));
  const phantom = vfd?.status === "deducted" && vfd?.deductedAmount === 38500 && veApplied === 0 && eBidRow?.leveledTotalCost === 410_000;
  record(
    "A23-06.phantom-credit",
    "zero-evidence intent credit: detect shows deducted $38,500, no bid reduced, and the real credit is permanently refused (no reverse mutation exists)",
    intent.ok && phantom && !realDeduct.ok && /already been applied/i.test(realDeduct.data || ""),
    {
      intent: intent.ok ? intent.value : intent.data,
      vfd: vfd ? { status: vfd.status, deductedAmount: vfd.deductedAmount } : null,
      elecBidLeveled: eBidRow?.leveledTotalCost,
      veApplied,
      realDeduct: { ok: realDeduct.ok, data: realDeduct.data },
      reachability: "API-only (post-A21-01 detect returns no cards with zero priced evidence, so the UI offers no deduct affordance)",
      reverseMutationExists: false,
    }
  );

  const deleted = await purgeQa23(c, say);
  record("A23-06.cleanup", "temporary AUDIT-QA23-INTENT fixture purged", deleted >= 1, { deleted });

  writeEvidence("06-intent-probe", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
  writeLog("06-intent-probe", log);
  console.log(`intent probe: ${results.filter((r) => r.pass).length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("06-intent-probe-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});