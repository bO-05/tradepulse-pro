/**
 * QA15 backend: A14-03 manual deadline monitor parity. A zero-bid overdue
 * package gets exactly one "Deadline passed with no bids" audit row and is not
 * transitioned; a package with bids transitions to leveling.
 */
import { client, readEvidence, writeEvidence, writeLog, call, sleep } from "./qa15-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${detail}`);
};

async function logs() {
  return (await c.query("auditLogs:listRecentLogs", { projectId: F.cron.projectId, limit: 500 })) || [];
}

function noBidRows(rows) {
  return rows.filter((l) => (l.title || "").startsWith("Deadline passed with no bids"));
}

function noBidRowsFor(rows, pkgId) {
  return noBidRows(rows).filter((l) => l.tradePackageId === pkgId);
}

async function main() {
  // make the run reproducible: ensure the with-bid package is back in rfqs_dispatched
  await c.mutation("tradePackages:updateStatus", { tradePackageId: F.cron.bidPackageId, status: "rfqs_dispatched" });
  await sleep(600);

  const before = {
    logs: await logs(),
    zeroPkg: await c.query("tradePackages:getPackage", { tradePackageId: F.cron.zeroPackageId }),
    bidPkg: await c.query("tradePackages:getPackage", { tradePackageId: F.cron.bidPackageId }),
  };
  const beforeZeroRows = noBidRowsFor(before.logs, F.cron.zeroPackageId).length;
  say(`before: zero=${before.zeroPkg.status} noBidRows=${beforeZeroRows}; bidPkg=${before.bidPkg.status}`);

  const run1 = await call("runDeadlineMonitorNow #1", () =>
    c.mutation("crons:runDeadlineMonitorNow", { projectId: F.cron.projectId })
  );
  await sleep(800);
  const mid = {
    logs: await logs(),
    zeroPkg: await c.query("tradePackages:getPackage", { tradePackageId: F.cron.zeroPackageId }),
    bidPkg: await c.query("tradePackages:getPackage", { tradePackageId: F.cron.bidPackageId }),
  };
  const midZeroRows = noBidRowsFor(mid.logs, F.cron.zeroPackageId);
  say(`run1 ${JSON.stringify(run1.value || run1.data)} -> zero=${mid.zeroPkg.status} bidPkg=${mid.bidPkg.status} noBidRows=${midZeroRows.length}`);

  const run2 = await call("runDeadlineMonitorNow #2 (idempotency)", () =>
    c.mutation("crons:runDeadlineMonitorNow", { projectId: F.cron.projectId })
  );
  await sleep(800);
  const after = {
    logs: await logs(),
    zeroPkg: await c.query("tradePackages:getPackage", { tradePackageId: F.cron.zeroPackageId }),
    bidPkg: await c.query("tradePackages:getPackage", { tradePackageId: F.cron.bidPackageId }),
  };
  const afterZeroRows = noBidRowsFor(after.logs, F.cron.zeroPackageId);
  const bidRows = noBidRowsFor(after.logs, F.cron.bidPackageId);
  say(`run2 ${JSON.stringify(run2.value || run2.data)} -> zero=${after.zeroPkg.status} bidPkg=${after.bidPkg.status} noBidRows=${afterZeroRows.length}`);

  record(
    "A14-03-zero-bid-single-row-not-transitioned",
    run1.ok &&
      before.zeroPkg.status === "rfqs_dispatched" &&
      mid.zeroPkg.status === "rfqs_dispatched" &&
      after.zeroPkg.status === "rfqs_dispatched" &&
      midZeroRows.length === 1 &&
      afterZeroRows.length === 1 &&
      afterZeroRows[0].title.startsWith(`Deadline passed with no bids: ${F.cron.zeroPackageName}`),
    `run1=${JSON.stringify(run1.value || run1.data)}; zeroStatus=${before.zeroPkg.status}->${mid.zeroPkg.status}->${after.zeroPkg.status}; rowsAfterRun1=${midZeroRows.length}; rowsAfterRun2=${afterZeroRows.length}; title=${JSON.stringify(afterZeroRows[0] ? afterZeroRows[0].title : null)}`
  );

  record(
    "A14-03-with-bid-package-transitions",
    run1.ok &&
      mid.bidPkg.status === "leveling" &&
      (run1.value ? run1.value.transitionedCount === 1 : true) &&
      bidRows.length === 0,
    `bidPkg=${before.bidPkg.status}->${mid.bidPkg.status}->${after.bidPkg.status}; transitionedCount=${run1.value ? run1.value.transitionedCount : "?"}; noBidFlaggedForBidPkg=${bidRows.length}`
  );

  const manualRows = after.logs.filter((l) => (l.title || "").startsWith("Manual Trigger: Bid Deadline Monitor")).length;
  record(
    "A14-03-manual-trigger-parity",
    run1.ok && run2.ok && run1.value && run2.value && run1.value.monitoredCount >= 2 && run2.value.transitionedCount === 0,
    `run1=${JSON.stringify(run1.value)}; run2=${JSON.stringify(run2.value)}; manualRows=${manualRows}`
  );

  writeEvidence("cron-monitor", {
    results,
    run1,
    run2,
    before: { zeroStatus: before.zeroPkg.status, bidStatus: before.bidPkg.status, noBidRows: beforeZeroRows },
    afterRun1: { zeroStatus: mid.zeroPkg.status, bidStatus: mid.bidPkg.status, zeroRows: midZeroRows.map((l) => ({ title: l.title, packageId: l.tradePackageId, ts: l.timestamp })) },
    afterRun2: { zeroStatus: after.zeroPkg.status, bidStatus: after.bidPkg.status, zeroRows: afterZeroRows.map((l) => ({ title: l.title, packageId: l.tradePackageId, ts: l.timestamp })), bidRows: bidRows.map((l) => ({ title: l.title, packageId: l.tradePackageId })) },
    manualTriggerRows: manualRows,
  });
  writeLog("cron-monitor", log);
  console.log(`\nresults: ${results.filter((r) => r.pass).length}/${results.length} passed`);
}

main().catch((e) => {
  console.error(e);
  writeLog("cron-monitor-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});