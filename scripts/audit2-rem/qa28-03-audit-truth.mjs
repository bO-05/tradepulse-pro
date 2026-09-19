/**
 * QA28-03 award/execute/void/re-award audit truth on AUDIT-QA28-AWARD:
 * every audit row must say exactly what happened at that step and nothing more.
 * Also probes awardContract guards (no agreement / superseded agreement).
 */
import { client, readEvidence, writeEvidence, writeLog, call, sleep } from "./qa28-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const steps = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1800)}`);
};

async function snapshot() {
  const [agrs, bids, pkgs, logs] = await Promise.all([
    c.query("agreements:listAgreements", { projectId: F.award.id }),
    c.query("bids:listAllProjectBids", { projectId: F.award.id }),
    c.query("tradePackages:listByProject", { projectId: F.award.id }),
    c.query("auditLogs:listRecentLogs", { projectId: F.award.id, limit: 400 }),
  ]);
  return {
    agrs: agrs || [],
    bids: bids || [],
    pkgs: pkgs || [],
    logs: logs || [],
  };
}

const relatedRows = (logs, agreementNumber) =>
  logs.filter((l) => (l.description || "").includes(agreementNumber) || (l.title || "").includes(agreementNumber));

async function main() {
  // Reset any executed agreements in this fixture (idempotent)
  let snap = await snapshot();
  for (const a of snap.agrs.filter((x) => x.status === "executed")) {
    await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA28 audit-truth baseline reset of prior execution." });
    await sleep(500);
  }

  const bidA = F.award.bids.a.bidId;
  const bidB = F.award.bids.b.bidId;
  const p26 = F.award.p26;

  // ---------- guard: award without agreement ----------
  const guardNoAgr = await call("awardContract B without agreement", () =>
    c.mutation("bids:awardContract", { bidId: bidB, tradePackageId: p26 }));
  record("A28-03.1", "awardContract refuses when no agreement exists (no award without a contract record)",
    guardNoAgr.ok === false && /Generate the agreement before changing an award/i.test(String(guardNoAgr.data ?? guardNoAgr.message ?? "")),
    { result: { data: guardNoAgr.data, message: guardNoAgr.message } });

  // ---------- S0: generate (award) ----------
  snap = await snapshot();
  let agrA = snap.agrs.find((a) => a.bidId === bidA && a.status !== "superseded");
  if (!agrA) {
    agrA = await c.mutation("agreements:generateAgreement", { bidId: bidA, tradePackageId: p26 });
  }
  await sleep(900);
  snap = await snapshot();
  agrA = snap.agrs.find((a) => a._id === agrA._id);
  const awardRow = snap.logs.find((l) => l.title === `AIA A401 Subcontract Agreement Awarded: AUDIT-QA28 AWARD Electric A`);
  const execRows0 = relatedRows(snap.logs, agrA.agreementNumber).filter((l) => /Execution Status Recorded/.test(l.title));
  const bidA0 = snap.bids.find((b) => b._id === bidA);
  const pkgA0 = snap.pkgs.find((p) => p._id === p26);
  steps.push({ step: "S0", agr: { n: agrA.agreementNumber, s: agrA.status }, awardRow, execRows0: execRows0.length, bidAwarded: bidA0?.isAwarded, pkg: pkgA0?.status });
  record("A28-03.2", "S0 generation: audit says 'generated ... pending external execution' (no executed claim); agreement generated; bid+package awarded",
    agrA.status === "generated" && bidA0?.isAwarded === true && pkgA0?.status === "awarded" &&
      Boolean(awardRow) && /generated for CSI Division 26/.test(awardRow.description) &&
      /pending external execution/.test(awardRow.description) && !/Executed subcontract/i.test(awardRow.description) &&
      execRows0.length === 0,
    { agr: { n: agrA.agreementNumber, s: agrA.status, executedAt: agrA.executedAt ?? null }, awardRow: awardRow ? { title: awardRow.title, description: awardRow.description } : null, execRows: execRows0.length, bid: bidA0?.isAwarded, pkg: pkgA0?.status });

  // ---------- S1: execute ----------
  const exec1 = await call("execute", () => c.mutation("agreements:executeAgreement", { agreementId: agrA._id }));
  await sleep(900);
  snap = await snapshot();
  agrA = snap.agrs.find((a) => a._id === agrA._id);
  const execRows1 = relatedRows(snap.logs, agrA.agreementNumber).filter((l) => /Execution Status Recorded/.test(l.title));
  steps.push({ step: "S1", exec: exec1.value, agr: { s: agrA.status, executedAt: agrA.executedAt }, execRows: execRows1.map((l) => ({ title: l.title, description: l.description })) });
  record("A28-03.3", "S1 execution: exactly one 'Execution Status Recorded' row naming this agreement and stating external signature verification remains required",
    exec1.ok && agrA.status === "executed" && typeof agrA.executedAt === "number" && execRows1.length === 1 &&
      /external signature verification remains required/i.test(execRows1[0].description) &&
      !/Executed subcontract .*generated/i.test(execRows1[0].description),
    { exec: exec1.value, executedAt: agrA.executedAt, rows: execRows1.map((l) => l.description) });

  // ---------- S2: execute again (idempotent) ----------
  const exec2 = await call("execute again", () => c.mutation("agreements:executeAgreement", { agreementId: agrA._id }));
  await sleep(700);
  snap = await snapshot();
  const execRows2 = relatedRows(snap.logs, agrA.agreementNumber).filter((l) => /Execution Status Recorded/.test(l.title));
  const agrA2 = snap.agrs.find((a) => a._id === agrA._id);
  record("A28-03.4", "S2 re-execute: idempotent, no duplicate execution row, executedAt unchanged",
    exec2.ok && agrA2.executedAt === agrA.executedAt && execRows2.length === 1,
    { exec2: exec2.value, executedAt: agrA2.executedAt, rows: execRows2.length });

  // ---------- S3: void ----------
  const voidRes = await call("void", () =>
    c.mutation("agreements:voidExecutedAgreement", { agreementId: agrA._id, reason: "QA28 audit truth: void executed agreement for lifecycle verification." }));
  await sleep(900);
  snap = await snapshot();
  const agrA3 = snap.agrs.find((a) => a._id === agrA._id);
  const voidRows = relatedRows(snap.logs, agrA3.agreementNumber).filter((l) => /Executed Subcontract Voided/.test(l.title));
  const bidA3 = snap.bids.find((b) => b._id === bidA);
  const pkgA3 = snap.pkgs.find((p) => p._id === p26);
  const postVoidAward = snap.logs.filter((l) => /Awarded/.test(l.title) && l.timestamp > (voidRows[0]?.timestamp ?? Infinity));
  steps.push({ step: "S2-void", voidRes: voidRes.value, agr: { s: agrA3.status, executedAt: agrA3.executedAt ?? null }, voidRows: voidRows.map((l) => l.description), postVoidAward: postVoidAward.map((l) => l.title) });
  record("A28-03.5", "S3 void: exactly one void row with the operator reason; agreement superseded; bid unawarded; package reopened; no 'Awarded' claim after the void",
    voidRes.ok && agrA3.status === "superseded" && voidRows.length === 1 &&
      /voided for lifecycle verification/i.test(voidRows[0].description) &&
      bidA3?.isAwarded === false && pkgA3?.status === "leveling" && postVoidAward.length === 0,
    { status: agrA3.status, voidRows: voidRows.map((l) => l.description), bid: bidA3?.isAwarded, pkg: pkgA3?.status, awardAfterVoid: postVoidAward.map((l) => l.title) });

  // ---------- guard: award superseded bid ----------
  const guardSuperseded = await call("awardContract after void", () =>
    c.mutation("bids:awardContract", { bidId: bidA, tradePackageId: p26 }));
  record("A28-03.6", "awardContract refuses to re-award a bid whose agreement is superseded (must regenerate first)",
    guardSuperseded.ok === false && /superseded/i.test(String(guardSuperseded.data ?? guardSuperseded.message ?? "")),
    { result: { data: guardSuperseded.data, message: guardSuperseded.message } });

  // ---------- S4: re-award ----------
  const reGen = await call("re-award (regenerate)", () => c.mutation("agreements:generateAgreement", { bidId: bidA, tradePackageId: p26 }));
  await sleep(900);
  snap = await snapshot();
  const agrA4 = snap.agrs.find((a) => a._id === agrA._id);
  const reAwardRow = snap.logs.find((l) => /Re-Awarded/.test(l.title) && (l.description || "").includes(agrA4.agreementNumber));
  const bidA4 = snap.bids.find((b) => b._id === bidA);
  const execRowsAfterRe = relatedRows(snap.logs, agrA4.agreementNumber).filter((l) => /Execution Status Recorded/.test(l.title));
  steps.push({ step: "S4-reaward", agr: { n: agrA4.agreementNumber, s: agrA4.status }, reAwardRow });
  record("A28-03.7", "S4 re-award: same agreement number reactivated, 'Re-Awarded' row says 'Re-activated' with no execution claim; prior execution row remains historical",
    reGen.ok && agrA4.status === "generated" && bidA4?.isAwarded === true &&
      Boolean(reAwardRow) && /Re-activated subcontract agreement/.test(reAwardRow.description) && !/executed/i.test(reAwardRow.description) &&
      execRowsAfterRe.length === 1,
    { agreement: { n: agrA4.agreementNumber, s: agrA4.status }, reAwardRow: reAwardRow ? { title: reAwardRow.title, description: reAwardRow.description } : null, execRowsHistorical: execRowsAfterRe.length, bid: bidA4?.isAwarded });

  // ---------- S5: re-execute ----------
  const exec3 = await call("execute after re-award", () => c.mutation("agreements:executeAgreement", { agreementId: agrA4._id }));
  await sleep(900);
  snap = await snapshot();
  const execRows5 = relatedRows(snap.logs, agrA4.agreementNumber).filter((l) => /Execution Status Recorded/.test(l.title));
  const agrA5 = snap.agrs.find((a) => a._id === agrA._id);
  steps.push({ step: "S5-reexecute", agr: { s: agrA5.status, executedAt: agrA5.executedAt }, execRows: execRows5.length });
  record("A28-03.8", "S5 re-execution: executed again; two historical execution rows (one per execution), no duplicate",
    exec3.ok && agrA5.status === "executed" && execRows5.length === 2,
    { status: agrA5.status, execRows: execRows5.map((l) => l.description) });

  writeEvidence("audit-truth", { steps, results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
  writeLog("audit-truth", log);
  console.log(`audit-truth: ${results.filter((r) => r.pass).length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("audit-truth-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});