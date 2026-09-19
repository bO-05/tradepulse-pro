/**
 * QA20-02 backend state machine + rollback sweep on AUDIT-QA20-STATE.
 * Every check records observed vs expected. Deterministic.
 */
import { client, readEvidence, writeEvidence, writeLog, projectSnapshot, sleep, call } from "./qa20-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const STATE = F.state.id;
const S1 = F.state.s1;
const S2 = F.state.s2;
const S3 = F.state.s3;
const B = F.state.bids;
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 600)}`);
};

async function violationScan(projectId) {
  const [packages, agreements, bids] = await Promise.all([
    c.query("tradePackages:listByProject", { projectId }),
    c.query("agreements:listAgreements", { projectId }),
    c.query("bids:listAllProjectBids", { projectId }),
  ]);
  const out = [];
  const activeByPkg = new Map();
  for (const a of agreements || []) {
    if (a.status !== "superseded") activeByPkg.set(a.tradePackageId, (activeByPkg.get(a.tradePackageId) || 0) + 1);
  }
  for (const [pkgId, n] of activeByPkg) if (n > 1) out.push({ kind: "two_active_agreements", pkgId, n });
  for (const a of agreements || []) {
    const bid = (bids || []).find((b) => b._id === a.bidId);
    if (!bid) out.push({ kind: "agreement_bid_missing", agreement: a.agreementNumber, status: a.status });
    if (a.status === "executed" && bid && !bid.isAwarded) out.push({ kind: "executed_agreement_bid_not_awarded", agreement: a.agreementNumber });
    const pkg = (packages || []).find((x) => x._id === a.tradePackageId);
    if (!pkg) out.push({ kind: "agreement_pkg_missing", agreement: a.agreementNumber });
    if (a.status === "generated" && pkg && pkg.status !== "awarded") out.push({ kind: "generated_agreement_pkg_not_awarded", agreement: a.agreementNumber, pkgStatus: pkg.status });
  }
  for (const pkg of packages || []) {
    const pkgBids = (bids || []).filter((b) => b.tradePackageId === pkg._id);
    const awarded = pkgBids.filter((b) => b.isAwarded);
    if (awarded.length > 1) out.push({ kind: "two_awarded_bids", pkg: pkg.csiDivision, n: awarded.length });
    if (pkg.status === "awarded" && awarded.length === 0 && !activeByPkg.has(pkg._id)) out.push({ kind: "awarded_flag_without_evidence", pkg: pkg.csiDivision });
    if (awarded.length > 0 && pkg.status !== "awarded") out.push({ kind: "awarded_bid_but_pkg_not_awarded", pkg: pkg.csiDivision, status: pkg.status });
  }
  return out;
}

async function countLogs(projectId, match) {
  const logs = (await c.query("auditLogs:listRecentLogs", { projectId, limit: 500 })) || [];
  return logs.filter(match).length;
}

async function main() {
  const pre = await projectSnapshot(c, STATE);
  record("A20-02.0", "pre-state clean", (await violationScan(STATE)).length === 0, { pkgStatuses: pre.packages.map((p) => `${p.csiDivision}:${p.status}`) });

  // ---------- Phase 1: award + execute + idempotent execute ----------
  const agr = await c.mutation("agreements:generateAgreement", { bidId: B.s1B.bidId, tradePackageId: S1 });
  let snap = await projectSnapshot(c, STATE);
  record(
    "A20-02.1",
    "generateAgreement awards bid + package with one active agreement",
    agr.status === "generated" && snap.bids.find((b) => b._id === B.s1B.bidId)?.isAwarded === true &&
      snap.packages.find((p) => p._id === S1)?.status === "awarded" &&
      snap.agreements.filter((a) => a.tradePackageId === S1 && a.status !== "superseded").length === 1,
    { agr: agr.agreementNumber, status: agr.status }
  );
  const exec1 = await call("execute#1", () => c.mutation("agreements:executeAgreement", { agreementId: agr._id }));
  const exec2 = await call("execute#2 (double)", () => c.mutation("agreements:executeAgreement", { agreementId: agr._id }));
  const execLogs = await countLogs(STATE, (l) => l.title === "AIA A401 Execution Status Recorded" && l.description.includes(agr.agreementNumber));
  snap = await projectSnapshot(c, STATE);
  record(
    "A20-02.2",
    "double execute idempotent + single audit record",
    exec1.ok && exec2.ok && snap.agreements.find((a) => a._id === agr._id)?.status === "executed" && execLogs === 1,
    { exec1: exec1.ok, exec2: exec2.ok, execLogs }
  );

  // ---------- Phase 2: immutability / rollback guards while executed ----------
  const bidBefore = snap.bids.find((b) => b._id === B.s1B.bidId);
  const pkgBefore = snap.packages.find((p) => p._id === S1);
  const inclBefore = JSON.stringify(pkgBefore.mandatoryInclusions);
  const veBefore = JSON.stringify(bidBefore.valueEngineeringAlternates || []);

  const delProj = await call("deleteProject", () => c.mutation("projects:deleteProject", { projectId: STATE }));
  const delPkg = await call("deleteTradePackage", () => c.mutation("tradePackages:deleteTradePackage", { tradePackageId: S1 }));
  const delBid = await call("deleteBid", () => c.mutation("bids:deleteBid", { bidId: B.s1B.bidId }));
  const revise = await call("revision submitDirectBid", () => c.mutation("bids:submitDirectBid", { tradePackageId: S1, contractorId: F.state.contractors.s1B, subcontractorName: "AUDIT-QA20 State Air Two", baseBidAmount: 690000 }));
  const unaward = await call("unawardContract", () => c.mutation("bids:unawardContract", { bidId: B.s1B.bidId, tradePackageId: S1 }));
  const adjust = await call("updateBidAdjustments", () => c.mutation("bids:updateBidAdjustments", { bidId: B.s1B.bidId, identifiedExclusions: [{ description: "QA20 tamper", costImpact: 5000, severity: "minor" }] }));
  const deduct = await call("deductDoubleBuyCredit", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: STATE, clashId: "QA20-CLASH-1", tradePackageId: S1, deductAmount: 50000, description: "QA20 redundant VFD double-buy" }));
  const assignVoid = await call("assignScopeVoidToTrade", () => c.mutation("coordination:assignScopeVoidToTrade", { projectId: STATE, voidId: "QA20-VOID-1", tradePackageId: S1, additionalCost: 28000, description: "QA20 BAS control wiring void" }));
  const fullCycle = await call("runFullProcurementCycle", () => c.mutation("simulation:runFullProcurementCycle", { projectId: STATE, tradePackageId: S1 }));

  const mid = await projectSnapshot(c, STATE);
  const bidMid = mid.bids.find((b) => b._id === B.s1B.bidId);
  const pkgMid = mid.packages.find((p) => p._id === S1);
  const clashCount = (await c.query("coordination:detectCrossTradeClashes", { projectId: STATE }))?.resolutions?.filter?.((r) => r.clashId === "QA20-CLASH-1").length ?? "n/a";
  record(
    "A20-02.3",
    "all executed-contract guards refuse without destructive side-effects",
    [delProj, delPkg, delBid, revise, unaward, adjust, deduct, assignVoid, fullCycle].every((r) => !r.ok) &&
      bidMid && JSON.stringify(bidMid.valueEngineeringAlternates || []) === veBefore &&
      JSON.stringify(pkgMid.mandatoryInclusions) === inclBefore &&
      mid.bids.filter((b) => b.tradePackageId === S1).length === 2 &&
      (clashCount === 0 || clashCount === "n/a") &&
      (await violationScan(STATE)).length === 0,
    {
      refusals: { delProj: delProj.ok, delPkg: delPkg.ok, delBid: delBid.ok, revise: revise.ok, unaward: unaward.ok, adjust: adjust.ok, deduct: deduct.ok, assignVoid: assignVoid.ok, fullCycle: fullCycle.ok },
      deductMsg: String(deduct.data ?? deduct.message).slice(0, 160),
      assignMsg: String(assignVoid.data ?? assignVoid.message).slice(0, 160),
      fullCycleMsg: String(fullCycle.data ?? fullCycle.message).slice(0, 160),
      s1Bids: mid.bids.filter((b) => b.tradePackageId === S1).length,
      clashCount,
    }
  );

  // ---------- Phase 3: void lifecycle ----------
  const shortVoid = await call("void too short", () => c.mutation("agreements:voidExecutedAgreement", { agreementId: agr._id, reason: "mistake" }));
  const void1 = await call("void#1", () => c.mutation("agreements:voidExecutedAgreement", { agreementId: agr._id, reason: "QA20 test: recorded in error, external amendment pending." }));
  const void2 = await call("void#2 (double)", () => c.mutation("agreements:voidExecutedAgreement", { agreementId: agr._id, reason: "QA20 test: second void should refuse clearly." }));
  const execAfterVoid = await call("execute superseded", () => c.mutation("agreements:executeAgreement", { agreementId: agr._id }));
  const awardAfterVoid = await call("awardContract after void", () => c.mutation("bids:awardContract", { bidId: B.s1B.bidId, tradePackageId: S1 }));
  let snap3 = await projectSnapshot(c, STATE);
  const a3 = snap3.agreements.find((x) => x._id === agr._id);
  const voidLogs = await countLogs(STATE, (l) => l.title.startsWith("Executed Subcontract Voided"));
  record(
    "A20-02.4",
    "void: rejects short/double, supersedes, unawards, reopens, audits",
    !shortVoid.ok && void1.ok && !void2.ok && !execAfterVoid.ok && !awardAfterVoid.ok &&
      a3?.status === "superseded" &&
      snap3.bids.find((b) => b._id === B.s1B.bidId)?.isAwarded === false &&
      snap3.packages.find((p) => p._id === S1)?.status === "leveling" &&
      voidLogs === 1,
    { short: shortVoid.ok, v1: void1.ok, v2: void2.ok, exec: execAfterVoid.ok, award: awardAfterVoid.ok, status: a3?.status, voidLogs }
  );

  // Re-award same bid, execute, then void and award the other bid.
  const reagr = await c.mutation("agreements:generateAgreement", { bidId: B.s1B.bidId, tradePackageId: S1 });
  await c.mutation("agreements:executeAgreement", { agreementId: reagr._id });
  await c.mutation("agreements:voidExecutedAgreement", { agreementId: reagr._id, reason: "QA20 test: supersede for alternate award test." });
  const otherAgr = await c.mutation("agreements:generateAgreement", { bidId: B.s1A.bidId, tradePackageId: S1 });
  const snap4 = await projectSnapshot(c, STATE);
  const activeS1 = snap4.agreements.filter((a) => a.tradePackageId === S1 && a.status !== "superseded");
  record(
    "A20-02.5",
    "re-award alternate bid leaves exactly one active agreement and one awarded bid",
    activeS1.length === 1 && activeS1[0].bidId === B.s1A.bidId &&
      snap4.bids.filter((b) => b.tradePackageId === S1 && b.isAwarded).length === 1 &&
      snap4.bids.find((b) => b._id === B.s1B.bidId)?.isAwarded === false &&
      (await violationScan(STATE)).length === 0,
    { active: activeS1.map((a) => `${a.agreementNumber}:${a.status}:${a.bidId === B.s1A.bidId ? "s1A" : "other"}`), violations: (await violationScan(STATE)).length }
  );

  // ---------- Phase 4: cron manual triggers ----------
  const s3Before = (await c.query("tradePackages:getPackage", { tradePackageId: S3 })).status;
  const cron1 = await call("cron#1", () => c.mutation("crons:runDeadlineMonitorNow", { projectId: STATE }));
  const cron2 = await call("cron#2", () => c.mutation("crons:runDeadlineMonitorNow", { projectId: STATE }));
  const comp = await call("compliance#1", () => c.mutation("crons:runComplianceAuditNow", { projectId: STATE }));
  const s3After = (await c.query("tradePackages:getPackage", { tradePackageId: S3 })).status;
  const deadlineFlagLogs = await countLogs(STATE, (l) => l.title.startsWith("Deadline passed with no bids"));
  const manualLogs = await countLogs(STATE, (l) => l.title === "Manual Trigger: Bid Deadline Monitor Executed");
  record(
    "A20-02.6",
    "manual cron: no premature flag, idempotent per-run logs, compliance sweep intact",
    cron1.ok && cron2.ok && comp.ok && s3Before === "draft" && s3After === "draft" && deadlineFlagLogs === 0 && manualLogs === 2 && comp.value?.verifiedCount >= 3,
    { s3: `${s3Before}->${s3After}`, deadlineFlagLogs, manualLogs, verified: comp.value?.verifiedCount, coi: comp.value?.coiDeficiencies }
  );

  // ---------- Phase 5: S2 delete cascade (no executed) ----------
  const delS2 = await call("delete S2 awarded-free", () => c.mutation("tradePackages:deleteTradePackage", { tradePackageId: S2 }));
  const snap5 = await projectSnapshot(c, STATE);
  record("A20-02.7", "unwalled package delete cascades (control)", delS2.ok && snap5.bids.every((b) => b.tradePackageId !== S2), { delS2: delS2.ok });

  const finalViolations = await violationScan(STATE);
  record("A20-02.8", "final state-machine scan clean", finalViolations.length === 0, { violations: finalViolations });

  writeEvidence("state-machine", { results, finalViolations, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
  writeLog("state-machine", log);
  console.log(`state machine: ${results.filter((r) => r.pass).length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("state-machine-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});