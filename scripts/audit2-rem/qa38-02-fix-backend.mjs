/**
 * QA38-02 API re-verify of the last fix (FIX-NEW-77): sibling-package reversal finds the carrier.
 *  SIB: deduct the VFD clash credit on the HVAC (23) bid, then call reverseDoubleBuyCredit
 *  with the ELECTRICAL (26) sibling package id ->
 *    credit row removed, HVAC restored 480,000, card detected (not stale), no stranded credit,
 *    reversal audit carries the ACTUAL $38,500 on the CARRIER package, no phantom "Record Cleared".
 *  Negative: a second reverse of the same clash must refuse (no double reversal / duplicate audit).
 */
import {
  client, readEvidence, writeEvidence, writeLog, call, sleep,
  creditRows, creditClashId, creditInvariants, getBid, logs,
  REVERSED_AUDIT_RX, CLEARED_AUDIT_RX, VFD_TITLE, CLASH_VFD,
} from "./qa38-lib.mjs";

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

async function main() {
  const pair = F.sib;

  const inv0 = await creditInvariants(c, pair.id);
  const pre = inv0.cards.find((x) => x.id === CLASH_VFD) || null;
  const b0 = await getBid(c, pair.id, pair.b23.bidId);
  record("A38-02.0", "precondition: VFD double-buy detected $38,500 on the SIB project; HVAC bid 480,000; zero credits",
    pre?.status === "detected" && pre?.redundantAmount === 38500 && b0?.leveledTotalCost === 480000 && inv0.summary.acceptedCredits === 0 && inv0.clean,
    { card: pre && { st: pre.status, redundant: pre.redundantAmount }, leveled: b0?.leveledTotalCost, inv: inv0.summary });

  const clearedBefore = (await logs(c, pair.id, 200)).filter((l) => CLEARED_AUDIT_RX.test(l.title || "")).length;
  const reversedBefore = (await logs(c, pair.id, 200)).filter((l) => REVERSED_AUDIT_RX.test(l.title || "")).length;

  const d = await call("deduct.vfd.hvac", () => c.mutation("coordination:deductDoubleBuyCredit", {
    projectId: pair.id, clashId: CLASH_VFD, tradePackageId: pair.p23,
    deductAmount: 38500, description: VFD_TITLE, bidId: pair.b23.bidId,
  }));
  const bMid = await getBid(c, pair.id, pair.b23.bidId);
  const invMid = await creditInvariants(c, pair.id);
  record("A38-02.1", "deduct lands on the HVAC bid: 441,500, one accepted clash-keyed row, card deducted, KPI == actual 38,500",
    d.ok && d.value?.deductAmount === 38500 && bMid?.leveledTotalCost === 441500 &&
      rowsOf(bMid).length === 1 && rowsOf(bMid)[0].id === CLASH_VFD &&
      invMid.summary.deducted === 1 && invMid.summary.claimsTotal === 38500 && invMid.summary.actualTotal === 38500 && invMid.clean,
    { deduct: d.value ?? d.data, leveled: bMid?.leveledTotalCost, rows: rowsOf(bMid), inv: invMid.summary });

  const r = await call("reverse.with.sibling.pkg.26", () => c.mutation("coordination:reverseDoubleBuyCredit", {
    projectId: pair.id, clashId: CLASH_VFD, tradePackageId: pair.p26,
  }));
  await sleep(500);
  const bAfter = await getBid(c, pair.id, pair.b23.bidId);
  const invAfter = await creditInvariants(c, pair.id);
  const allLogs = await logs(c, pair.id, 200);
  const revAudit = allLogs.find((l) => REVERSED_AUDIT_RX.test(l.title || "") && /38,500/.test(l.title || "")) || null;
  const clearedAfter = allLogs.filter((l) => CLEARED_AUDIT_RX.test(l.title || "")).length;
  const reversedAfter = allLogs.filter((l) => REVERSED_AUDIT_RX.test(l.title || "")).length;
  const vfdCard = invAfter.cards.find((x) => x.id === CLASH_VFD) || null;

  const pass =
    r.ok && r.value?.success === true && r.value?.reversedAmount === 38500 && r.value?.newLeveledCost === 480000 &&
    bAfter?.leveledTotalCost === 480000 && rowsOf(bAfter).length === 0 &&
    vfdCard?.status === "detected" && !vfdCard?.staleResolution &&
    invAfter.summary.acceptedCredits === 0 && invAfter.summary.claimsTotal === 0 && invAfter.summary.actualTotal === 0 &&
    invAfter.clean &&
    Boolean(revAudit) && revAudit.tradePackageId === pair.p23 &&
    clearedAfter === clearedBefore && reversedAfter === reversedBefore + 1;
  if (!pass) {
    finding("A38-02.2", "High", "sibling-package reversal failed: carrier not found / credit stranded / wrong audit", {
      reverse: r.value ?? r.data, leveled: bAfter?.leveledTotalCost, rows: rowsOf(bAfter),
      card: { st: vfdCard?.status, stale: vfdCard?.staleResolution ?? false },
      inv: invAfter.summary, revAudit: revAudit && { title: revAudit.title, pkg: revAudit.tradePackageId }, clearedDelta: clearedAfter - clearedBefore,
    });
  }
  record("A38-02.2", "reverse with the sibling (Electrical) package id finds the carrier: returned 38,500 / 480,000; HVAC restored, row gone; card detected (no stale); audit 38,500 on the carrier HVAC package; no phantom clear",
    pass, {
      reverse: r.value, leveled: bAfter?.leveledTotalCost, rows: rowsOf(bAfter),
      card: { st: vfdCard?.status, stale: vfdCard?.staleResolution ?? false },
      revAudit: revAudit && { title: revAudit.title, carrierPkg: revAudit.tradePackageId === pair.p23 ? "HVAC(carrier)" : revAudit.tradePackageId },
      clearedDelta: clearedAfter - clearedBefore, reversedDelta: reversedAfter - reversedBefore, inv: invAfter.summary, clean: invAfter.clean,
    });

  const r2 = await call("reverse.again", () => c.mutation("coordination:reverseDoubleBuyCredit", {
    projectId: pair.id, clashId: CLASH_VFD, tradePackageId: pair.p26,
  }));
  await sleep(400);
  const invFinal = await creditInvariants(c, pair.id);
  const bFinal = await getBid(c, pair.id, pair.b23.bidId);
  const reversedFinal = (await logs(c, pair.id, 200)).filter((l) => REVERSED_AUDIT_RX.test(l.title || "")).length;
  record("A38-02.3", "second reverse of the same clash is refused ('no applied credit'); no duplicate reversal, bid stays 480,000, invariants clean",
    !r2.ok && /no applied credit/i.test(r2.data || "") && bFinal?.leveledTotalCost === 480000 && reversedFinal === reversedBefore + 1 && invFinal.clean,
    { second: r2.data ?? r2.message, leveled: bFinal?.leveledTotalCost, reversedAudits: reversedFinal, clean: invFinal.clean });

  const out = {
    projectId: pair.id, results, findings,
    summary: { pass: results.filter((x) => x.pass).length, total: results.length, findings: findings.length },
  };
  writeEvidence("fix-backend", out);
  writeLog("fix-backend", log);
  console.log(`fix-backend: ${out.summary.pass}/${out.summary.total} pass, ${findings.length} findings`);
  if (findings.length || results.some((x) => !x.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeEvidence("fix-backend", { results: [...results, { id: "A38-02.ERR", pass: false, name: "aborted", detail: String(e?.stack ?? e) }], findings });
  writeLog("fix-backend-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});