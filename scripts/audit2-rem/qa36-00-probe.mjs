/**
 * QA36-00 probe (AUDIT-QA36-PROBE only):
 *  1) confirm the live backend mints the clash-keyed marker (post FIX-NEW-75/76)
 *  2) cross-package reverse probe: reverse a live credit while passing the
 *     sibling package id of the SAME project (valid id, wrong carrier side)
 *  3) re-deduct after that state and measure stacked real money vs KPI
 *  4) amount-drift probe: edit the accepted marker row amount through the
 *     public leveling mutation and compare card/KPI vs real accepted credit
 * Deletes its own project at the end.
 */
import {
  client, fixtureTitle, writeEvidence, writeLog, call, sleep,
  creditInvariants, getBid, detect, creditRows, creditClashId, recomputeLeveled,
  CLASH_VFD, VFD_TITLE,
} from "./qa36-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1800)}`);
};

const TITLE = fixtureTitle("PROBE");
const deadline = () => new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);

async function purge(cx = c) {
  const projects = (await cx.query("projects:listProjects", {})) || [];
  for (const p of projects.filter((x) => x.title.startsWith("AUDIT-QA36-"))) {
    const agrs = (await cx.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try { await cx.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA36 probe teardown." }); } catch {}
    }
    try { await cx.mutation("projects:deleteProject", { projectId: p._id }); say(`purged ${p.title}`); } catch (e) { say(`purge ${p.title} failed: ${e?.data ?? e?.message}`); }
    await sleep(250);
  }
}

async function main() {
  await purge();
  const pid = await c.mutation("projects:createProject", {
    title: TITLE, location: "Austin, TX", projectType: "Class-A Commercial Mixed-Use",
    estBudget: 1600000, targetCompletionWeeks: 52,
    specDocumentText: "QA36 probe fixture scope.", isDemoProject: false, generalContractorName: "QA36 Probe GC",
  });
  const dl = deadline();
  const p26 = await c.mutation("tradePackages:createTradePackage", { projectId: pid, csiDivision: "26 00 00", tradeName: "QA36 Probe Electrical", budgetEstimate: 900000, scopeSummary: "Electrical scope.", mandatoryInclusions: ["Per plans"], bidDeadline: dl });
  const p23 = await c.mutation("tradePackages:createTradePackage", { projectId: pid, csiDivision: "23 00 00", tradeName: "QA36 Probe HVAC", budgetEstimate: 600000, scopeSummary: "HVAC scope.", mandatoryInclusions: ["Per plans"], bidDeadline: dl });
  const c26 = await c.mutation("contractors:createContractor", { tradePackageId: p26, companyName: "AUDIT-QA36 Probe Electric", contactEmail: "estimating@qa36-probe-e.invalid", phone: "+1 (206) 555-0199", licenseNumber: "TX-QA36-PE", licenseStatus: "Active / Verified", sourceUrl: "https://qa36.example.invalid/license-e", rfqStatus: "invited" });
  const c23 = await c.mutation("contractors:createContractor", { tradePackageId: p23, companyName: "AUDIT-QA36 Probe Mechanical", contactEmail: "estimating@qa36-probe-m.invalid", phone: "+1 (206) 555-0199", licenseNumber: "TX-QA36-PM", licenseStatus: "Active / Verified", sourceUrl: "https://qa36.example.invalid/license-m", rfqStatus: "invited" });
  const b26 = await c.mutation("bids:submitDirectBid", { tradePackageId: p26, contractorId: c26, subcontractorName: "AUDIT-QA36 Probe Electric", baseBidAmount: 800000, identifiedExclusions: [], valueEngineeringAlternates: [], longLeadEquipmentWeeks: 8, leadTimePenalty: 0, coiComplianceStatus: "compliant", coiPenalty: 0 });
  const b23 = await c.mutation("bids:submitDirectBid", { tradePackageId: p23, contractorId: c23, subcontractorName: "AUDIT-QA36 Probe Mechanical", baseBidAmount: 480000, identifiedExclusions: [], valueEngineeringAlternates: [], longLeadEquipmentWeeks: 8, leadTimePenalty: 0, coiComplianceStatus: "compliant", coiPenalty: 0 });

  // 1. marker minted?
  const d1 = await call("deduct.vfd", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: pid, clashId: CLASH_VFD, tradePackageId: p23, deductAmount: 38500, description: VFD_TITLE }));
  const b1 = await getBid(c, pid, b23.bidId);
  const inv1 = await creditInvariants(c, pid);
  const marker = creditRows(b1)[0];
  record("A36-00.1", "live backend mints clash-keyed marker; bid 441,500; card/KPI/actual reconcile",
    d1.ok && Boolean(marker) && creditClashId(marker.description) === CLASH_VFD && marker.isAccepted === true &&
      b1.leveledTotalCost === 441500 && recomputeLeveled(b1) === 441500 &&
      inv1.clean && inv1.claimsTotal === 38500 && inv1.actualTotal === 38500,
    { desc: marker?.description?.slice(0, 110), leveled: b1.leveledTotalCost, inv: inv1.summary });

  // 2. cross-package reverse (same project, sibling package id = valid)
  const revWrong = await call("reverse.with.sibling.package", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: pid, clashId: CLASH_VFD, tradePackageId: p26 }));
  await sleep(600);
  const b2 = await getBid(c, pid, b23.bidId);
  const inv2 = await creditInvariants(c, pid);
  record("A36-00.2", "cross-package reverse: mutation accepts the sibling package; HVAC bid still carries the accepted credit",
    revWrong.ok === true && b2.leveledTotalCost === 441500 && creditRows(b2).some((r) => r.isAccepted),
    { reverse: revWrong.value ?? { data: revWrong.data, message: revWrong.message }, leveled: b2.leveledTotalCost, rows: creditRows(b2).map((r) => ({ id: creditClashId(r.description), a: r.costDeduct, acc: r.isAccepted })) });
  record("A36-00.2b", "after cross-package reverse the card flips to detected $38,500 while real money is still deducted (card/KPI vs actual divergence)",
    inv2.claimsTotal === 0 && inv2.actualTotal === 38500 && inv2.kpiVsActual === false && inv2.orphanCredit.length === 1,
    { summary: inv2.summary, cards: inv2.cards.filter((x) => x.kind === "double_buy").map((x) => ({ id: x.id, st: x.status, amt: x.deductedAmount, stale: x.staleResolution ?? false })), orphan: inv2.orphanCredit });

  // 3. re-deduct now: stacks a second credit on the same bid
  const d3 = await call("rededuct.vfd", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: pid, clashId: CLASH_VFD, tradePackageId: p23, deductAmount: 38500, description: VFD_TITLE }));
  await sleep(600);
  const b3 = await getBid(c, pid, b23.bidId);
  const inv3 = await creditInvariants(c, pid);
  record("A36-00.3", "re-deduct after the phantom clear stacks a second live credit on the same bid; KPI understates real deducted money",
    d3.ok && b3.leveledTotalCost === 403000 && inv3.actualTotal === 77000 && inv3.claimsTotal === 38500 && inv3.kpiVsActual === false && inv3.stacked.length === 1,
    { leveled: b3.leveledTotalCost, rows: creditRows(b3).map((r) => ({ id: creditClashId(r.description), a: r.costDeduct, acc: r.isAccepted })), summary: inv3.summary, stacked: inv3.stacked });

  // 4. amount-drift: reverse everything, re-deduct, then edit the accepted row amount
  await c.mutation("coordination:reverseDoubleBuyCredit", { projectId: pid, clashId: CLASH_VFD, tradePackageId: p23 });
  await sleep(300);
  // first reverse removed one row; second may clear stale
  const leftover = creditRows(await getBid(c, pid, b23.bidId));
  if (leftover.length > 0) {
    await call("cleanup.reverse2", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: pid, clashId: CLASH_VFD, tradePackageId: p23 }));
    await sleep(300);
  }
  const d4 = await call("deduct.vfd.again", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: pid, clashId: CLASH_VFD, tradePackageId: p23, deductAmount: 38500, description: VFD_TITLE }));
  const beforeEdit = await getBid(c, pid, b23.bidId);
  const edited = beforeEdit.valueEngineeringAlternates.map((v) =>
    String(v.description).startsWith("Cross-Trade Clash Credit") ? { ...v, costDeduct: 5000 } : v
  );
  const editRes = await call("edit.credit.amount", () => c.mutation("bids:updateBidLeveling", {
    bidId: b23.bidId, identifiedExclusions: [], valueEngineeringAlternates: edited, leadTimePenalty: 0, coiPenalty: 0,
  }));
  await sleep(500);
  const b4 = await getBid(c, pid, b23.bidId);
  const inv4 = await creditInvariants(c, pid);
  record("A36-00.4", "public leveling mutation can shrink the accepted credit row; card/KPI still claim the full resolution amount",
    d4.ok && editRes.ok && b4.leveledTotalCost === 475000 && inv4.claimsTotal === 38500 && inv4.actualTotal === 5000 && inv4.kpiVsActual === false && inv4.mismatchRow.length === 1,
    { leveled: b4.leveledTotalCost, summary: inv4.summary, mismatch: inv4.mismatchRow });

  await purge();
  writeEvidence("probe", { projectId: pid, results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
  writeLog("probe", log);
}

main().catch(async (e) => {
  console.error(e);
  writeLog("probe-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});