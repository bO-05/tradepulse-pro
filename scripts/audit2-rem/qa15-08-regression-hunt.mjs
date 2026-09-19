/**
 * QA15 regression hunt (touched areas only):
 *  - agreements.executeAgreement normal path still works after the superseded
 *    branch changed to ConvexError (then void to restore).
 *  - validation.validateBidDeadline boundary: today + one-day slack accepted,
 *    three days ago rejected (slack is not overly wide).
 *  - crons.runDeadlineMonitorNow does not false-positive a future zero-bid
 *    package.
 *  - clash deduct persists the applied amount with no stale benchmark text.
 */
import { client, readEvidence, writeEvidence, writeLog, call, sleep, addDays } from "./qa15-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${detail}`);
};

async function main() {
  const todayUtc = new Date().toISOString().slice(0, 10);
  const oneDayAgo = addDays(todayUtc, -1);
  const threeDaysAgo = addDays(todayUtc, -3);

  // ---- A15-01: normal executeAgreement path (prefix agreement, generated)
  const agrBefore = ((await c.query("agreements:listAgreements", { projectId: F.mainProjectId })) || []).find(
    (a) => a.bidId && a.agreementNumber.startsWith("A401-2026-2700")
  );
  const exec = await call("execute generated (non-superseded) agreement", () =>
    c.mutation("agreements:executeAgreement", { agreementId: agrBefore._id })
  );
  await sleep(600);
  const agrExecuted = ((await c.query("agreements:listAgreements", { projectId: F.mainProjectId })) || []).find((a) => a._id === agrBefore._id);
  record(
    "A15-01-normal-execute-still-works",
    agrBefore.status === "generated" &&
      exec.ok &&
      agrExecuted.status === "executed" &&
      agrExecuted.contractText.length === agrBefore.contractText.length,
    `before=${agrBefore.status}; execute=${exec.ok}; after=${agrExecuted.status}; textLen=${agrExecuted.contractText.length}`
  );
  const voidBack = await call("void executed probe agreement", () =>
    c.mutation("agreements:voidExecutedAgreement", { agreementId: agrBefore._id, reason: "QA15 regression hunt cleanup after normal-execute probe." })
  );
  say(`voidBack=${voidBack.ok}`);

  // ---- A15-02: deadline boundary (slack is exactly one day)
  const boundary = [];
  const probe = async (csi, day, label) => {
    const r = await call(label, () =>
      c.mutation("tradePackages:createTradePackage", {
        projectId: F.cron.projectId,
        csiDivision: csi,
        tradeName: `AUDIT-QA15 Boundary ${day}`,
        budgetEstimate: 100_000,
        scopeSummary: "QA15 deadline boundary probe.",
        mandatoryInclusions: ["probe"],
        bidDeadline: day,
      })
    );
    boundary.push({ day, label, ok: r.ok, data: r.data ?? null });
    return r;
  };
  const t0 = await probe("15 00 00", todayUtc, `today=${todayUtc}`);
  const t1 = await probe("16 00 00", oneDayAgo, `oneDayAgo=${oneDayAgo}`);
  const t3 = await probe("17 00 00", threeDaysAgo, `threeDaysAgo=${threeDaysAgo}`);
  record(
    "A15-02-deadline-slack-bounded",
    t0.ok && t1.ok && !t3.ok && /cannot be in the past/i.test(`${t3.data ?? ""}`),
    `boundary=${JSON.stringify(boundary)}`
  );

  // ---- A15-03: monitor does not false-positive a future zero-bid package
  const futurePkg = await c.mutation("tradePackages:createTradePackage", {
    projectId: F.cron.projectId,
    csiDivision: "18 00 00",
    tradeName: "AUDIT-QA15 Future Zero Bid",
    budgetEstimate: 100_000,
    scopeSummary: "QA15 cron false-positive probe.",
    mandatoryInclusions: ["probe"],
    bidDeadline: "2026-12-31",
  });
  await c.mutation("tradePackages:updateStatus", { tradePackageId: futurePkg, status: "rfqs_dispatched" });
  const run = await call("runDeadlineMonitorNow (future control)", () =>
    c.mutation("crons:runDeadlineMonitorNow", { projectId: F.cron.projectId })
  );
  await sleep(700);
  const logs = (await c.query("auditLogs:listRecentLogs", { projectId: F.cron.projectId, limit: 500 })) || [];
  const futureRows = logs.filter((l) => l.tradePackageId === futurePkg && (l.title || "").startsWith("Deadline passed with no bids"));
  const futurePkgNow = await c.query("tradePackages:getPackage", { tradePackageId: futurePkg });
  const zeroRowsNow = logs.filter(
    (l) => l.tradePackageId === F.cron.zeroPackageId && (l.title || "").startsWith("Deadline passed with no bids")
  ).length;
  record(
    "A15-03-monitor-future-control-untouched",
    run.ok && futureRows.length === 0 && futurePkgNow.status === "rfqs_dispatched" && zeroRowsNow === 1,
    `run=${JSON.stringify(run.value || run.data)}; futureFlagged=${futureRows.length}; futureStatus=${futurePkgNow.status}; overdueZeroRows=${zeroRowsNow}`
  );

  // ---- A15-04: clash applied amount vs static benchmark
  const clashes = await c.raw.query("coordination:detectCrossTradeClashes", { projectId: F.mainProjectId });
  const disconnect = (clashes.doubleBuys || []).find((d) => d.id === "clash-disconnect-02");
  const hvacBid = ((await c.query("bids:listByPackage", { tradePackageId: F.clash.packageId })) || []).find((b) => b._id === F.clash.bidId);
  record(
    "A15-04-clash-applied-amount-is-truth",
    disconnect &&
      disconnect.status === "deducted" &&
      disconnect.deductedAmount === 9999 &&
      (disconnect.resolution === undefined || disconnect.resolution === null) &&
      hvacBid.leveledTotalCost === 790_000 - 9_999,
    `deductedAmount=${disconnect ? disconnect.deductedAmount : null}; resolution=${JSON.stringify(disconnect ? disconnect.resolution ?? null : null)}; hvacLeveled=${hvacBid ? hvacBid.leveledTotalCost : null}`
  );

  writeEvidence("regression-hunt", { results, boundary, future: { id: futurePkg, status: futurePkgNow.status, flagged: futureRows.length }, clash: disconnect ? { status: disconnect.status, deductedAmount: disconnect.deductedAmount, resolution: disconnect.resolution ?? null, redundantAmount: disconnect.redundantAmount } : null });
  writeLog("regression-hunt", log);
  console.log(`\nresults: ${results.filter((r) => r.pass).length}/${results.length} passed`);
}

main().catch((e) => {
  console.error(e);
  writeLog("regression-hunt-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});