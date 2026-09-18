/**
 * QA8 focused backend probe — duplicate deduction on the same clashId with a
 * description that is not a substring of the prior credit description.
 * Fixture: AUDIT-QA8-dupededuct-2026-09-18.
 */
import { client, fixtureName, writeEvidence } from "./qa8-lib.mjs";

const c = client();
const prefix = fixtureName("dupededuct");
const out = { ranAt: new Date().toISOString(), checks: [] };
const checks = [];
const add = (id, label, ok, observed) => {
  checks.push({ id, label, ok, observed: String(observed).slice(0, 400) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id} ${label} :: ${String(observed).slice(0, 250)}`);
};

try {
  const projectId = await c.mutation("projects:createProject", {
    title: prefix,
    location: "Austin, TX",
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: 2_000_000,
    targetCompletionWeeks: 30,
    specDocumentText: "QA8 duplicate deduct probe.",
    isDemoProject: false,
  });
  const p26 = await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision: "26 00 00",
    tradeName: "QA8 DD Electrical",
    budgetEstimate: 1_000_000,
    scopeSummary: "DD elec.",
    mandatoryInclusions: ["Code compliance"],
    bidDeadline: "2026-10-31",
  });
  const p23 = await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision: "23 00 00",
    tradeName: "QA8 DD Mechanical",
    budgetEstimate: 1_000_000,
    scopeSummary: "DD mech.",
    mandatoryInclusions: ["Code compliance"],
    bidDeadline: "2026-10-31",
  });
  const contractor = await c.mutation("contractors:createContractor", {
    tradePackageId: p23,
    companyName: "QA8 DD Mech Co",
    contactEmail: "dd@qa8.test",
    phone: "+1 (512) 555-0188",
    licenseNumber: "TX-QA8-DD",
    licenseStatus: "Active / Verified",
    sourceUrl: "https://qa8.test/dd",
    rfqStatus: "invited",
  });
  const bid = await c.mutation("bids:submitDirectBid", {
    tradePackageId: p23,
    contractorId: contractor,
    subcontractorName: "QA8 DD Mech Co",
    baseBidAmount: 1_000_000,
  });

  const before = (await c.query("bids:listByPackage", { tradePackageId: p23 })).find((b) => b._id === bid.bidId);
  const d1 = await c.mutation("coordination:deductDoubleBuyCredit", {
    projectId,
    clashId: "clash-vfd-01",
    tradePackageId: p23,
    deductAmount: 38500,
    description: "Variable Frequency Drives (VFDs) for AHUs & Pumps",
  });
  const after1 = (await c.query("bids:listByPackage", { tradePackageId: p23 })).find((b) => b._id === bid.bidId);
  let d2 = null;
  let d2err = null;
  try {
    d2 = await c.mutation("coordination:deductDoubleBuyCredit", {
      projectId,
      clashId: "clash-vfd-01",
      tradePackageId: p23,
      deductAmount: 38500,
      description: "Second credit for the same VFD clash retry",
    });
  } catch (err) {
    d2err = err?.data ?? err?.message ?? String(err);
  }
  const after2 = (await c.query("bids:listByPackage", { tradePackageId: p23 })).find((b) => b._id === bid.bidId);
  const detect = await c.query("coordination:detectCrossTradeClashes", { projectId });

  out.probe = {
    before: { ve: (before.valueEngineeringAlternates || []).length, leveled: before.leveledTotalCost },
    deduct1: d1,
    after1: { ve: (after1.valueEngineeringAlternates || []).map((v) => ({ d: v.description, c: v.costDeduct })), leveled: after1.leveledTotalCost },
    deduct2: d2,
    deduct2Error: d2err,
    after2: { ve: (after2.valueEngineeringAlternates || []).map((v) => ({ d: v.description, c: v.costDeduct })), leveled: after2.leveledTotalCost },
    clashStatus: detect.doubleBuys.find((x) => x.id === "clash-vfd-01")?.status,
    resolutionCount: null,
  };
  const stacked = (after2.valueEngineeringAlternates || []).length > (after1.valueEngineeringAlternates || []).length;
  const doubleDeducted = after1.leveledTotalCost === 961_500 && after2.leveledTotalCost === 923_000;
  add("DD-1", "same clashId second distinct-description deduction is rejected", !stacked, `ve=${(after2.valueEngineeringAlternates || []).length} secondResult=${d2 ? "accepted" : "rejected:" + d2err}`);
  add("DD-2", "bid leveled cost not reduced twice for one clash", !doubleDeducted, `after1=${after1.leveledTotalCost} after2=${after2.leveledTotalCost}`);
  add("DD-3", "clash status remains deducted after duplicate attempt", out.probe.clashStatus === "deducted", out.probe.clashStatus);
} catch (err) {
  out.fatal = String(err?.stack ?? err);
  console.error("FATAL", err);
} finally {
  const all = await c.query("projects:listProjects", {});
  out.cleanup = { deleted: [], leftover: [] };
  for (const p of all.filter((p) => p.title.startsWith("AUDIT-QA8-"))) {
    try {
      await c.mutation("projects:deleteProject", { projectId: p._id });
      out.cleanup.deleted.push(p._id);
    } catch (err) {
      out.cleanup.deleted.push(`${p._id}:FAILED:${err?.message ?? err}`);
    }
  }
  out.checks = checks;
  writeEvidence("33-dupe-deduct", out);
  const failed = checks.filter((k) => !k.ok);
  console.log(`\nQA8-33 done. checks=${checks.length} failed=${failed.length} leftover=${out.cleanup.leftover.length}`);
  for (const f of failed) console.log(`  FAIL ${f.id} ${f.label}: observed=${f.observed}`);
}