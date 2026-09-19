/**
 * QA36-03 multi-project isolation for clash resolutions (same clash ids in two projects):
 *  - credits/reversals must not leak across projects (bid money, cards, KPI, audit)
 *  - cross-project package/project argument combos must be refused
 *  - equal amounts in both projects prove identity is (projectId, clashId), not amount
 */
import {
  client, readEvidence, writeEvidence, writeLog, call, sleep,
  creditInvariants, getBid, creditRows, creditClashId, latestAudit,
  REVERSED_AUDIT_RX, CLASH_VFD, CLASH_DISC, VFD_TITLE, DISC_TITLE,
} from "./qa36-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1500)}`);
};
const rows = (b) => creditRows(b).map((r) => ({ id: creditClashId(r.description), a: r.costDeduct || 0, acc: !!r.isAccepted }));
const card = (inv, id) => inv.cards.find((x) => x.id === id);

async function main() {
  const A = F.isoA, B = F.isoB;
  const AB = A.b23.bidId, BB = B.b23.bidId;
  const pop = (inv) => inv.cards.filter((x) => x.kind === "double_buy").map((x) => ({ id: x.id, st: x.status, amt: x.deductedAmount ?? null, stale: x.staleResolution ?? false }));

  {
    const [ia, ib] = await Promise.all([creditInvariants(c, A.id), creditInvariants(c, B.id)]);
    record("A36-ISO01", "both projects start clean with identical clash ids and independent bids (480,000 / 520,000)",
      ia.clean && ib.clean && (await getBid(c, A.id, AB)).leveledTotalCost === 480000 && (await getBid(c, B.id, BB)).leveledTotalCost === 520000,
      { a: { leveled: 480000, cards: pop(ia) }, b: { leveled: 520000, cards: pop(ib) } });
  }
  {
    const ra = await call("isoA.deduct", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: A.id, clashId: CLASH_VFD, tradePackageId: A.p23, deductAmount: 38500, description: VFD_TITLE }));
    const rb = await call("isoB.deduct", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: B.id, clashId: CLASH_VFD, tradePackageId: B.p23, deductAmount: 38500, description: VFD_TITLE }));
    const [ba, bb] = [await getBid(c, A.id, AB), await getBid(c, B.id, BB)];
    const [ia, ib] = await Promise.all([creditInvariants(c, A.id), creditInvariants(c, B.id)]);
    record("A36-ISO02", "same clash id + same amount deducted in both projects: each project carries exactly one own marker; bids 441,500 / 481,500; no cross rows",
      ra.ok && rb.ok && ba.leveledTotalCost === 441500 && bb.leveledTotalCost === 481500 &&
        ia.clean && ib.clean && ia.actualTotal === 38500 && ib.actualTotal === 38500 &&
        ia.acceptedCredits.every((r) => r.pkg === A.p23) && ib.acceptedCredits.every((r) => r.pkg === B.p23),
      { a: { leveled: ba.leveledTotalCost, rows: rows(ba) }, b: { leveled: bb.leveledTotalCost, rows: rows(bb) } });
  }
  {
    const r = await call("isoA.reverse", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: A.id, clashId: CLASH_VFD, tradePackageId: A.p23 }));
    const [ba, bb] = [await getBid(c, A.id, AB), await getBid(c, B.id, BB)];
    const [ia, ib] = await Promise.all([creditInvariants(c, A.id), creditInvariants(c, B.id)]);
    const logsA = await c.query("auditLogs:listRecentLogs", { projectId: A.id, limit: 300 });
    const logsB = await c.query("auditLogs:listRecentLogs", { projectId: B.id, limit: 300 });
    const revA = latestAudit(logsA, REVERSED_AUDIT_RX);
    const revB = latestAudit(logsB, REVERSED_AUDIT_RX);
    record("A36-ISO03", "reverse in A leaves B untouched (bid 481,500, marker intact, card deducted); audit reversal only in A",
      r.ok && ba.leveledTotalCost === 480000 && bb.leveledTotalCost === 481500 &&
        ia.clean && ib.clean && ib.actualTotal === 38500 && card(ib, CLASH_VFD).status === "deducted" &&
        Boolean(revA) && revB === null,
      { a: { leveled: ba.leveledTotalCost, rows: rows(ba) }, b: { leveled: bb.leveledTotalCost, rows: rows(bb) }, auditA: revA?.description, auditB: revB?.description ?? null });
  }
  {
    const rrev = await call("isoA.reverse.wrongProjectPkg", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: A.id, clashId: CLASH_VFD, tradePackageId: B.p23 }));
    const rded = await call("isoA.deduct.wrongProjectPkg", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: A.id, clashId: CLASH_DISC, tradePackageId: B.p23, deductAmount: 12000, description: DISC_TITLE }));
    const rvoid = await call("isoA.assign.wrongProjectPkg", () => c.mutation("coordination:assignScopeVoidToTrade", { projectId: A.id, voidId: "void-bas-wiring-01", tradePackageId: B.p23, additionalCost: 28000, description: "QA36 cross-project void probe" }));
    const [ia, ib] = await Promise.all([creditInvariants(c, A.id), creditInvariants(c, B.id)]);
    const [ba, bb] = [await getBid(c, A.id, AB), await getBid(c, B.id, BB)];
    record("A36-ISO04", "cross-project tradePackageId refused by reverse/deduct/assign; neither project mutated",
      !rrev.ok && !rded.ok && !rvoid.ok && ia.clean && ib.clean && ba.valueEngineeringAlternates.length === 0 && bb.leveledTotalCost === 481500 && rows(bb).length === 1,
      { refusals: [rrev.data ?? rrev.message, rded.data ?? rded.message, rvoid.data ?? rvoid.message].map((x) => String(x).slice(0, 90)), a: rows(ba), b: rows(bb) });
  }
  {
    // finish B cycle and prove no A resolution leaked
    const r = await call("isoB.reverse", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: B.id, clashId: CLASH_VFD, tradePackageId: B.p23 }));
    const bb = await getBid(c, B.id, BB);
    const ib = await creditInvariants(c, B.id);
    const ib2 = await call("isoB.reverse.again", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: B.id, clashId: CLASH_VFD, tradePackageId: B.p23 }));
    record("A36-ISO05", "B reverse restores exactly 520,000 and refuses the second time (A's deletion did not create a shared record)",
      r.ok && bb.leveledTotalCost === 520000 && ib.clean && !ib2.ok && /no applied credit/.test(String(ib2.data ?? ib2.message)),
      { leveled: bb.leveledTotalCost, second: ib2.data ?? ib2.message });
  }
  {
    // project deletion of a non-QA36 prefix must never be attempted: verify audit visibility is scoped
    const logsB = await c.query("auditLogs:listRecentLogs", { projectId: B.id, limit: 300 });
    const leaks = logsB.filter((l) => l.projectId !== B.id);
    record("A36-ISO06", "audit log queries are project-scoped: B's stream contains only B rows",
      leaks.length === 0,
      { logsB: logsB.length, leaks: leaks.map((l) => l.title).slice(0, 4) });
  }

  const fails = results.filter((r) => !r.pass);
  writeEvidence("multiproject", { results, summary: { pass: results.length - fails.length, total: results.length } });
  writeLog("multiproject", log);
  console.log(`multiproject: ${results.length - fails.length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("multiproject-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});