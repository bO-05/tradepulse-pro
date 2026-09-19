/**
 * QA26-07 backend idempotency of the newest actions/buttons:
 *  - scanCrossTradeClashes twice
 *  - generateAgreement twice (same bid)
 *  - executeAgreement twice
 *  - voidExecutedAgreement twice
 * plus the corrected A26-02.7 audit-row recheck on the GATE project.
 */
import { client, readEvidence, writeEvidence, writeLog, call } from "./qa26-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1300)}`);
};

async function main() {
  // corrected A26-02.7 evidence
  const gateLogs = (await c.query("auditLogs:listRecentLogs", { projectId: F.gate.id, limit: 300 })) || [];
  const deductedRows = gateLogs.filter((l) => /Double-Buy Credit Deducted/.test(l.title));
  const loggedRows = gateLogs.filter((l) => /Double-Buy Credit Logged/.test(l.title));
  record(
    "A26-02.7b",
    "GATE audit recheck: exactly one 'Deducted' row carrying the $38,500 amount; zero 'Logged' intent rows after the gate refusals",
    deductedRows.length === 1 && /38,500/.test(deductedRows[0].title) && loggedRows.length === 0,
    { deducted: deductedRows.map((l) => ({ title: l.title, desc: l.description.slice(0, 120) })), logged: loggedRows.length }
  );

  // ---------- scan idempotency ----------
  const scan1 = await call("scan #1", () => c.action("coordination:scanCrossTradeClashes", { projectId: F.award.id }));
  const scan2 = await call("scan #2", () => c.action("coordination:scanCrossTradeClashes", { projectId: F.award.id }));
  const detectAfter = await c.query("coordination:detectCrossTradeClashes", { projectId: F.award.id });
  record(
    "A26-07.1",
    "scan twice: both runs analyzed with the same reconciled totals; persisted card counts unchanged",
    scan1.ok && scan2.ok && scan1.value?.analyzed === true && scan2.value?.analyzed === true &&
      scan1.value?.message === scan2.value?.message &&
      detectAfter.doubleBuys.length === 2 && detectAfter.scopeVoids.length === 2,
    { scan1: scan1.value?.message, scan2: scan2.value?.message, cards: { buys: detectAfter.doubleBuys.length, voids: detectAfter.scopeVoids.length } }
  );

  // ---------- generate twice ----------
  const d = F.award.bids.d;
  const first = await c.mutation("agreements:generateAgreement", { bidId: d.bidId, tradePackageId: F.award.p23 });
  const second = await c.mutation("agreements:generateAgreement", { bidId: d.bidId, tradePackageId: F.award.p23 });
  const pkgAgrs = ((await c.query("agreements:listAgreements", { projectId: F.award.id })) || []).filter((a) => a.tradePackageId === F.award.p23);
  record(
    "A26-07.2",
    "generateAgreement twice on the same bid: same agreement row reactivated, no duplicate agreement record",
    first._id === second._id && pkgAgrs.length === 1 && second.status === "generated",
    { first: { id: first._id, n: first.agreementNumber, s: first.status }, second: { id: second._id, n: second.agreementNumber, s: second.status }, rowsForPackage: pkgAgrs.length }
  );

  // ---------- execute twice ----------
  const exec1 = await call("execute #1", () => c.mutation("agreements:executeAgreement", { agreementId: second._id }));
  const after1 = (await c.query("agreements:listAgreements", { projectId: F.award.id })).find((a) => a._id === second._id);
  await new Promise((r) => setTimeout(r, 1100));
  const exec2 = await call("execute #2", () => c.mutation("agreements:executeAgreement", { agreementId: second._id }));
  const after2 = (await c.query("agreements:listAgreements", { projectId: F.award.id })).find((a) => a._id === second._id);
  const execAudit = ((await c.query("auditLogs:listRecentLogs", { projectId: F.award.id, limit: 300 })) || [])
    .filter((l) => l.title === "AIA A401 Execution Status Recorded" && l.description.includes(second.agreementNumber));
  record(
    "A26-07.3",
    "execute twice: second call returns success without rewriting executedAt or duplicating the execution audit row",
    exec1.ok && exec2.ok && after1?.status === "executed" && after2?.status === "executed" &&
      after1?.executedAt === after2?.executedAt && execAudit.length === 1,
    { executedAt1: after1?.executedAt, executedAt2: after2?.executedAt, execAuditRows: execAudit.length, exec2: exec2.value }
  );

  // ---------- void twice ----------
  const void1 = await call("void #1", () =>
    c.mutation("agreements:voidExecutedAgreement", { agreementId: second._id, reason: "QA26 idempotency: first void of the D agreement." })
  );
  const void2 = await call("void #2", () =>
    c.mutation("agreements:voidExecutedAgreement", { agreementId: second._id, reason: "QA26 idempotency: second void attempt on an already superseded agreement." })
  );
  const afterVoid = (await c.query("agreements:listAgreements", { projectId: F.award.id })).find((a) => a._id === second._id);
  const voidAudit = ((await c.query("auditLogs:listRecentLogs", { projectId: F.award.id, limit: 300 })) || [])
    .filter((l) => l.title === `Executed Subcontract Voided: ${second.agreementNumber}`);
  record(
    "A26-07.4",
    "void twice: second call refused with a readable message; exactly one void transition and one void audit row",
    void1.ok && void2.ok === false && /Only an executed agreement can be voided/i.test(String(void2.data ?? "")) &&
      afterVoid?.status === "superseded" && voidAudit.length === 1,
    { void1: void1.value, void2: { ok: void2.ok, data: void2.data }, status: afterVoid?.status, voidAuditRows: voidAudit.length }
  );

  writeEvidence("idempotency", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
  writeLog("idempotency", log);
  console.log(`idempotency: ${results.filter((r) => r.pass).length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("idempotency-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});