/**
 * QA37-02 backend verification (live brainy-skunk-440):
 *  A36-01  sibling-package reversal finds the credit carrier:
 *          deduct VFD on HVAC pill B, call reverseDoubleBuyCredit with the Electrical
 *          package id -> credit removed, leveled restored, reversed audit has the ACTUAL
 *          amount and the carrier package id, no stale-clear, no stranded credit.
 *          Repeated on a second pair (SIBB).
 *  STALE   genuine stale-clear control: carrier row deleted out-of-band -> reverse clears
 *          the record with the "Record Cleared" audit (no false REVERSED claim).
 *  EQISO   equal-amount isolation: VFD $12k + Disconnect $12k, un-accept VFD only, then
 *          reverse VFD only, then reverse Disconnect only.
 */
import {
  client, readEvidence, writeEvidence, writeLog, call, sleep,
  creditRows, creditClashId, creditInvariants, getBid, detect, logs,
  REVERSED_AUDIT_RX, CLEARED_AUDIT_RX, VFD_TITLE, DISC_TITLE, CLASH_VFD, CLASH_DISC,
} from "./qa37-lib.mjs";

const F = readEvidence("fixtures");
const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const findings = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1600)}`);
};
const finding = (id, severity, title, evidence) => {
  findings.push({ id, severity, title, evidence });
  say(`FINDING ${id} [${severity}] ${title}`);
};
const rowsOf = (b) => creditRows(b).map((r) => ({ id: creditClashId(r.description), a: r.costDeduct || 0, acc: !!r.isAccepted }));
const cardOf = (inv, id) => inv.cards.find((x) => x.id === id) || null;

async function siblingReversal(pair, tag) {
  const inv0 = await creditInvariants(c, pair.id);
  const pre = cardOf(inv0, CLASH_VFD);
  const clearedBefore = (await logs(c, pair.id, 200)).filter((l) => CLEARED_AUDIT_RX.test(l.title || "")).length;
  const reversedBefore = (await logs(c, pair.id, 200)).filter((l) => REVERSED_AUDIT_RX.test(l.title || "")).length;
  const d = await call(`${tag}.deduct.vfd`, () => c.mutation("coordination:deductDoubleBuyCredit", {
    projectId: pair.id, clashId: CLASH_VFD, tradePackageId: pair.p23,
    deductAmount: 38500, description: VFD_TITLE, bidId: pair.b23.bidId,
  }));
  const bMid = await getBid(c, pair.id, pair.b23.bidId);
  const invMid = await creditInvariants(c, pair.id);

  const r = await call(`${tag}.reverse.sibling`, () => c.mutation("coordination:reverseDoubleBuyCredit", {
    projectId: pair.id, clashId: CLASH_VFD, tradePackageId: pair.p26,
  }));
  await sleep(400);
  const bAfter = await getBid(c, pair.id, pair.b23.bidId);
  const invAfter = await creditInvariants(c, pair.id);
  const allLogs = await logs(c, pair.id, 200);
  const revAudit = allLogs.find((l) => REVERSED_AUDIT_RX.test(l.title || "") && /38,500/.test(l.title || "")) || null;
  const clearedAfter = allLogs.filter((l) => CLEARED_AUDIT_RX.test(l.title || "")).length;
  const reversedAfter = allLogs.filter((l) => REVERSED_AUDIT_RX.test(l.title || "")).length;
  const vfdCard = cardOf(invAfter, CLASH_VFD);

  const pass =
    pre?.redundantAmount === 38500 &&
    d.ok && d.value?.deductAmount === 38500 &&
    bMid?.leveledTotalCost === 441500 && rowsOf(bMid).length === 1 && rowsOf(bMid)[0].id === CLASH_VFD &&
    invMid.summary.deducted === 1 && invMid.summary.actualTotal === 38500 &&
    r.ok && r.value?.success === true && r.value?.reversedAmount === 38500 && r.value?.newLeveledCost === 480000 &&
    bAfter?.leveledTotalCost === 480000 && rowsOf(bAfter).length === 0 &&
    vfdCard?.status === "detected" && !vfdCard?.staleResolution &&
    invAfter.summary.acceptedCredits === 0 && invAfter.summary.claimsTotal === 0 && invAfter.summary.actualTotal === 0 &&
    invAfter.leveledDrift.length === 0 &&
    Boolean(revAudit) && revAudit.tradePackageId === pair.p23 &&
    clearedAfter === clearedBefore && reversedAfter === reversedBefore + 1;
  if (!pass) {
    finding(`A36-01.${tag}`, "High", `sibling-package reversal failed (${tag}): carrier not found / credit stranded / wrong audit`, {
      reverse: r.value ?? r.data, leveled: bAfter?.leveledTotalCost, rows: rowsOf(bAfter),
      card: { st: vfdCard?.status, stale: vfdCard?.staleResolution ?? false },
      inv: invAfter.summary, revAudit: revAudit && { title: revAudit.title, pkg: revAudit.tradePackageId }, clearedAuditsDelta: clearedAfter - clearedBefore,
    });
  }
  record(`A36-01.${tag}`, `sibling-package id reversal finds the carrier: credit removed, HVAC bid restored 480,000, card detected (no stale), audit "$38,500" on the carrier package, no stranded credit`,
    pass, {
      reverse: r.value, after: { leveled: bAfter?.leveledTotalCost, rows: rowsOf(bAfter) },
      card: { st: vfdCard?.status, stale: vfdCard?.staleResolution ?? false },
      inv: invAfter.summary, revAudit: revAudit && { title: revAudit.title, pkg: revAudit.tradePackageId === pair.p23 ? "carrier-HVAC" : revAudit.tradePackageId },
      reversedAuditsBefore: reversedBefore, reversedAuditsAfter: reversedAfter, clearedAuditsBefore: clearedBefore, clearedAuditsAfter: clearedAfter,
    });
  return { d, r, bAfter, invAfter };
}

async function staleControl(pair) {
  const reversedBefore = (await logs(c, pair.id, 200)).filter((l) => REVERSED_AUDIT_RX.test(l.title || "")).length;
  const d = await call("stale.deduct", () => c.mutation("coordination:deductDoubleBuyCredit", {
    projectId: pair.id, clashId: CLASH_VFD, tradePackageId: pair.p23,
    deductAmount: 38500, description: VFD_TITLE, bidId: pair.b23.bidId,
  }));
  const bMid = await getBid(c, pair.id, pair.b23.bidId);
  const stripped = await call("stale.strip.carrier.row", () => c.mutation("bids:updateBidAdjustments", {
    bidId: pair.b23.bidId, identifiedExclusions: [],
    valueEngineeringAlternates: (bMid.valueEngineeringAlternates || []).filter((v) => !String(v.description).startsWith("Cross-Trade Clash Credit")),
    leadTimePenalty: 0, coiPenalty: 0,
  }));
  const bStripped = await getBid(c, pair.id, pair.b23.bidId);
  const r = await call("stale.reverse", () => c.mutation("coordination:reverseDoubleBuyCredit", {
    projectId: pair.id, clashId: CLASH_VFD, tradePackageId: pair.p26,
  }));
  await sleep(400);
  const bAfter = await getBid(c, pair.id, pair.b23.bidId);
  const invAfter = await creditInvariants(c, pair.id);
  const allLogs = await logs(c, pair.id, 200);
  const clearAudit = allLogs.find((l) => CLEARED_AUDIT_RX.test(l.title || "")) || null;
  const reversedAfter = allLogs.filter((l) => REVERSED_AUDIT_RX.test(l.title || "")).length;
  const card = cardOf(invAfter, CLASH_VFD);
  const pass =
    d.ok && bMid?.leveledTotalCost === 441500 && stripped.ok && bStripped?.leveledTotalCost === 480000 &&
    r.ok && /Stale credit record cleared/.test(r.value?.note || "") &&
    bAfter?.leveledTotalCost === 480000 && card?.status === "detected" && !card?.staleResolution &&
    Boolean(clearAudit) && /38,500/.test(clearAudit.description || "") && reversedAfter === reversedBefore &&
    invAfter.summary.acceptedCredits === 0;
  record("A36-01.STALE", "genuine stale-clear control: carrier row removed out-of-band -> reverse clears the record with the 'Record Cleared' audit and no new REVERSED claim",
    pass, { reverse: r.value ?? r.data, clearAudit: clearAudit?.title, reversedAuditsBefore: reversedBefore, reversedAuditsAfter: reversedAfter, card: { st: card?.status, stale: card?.staleResolution ?? false }, inv: invAfter.summary });
  return pass;
}

async function equalAmountIsolation() {
  const pair = F.eq;
  const dV = await call("eq.deduct.vfd", () => c.mutation("coordination:deductDoubleBuyCredit", {
    projectId: pair.id, clashId: CLASH_VFD, tradePackageId: pair.p23, deductAmount: 12000, description: VFD_TITLE, bidId: pair.b23.bidId,
  }));
  const dD = await call("eq.deduct.disc", () => c.mutation("coordination:deductDoubleBuyCredit", {
    projectId: pair.id, clashId: CLASH_DISC, tradePackageId: pair.p23, deductAmount: 12000, description: DISC_TITLE, bidId: pair.b23.bidId,
  }));
  const bBoth = await getBid(c, pair.id, pair.b23.bidId);
  const invBoth = await creditInvariants(c, pair.id);
  const bothPass = dV.ok && dD.ok && bBoth.leveledTotalCost === 429500 &&
    cardOf(invBoth, CLASH_VFD)?.status === "deducted" && cardOf(invBoth, CLASH_DISC)?.status === "deducted" &&
    invBoth.summary.claimsTotal === 24000 && invBoth.summary.actualTotal === 24000 && invBoth.clean;

  // un-accept ONLY the VFD row
  const unacc = await call("eq.unaccept.vfd", () => c.mutation("bids:updateBidAdjustments", {
    bidId: pair.b23.bidId, identifiedExclusions: [],
    valueEngineeringAlternates: (bBoth.valueEngineeringAlternates || []).map((a) =>
      String(a.description).startsWith("Cross-Trade Clash Credit [clash-vfd-01]") ? { ...a, isAccepted: false } : a
    ),
    leadTimePenalty: 0, coiPenalty: 0,
  }));
  await sleep(300);
  const bUn = await getBid(c, pair.id, pair.b23.bidId);
  const invUn = await creditInvariants(c, pair.id);
  const unPass = unacc.ok && bUn.leveledTotalCost === 441500 &&
    cardOf(invUn, CLASH_VFD)?.status === "detected" && cardOf(invUn, CLASH_VFD)?.staleResolution === true &&
    cardOf(invUn, CLASH_DISC)?.status === "deducted" && cardOf(invUn, CLASH_DISC)?.deductedAmount === 12000 &&
    invUn.summary.claimsTotal === 12000 && invUn.summary.actualTotal === 12000 && invUn.staleWithAccepted.length === 0;

  const rV = await call("eq.reverse.vfd", () => c.mutation("coordination:reverseDoubleBuyCredit", {
    projectId: pair.id, clashId: CLASH_VFD, tradePackageId: pair.p23,
  }));
  await sleep(300);
  const bAfterV = await getBid(c, pair.id, pair.b23.bidId);
  const invV = await creditInvariants(c, pair.id);
  const vPass = rV.ok && rV.value?.reversedAmount === 12000 &&
    rowsOf(bAfterV).length === 1 && rowsOf(bAfterV)[0].id === CLASH_DISC && rowsOf(bAfterV)[0].acc === true &&
    bAfterV.leveledTotalCost === 441500 &&
    cardOf(invV, CLASH_DISC)?.status === "deducted" && cardOf(invV, CLASH_DISC)?.deductedAmount === 12000 &&
    invV.summary.actualTotal === 12000 && invV.orphanCredit.length === 0 && invV.stacked.length === 0 && invV.leveledDrift.length === 0 &&
    !(await logs(c, pair.id, 100)).some((l) => /Double-Buy Credit Reversed/.test(l.title || "") && /24,000/.test(l.title || ""));

  const rD = await call("eq.reverse.disc", () => c.mutation("coordination:reverseDoubleBuyCredit", {
    projectId: pair.id, clashId: CLASH_DISC, tradePackageId: pair.p23,
  }));
  await sleep(300);
  const bAfterD = await getBid(c, pair.id, pair.b23.bidId);
  const invD = await creditInvariants(c, pair.id);
  const dPass = rD.ok && rD.value?.reversedAmount === 12000 && bAfterD.leveledTotalCost === 453500 &&
    rowsOf(bAfterD).length === 0 && cardOf(invD, CLASH_DISC)?.status === "detected" && invD.summary.actualTotal === 0;
  const eqPass = bothPass && unPass && vPass && dPass;
  if (!eqPass) {
    finding("A37-EQ.1", "High", "equal-amount isolation failed: VFD $12k / Disconnect $12k credits masked or over-reversed", {
      bothPass, unPass, vPass, dPass,
      afterUnaccept: { leveled: bUn.leveledTotalCost, cards: invUn.cards.filter((x) => x.kind === "double_buy").map((x) => ({ id: x.id, st: x.status, amt: x.deductedAmount, stale: x.staleResolution ?? false })) },
      afterReverseVfd: { leveled: bAfterV.leveledTotalCost, rows: rowsOf(bAfterV) },
      afterReverseDisc: { leveled: bAfterD.leveledTotalCost, rows: rowsOf(bAfterD) },
    });
  }
  record("A37-EQ.1a", "equal-amount setup: VFD $12k + Disconnect $12k both deducted on one bid (429,500), KPI == actual 24,000, invariants clean",
    bothPass, { leveled: bBoth.leveledTotalCost, inv: invBoth.summary, rows: rowsOf(bBoth) });
  record("A37-EQ.1b", "un-accept ONLY VFD: VFD card detected+stale, Disconnect stays deducted/12k, KPI==actual 12,000, no staleWithAccepted",
    unPass, { leveled: bUn.leveledTotalCost, vfd: cardOf(invUn, CLASH_VFD) && { st: cardOf(invUn, CLASH_VFD).status, stale: cardOf(invUn, CLASH_VFD).staleResolution }, disc: cardOf(invUn, CLASH_DISC) && { st: cardOf(invUn, CLASH_DISC).status, amt: cardOf(invUn, CLASH_DISC).deductedAmount }, inv: invUn.summary });
  record("A37-EQ.1c", "reverse ONLY VFD: VFD row gone, Disconnect row survives accepted, card still deducted 12k, leveled 441,500, no 24k over-reversal audit",
    vPass, { reversed: rV.value, leveled: bAfterV.leveledTotalCost, rows: rowsOf(bAfterV), cards: { vfd: cardOf(invV, CLASH_VFD)?.status, disc: cardOf(invV, CLASH_DISC)?.status } });
  record("A37-EQ.1d", "reverse ONLY Disconnect afterwards: row gone, card detected, leveled 453,500 (manual 26,500 kept)",
    dPass, { reversed: rD.value, leveled: bAfterD.leveledTotalCost, rows: rowsOf(bAfterD) });
}

async function main() {
  await siblingReversal(F.sib, "SIB");
  await siblingReversal(F.sibb, "SIBB");
  await staleControl(F.sibb);
  await equalAmountIsolation();
  const out = {
    results, findings,
    summary: { pass: results.filter((r) => r.pass).length, total: results.length, findings: findings.length },
  };
  writeEvidence("fix-backend", out);
  writeLog("fix-backend", log);
  console.log(`fix-backend: ${out.summary.pass}/${out.summary.total} pass, ${findings.length} findings`);
  if (findings.length || results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeEvidence("fix-backend", { results: [...results, { id: "A37-02.ERR", pass: false, name: "aborted", detail: String(e?.stack ?? e) }], findings });
  writeLog("fix-backend-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});