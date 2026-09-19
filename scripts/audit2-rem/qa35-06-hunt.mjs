/**
 * QA35-06 adversarial HUNT (backend) around the clash-keyed credit identity fix.
 * Fresh AUDIT-QA35-HUNT project: 26(800k) + 23 two bids B1(480k)/B2(497k) + accepted
 * manual VFD $26,500 -> both redundancies equal $12,000.
 *  H1  symmetric isolation: reverse the DISCONNECT credit only -> VFD survives
 *  H2  award switch with equal-amount credits: reverse VFD while B2 awarded -> carrier B1
 *      row removed, B2 + agreement untouched
 *  H3  re-deduct targets awarded B2 -> B2/agreement sync; B1's disconnect survives
 *  H4  execute B2 -> reverse the disconnect credit carried on non-awarded B1 -> executed
 *      agreement untouched, B1 restored
 *  H5  orphan marker injection: accepted [clash-...] row with NO resolution must NOT
 *      fabricate a deducted card or KPI claim
 * Any Medium+ becomes a finding.
 */
import { client, fixtureTitle, writeEvidence, writeLog, call, creditRows, creditClashId, recomputeLeveled } from "./qa35-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const findings = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1500)}`);
};
const finding = (id, severity, title, evidence) => {
  findings.push({ id, severity, title, evidence });
  say(`FINDING ${id} [${severity}] ${title}`);
};

const VFD = "Variable Frequency Drives (VFDs) for AHUs & Pumps";
const DISC = "Rooftop Mechanical Equipment Disconnect Switches";
const TITLE = fixtureTitle("HUNT");

const bidById = async (projectId, bidId) => (await c.query("bids:listAllProjectBids", { projectId })).find((b) => b._id === bidId);
const detect = (projectId) => c.query("coordination:detectCrossTradeClashes", { projectId });
const agreementsOf = (projectId) => c.query("agreements:listAgreements", { projectId });
const rowsOf = (b) => creditRows(b).map((v) => ({ clashId: creditClashId(v.description), amount: v.costDeduct || 0, accepted: !!v.isAccepted }));

async function main() {
  for (const p of ((await c.query("projects:listProjects", {})) || []).filter((x) => x.title === TITLE)) {
    const agrs = (await agreementsOf(p._id)) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try { await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA35 hunt purge." }); } catch {}
    }
    try { await c.mutation("projects:deleteProject", { projectId: p._id }); } catch {}
  }
  const dl = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  const id = await c.mutation("projects:createProject", { title: TITLE, location: "Austin, TX", projectType: "Class-A Commercial", estBudget: 1600000, targetCompletionWeeks: 52, specDocumentText: "QA35 HUNT scope.", isDemoProject: false, generalContractorName: "QA35 HUNT GC" });
  const p26 = await c.mutation("tradePackages:createTradePackage", { projectId: id, csiDivision: "26 00 00", tradeName: "QA35 HUNT Electrical", budgetEstimate: 900000, scopeSummary: "Electrical scope.", mandatoryInclusions: ["General scope"], bidDeadline: dl });
  const p23 = await c.mutation("tradePackages:createTradePackage", { projectId: id, csiDivision: "23 00 00", tradeName: "QA35 HUNT HVAC", budgetEstimate: 600000, scopeSummary: "HVAC scope.", mandatoryInclusions: ["General scope"], bidDeadline: dl });
  const c26 = await c.mutation("contractors:createContractor", { tradePackageId: p26, companyName: "AUDIT-QA35 HUNT Electric", contactEmail: "estimating@qa35-hunt-e.invalid", phone: "+1 (206) 555-0121", licenseNumber: "TX-QA35-HUNT-E", licenseStatus: "Active / Verified (QA35)", sourceUrl: "https://qa35.example.invalid/license", rfqStatus: "invited" });
  const c23a = await c.mutation("contractors:createContractor", { tradePackageId: p23, companyName: "AUDIT-QA35 HUNT Mechanical B1", contactEmail: "estimating@qa35-hunt-m1.invalid", phone: "+1 (206) 555-0122", licenseNumber: "TX-QA35-HUNT-M1", licenseStatus: "Active / Verified (QA35)", sourceUrl: "https://qa35.example.invalid/license", rfqStatus: "invited" });
  const c23b = await c.mutation("contractors:createContractor", { tradePackageId: p23, companyName: "AUDIT-QA35 HUNT Mechanical B2", contactEmail: "estimating@qa35-hunt-m2.invalid", phone: "+1 (206) 555-0123", licenseNumber: "TX-QA35-HUNT-M2", licenseStatus: "Active / Verified (QA35)", sourceUrl: "https://qa35.example.invalid/license", rfqStatus: "invited" });
  const b26 = await c.mutation("bids:submitDirectBid", { tradePackageId: p26, contractorId: c26, subcontractorName: "AUDIT-QA35 HUNT Electric", baseBidAmount: 800000, coiComplianceStatus: "compliant", coiPenalty: 0 });
  const b1 = await c.mutation("bids:submitDirectBid", { tradePackageId: p23, contractorId: c23a, subcontractorName: "AUDIT-QA35 HUNT Mechanical B1", baseBidAmount: 480000, coiComplianceStatus: "compliant", coiPenalty: 0 });
  const b2 = await c.mutation("bids:submitDirectBid", { tradePackageId: p23, contractorId: c23b, subcontractorName: "AUDIT-QA35 HUNT Mechanical B2", baseBidAmount: 497000, coiComplianceStatus: "compliant", coiPenalty: 0 });
  await c.mutation("bids:updateBidAdjustments", { bidId: b1.bidId, identifiedExclusions: [], valueEngineeringAlternates: [{ description: "VFD factory pricing credit (manual entry)", costDeduct: 26500, isAccepted: true }], leadTimePenalty: 0, coiPenalty: 0 });
  const B1 = b1.bidId, B2 = b2.bidId;

  const pre = await detect(id);
  const preV = pre.doubleBuys.find((x) => x.id === "clash-vfd-01");
  const preD = pre.doubleBuys.find((x) => x.id === "clash-disconnect-02");
  record("A35-HUNT.0", "HUNT precondition: two HVAC bids; both equal-amount redundancies exactly $12,000 on B1", preV.redundantAmount === 12000 && preD.redundantAmount === 12000, { vfd: preV.redundantAmount, disc: preD.redundantAmount });

  const dV = await call("hunt.deduct.vfd", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 12000, description: VFD, bidId: B1 }));
  const dD = await call("hunt.deduct.disc", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-disconnect-02", tradePackageId: p23, deductAmount: 12000, description: DISC, bidId: B1 }));
  const b1a = await bidById(id, B1);
  record("A35-HUNT.1", "both equal credits applied to B1 (429,500); markers distinct", dV.ok && dD.ok && b1a.leveledTotalCost === 429500 && rowsOf(b1a).length === 2, { leveled: b1a.leveledTotalCost, rows: rowsOf(b1a) });

  // H1: reverse DISCONNECT only -> VFD survives
  const rD = await call("hunt.reverse.disc", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-disconnect-02", tradePackageId: p23 }));
  const b1b = await bidById(id, B1);
  const d1 = await detect(id);
  const h1 = rD.ok && rD.value?.reversedAmount === 12000 && b1b.leveledTotalCost === 441500 && rowsOf(b1b).length === 1 && rowsOf(b1b)[0].clashId === "clash-vfd-01" && d1.doubleBuys.find((x) => x.id === "clash-vfd-01").status === "deducted" && d1.doubleBuys.find((x) => x.id === "clash-disconnect-02").status === "detected";
  if (!h1) finding("A35-H1", "Medium", "Symmetric equal-amount reversal failed: reversing disconnect did not isolate from VFD", { result: rD.value ?? rD.data, leveled: b1b.leveledTotalCost, rows: rowsOf(b1b), cards: { vfd: d1.doubleBuys.find((x) => x.id === "clash-vfd-01").status, disc: d1.doubleBuys.find((x) => x.id === "clash-disconnect-02").status } });
  record("A35-HUNT.2", "symmetric isolation: reverse DISCONNECT only -> VFD credit survives on B1, disconnect card detected, bid 441,500", h1, { reversedAmount: rD.value?.reversedAmount, leveled: b1b.leveledTotalCost, rows: rowsOf(b1b) });

  // re-apply disconnect so both equal credits live on B1 again
  await call("hunt.rededuct.disc", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-disconnect-02", tradePackageId: p23, deductAmount: 12000, description: DISC, bidId: B1 }));
  const b1c = await bidById(id, B1);

  // H2: award B2 while credits live on B1; reverse VFD -> must hit B1 (carrier), not B2
  const award = await call("hunt.award.B2", () => c.mutation("agreements:generateAgreement", { bidId: B2, tradePackageId: p23 }));
  const b2a = await bidById(id, B2);
  const rV = await call("hunt.reverse.vfd.awarded", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
  const b1d = await bidById(id, B1);
  const b2b = await bidById(id, B2);
  const agr2a = (await agreementsOf(id)).find((a) => a._id === award.value?._id);
  const h2 = b1c.leveledTotalCost === 429500 && award.ok && b2a.isAwarded === true && rV.ok && b1d.leveledTotalCost === 441500 && rowsOf(b1d).length === 1 && rowsOf(b1d)[0].clashId === "clash-disconnect-02" && b2b.leveledTotalCost === 497000 && agr2a?.contractSum === 497000;
  if (!h2) finding("A35-H2", "Medium", "Award-switch with equal-amount credits: reversal did not isolate to the carrier bid", { reversed: rV.value ?? rV.data, b1: { leveled: b1d.leveledTotalCost, rows: rowsOf(b1d) }, b2: { leveled: b2b.leveledTotalCost, awarded: b2b.isAwarded }, agreement: agr2a?.contractSum });
  record("A35-HUNT.3", "award switch: reverse VFD removes the B1 carrier row only; awarded B2 and its agreement stay 497,000; B1's disconnect survives", h2, { reversed: rV.value ?? rV.data, b1: b1d.leveledTotalCost, b2: b2b.leveledTotalCost, agreement: agr2a?.contractSum });

  // H3: re-deduct VFD targets the awarded B2; B1 disconnect untouched
  const dV2 = await call("hunt.rededuct.vfd.awarded", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 12000, description: VFD }));
  const b1e = await bidById(id, B1);
  const b2c = await bidById(id, B2);
  const agr2b = (await agreementsOf(id)).find((a) => a._id === award.value?._id);
  const h3 = dV2.ok && dV2.value?.bidId === B2 && b2c.leveledTotalCost === 485000 && agr2b?.contractSum === 485000 && b1e.leveledTotalCost === 441500 && rowsOf(b1e).length === 1;
  if (!h3) finding("A35-H3", "Medium", "Re-deduct with awarded alternate did not target the awarded carrier or desynced its agreement", { result: dV2.value ?? dV2.data, b2: b2c.leveledTotalCost, agreement: agr2b?.contractSum, b1: b1e.leveledTotalCost });
  record("A35-HUNT.4", "re-deduct targets awarded B2: B2 485,000, agreement synced 485,000, B1 disconnect untouched 441,500", h3, { result: dV2.value, b2: b2c.leveledTotalCost, agreement: agr2b?.contractSum, b1: b1e.leveledTotalCost });

  // H4: reverse VFD from B2 again, execute B2, then reverse the disconnect credit on B1 (non-awarded)
  await call("hunt.reverse.vfd.again", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
  const exec = await call("hunt.execute.B2", () => c.mutation("agreements:executeAgreement", { agreementId: award.value?._id }));
  const rD2 = await call("hunt.reverse.disc.executed-package", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-disconnect-02", tradePackageId: p23 }));
  const b1f = await bidById(id, B1);
  const b2d = await bidById(id, B2);
  const agr2c = (await agreementsOf(id)).find((a) => a._id === award.value?._id);
  const h4 = exec.ok && rD2.ok && rD2.value?.reversedAmount === 12000 && b1f.leveledTotalCost === 453500 && creditRows(b1f).length === 0 && b2d.leveledTotalCost === 497000 && agr2c?.status === "executed" && agr2c?.contractSum === 497000 && recomputeLeveled(b2d) === 497000;
  if (!h4) finding("A35-H4", "Medium", "Credit reversal on a non-awarded carrier disturbed the executed agreement or left the bid unrestored", { reversed: rD2.value ?? rD2.data, b1: b1f.leveledTotalCost, b2: b2d.leveledTotalCost, agreement: { status: agr2c?.status, sum: agr2c?.contractSum } });
  record("A35-HUNT.5", "execute B2 then reverse the disconnect credit carried on non-awarded B1: B1 restored to 453,500, executed B2/agreement untouched 497,000", h4, { reversed: rD2.value ?? rD2.data, b1: b1f.leveledTotalCost, b2: b2d.leveledTotalCost, agreement: { status: agr2c?.status, sum: agr2c?.contractSum } });

  // H5: orphan marker injection - accepted [clash-disconnect-02] row with NO resolution
  const inject = await call("hunt.inject.orphan.marker", () => c.mutation("bids:updateBidAdjustments", {
    bidId: B1,
    identifiedExclusions: [],
    valueEngineeringAlternates: (b1f.valueEngineeringAlternates || []).concat([{ description: "Cross-Trade Clash Credit [clash-disconnect-02]: Deduct redundant orphan marker probe", costDeduct: 12000, isAccepted: true }]),
    leadTimePenalty: 0,
    coiPenalty: 0,
  }));
  const beforeOrphan = await detect(id);
  const b1g = await bidById(id, B1);
  const orphanCard = beforeOrphan.doubleBuys.find((x) => x.id === "clash-disconnect-02");
  const phantom = orphanCard.status === "deducted" || orphanCard.deductedAmount === 12000;
  if (phantom) finding("A35-H5", "Medium", "Orphan clash-marker row without a persisted resolution fabricated a deducted card", { card: { status: orphanCard.status, amount: orphanCard.deductedAmount, stale: orphanCard.staleResolution }, leveled: b1g.leveledTotalCost });
  record("A35-HUNT.6", "orphan clash-marker row with no resolution does NOT fabricate a deducted card or stale claim (manual VE deduction only)", inject.ok && !phantom && b1g.leveledTotalCost === 441500 && orphanCard.status === "detected" && !orphanCard.staleResolution, { card: { status: orphanCard.status, amount: orphanCard.deductedAmount, stale: orphanCard.staleResolution }, leveled: b1g.leveledTotalCost, rows: rowsOf(b1g) });
  await call("hunt.remove.orphan", () => c.mutation("bids:updateBidAdjustments", { bidId: B1, identifiedExclusions: [], valueEngineeringAlternates: (b1g.valueEngineeringAlternates || []).filter((v) => !String(v.description).startsWith("Cross-Trade Clash Credit")), leadTimePenalty: 0, coiPenalty: 0 }));

  writeEvidence("hunt", { projectId: id, p23, b1: B1, b2: B2, results, findings, summary: { pass: results.filter((r) => r.pass).length, total: results.length, findings: findings.length } });
  writeLog("hunt", log);
  console.log(`hunt: ${results.filter((r) => r.pass).length}/${results.length} pass, ${findings.length} findings`);
  if (findings.length) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeEvidence("hunt", { results: [...results, { id: "A35-06.ERR", pass: false, name: "aborted", detail: String(e?.stack ?? e) }], findings });
  writeLog("hunt", [...log, String(e?.stack ?? e)]);
  process.exit(1);
});