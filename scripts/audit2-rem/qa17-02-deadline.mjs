/**
 * QA17-02: A15-05 deadline monitor verification.
 * Live clock during round-6 verification: UTC 2026-09-19 (~01:3x) = NY 2026-09-18 (~21:3x EDT).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { client, readEvidence, writeEvidence, writeLog, sleep, zonedDate, zonedDateTime } from "./qa17-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${JSON.stringify(detail)}`);
};

function flagCount(logs, pkgId) {
  return logs.filter((l) => l.tradePackageId === pkgId && (l.title || "").startsWith("Deadline passed with no bids")).length;
}
function closeLogCount(logs, pkgId) {
  return logs.filter((l) => l.tradePackageId === pkgId && (l.title || "").startsWith("Cron Monitor: Bid Deadline Closed")).length;
}

async function snapshot(tag) {
  const pkgs = (await c.query("tradePackages:listByProject", { projectId: F.deadline.id })) || [];
  const logs = (await c.query("auditLogs:listRecentLogs", { projectId: F.deadline.id, limit: 300 })) || [];
  const s = {};
  for (const [k, id] of Object.entries(F.deadline.packages)) {
    const p = pkgs.find((x) => x._id === id);
    s[k] = { status: p ? p.status : null, deadline: p ? p.bidDeadline : null, flags: flagCount(logs, id), closeLogs: closeLogCount(logs, id) };
  }
  say(`[${tag}] ${JSON.stringify(s)}`);
  return { tag, packages: s, flagTitles: logs.filter((l) => (l.title || "").startsWith("Deadline passed with no bids")).map((l) => l.title) };
}

async function main() {
  // submitDirectBid forces the package to "leveling"; the monitor only inspects
  // rfqs_dispatched packages, so restore the dispatch state to exercise the
  // "bids on file at deadline" branch (reachable via updateStatus in the app).
  for (const id of [F.deadline.packages.localTodayWithBids, F.deadline.packages.utcTodayWithBids]) {
    await c.mutation("tradePackages:updateStatus", { tradePackageId: id, status: "rfqs_dispatched" });
  }
  await sleep(600);

  const before = await snapshot("before");
  const run1 = await c.mutation("crons:runDeadlineMonitorNow", { projectId: F.deadline.id });
  await sleep(900);
  const after1 = await snapshot("after-run1");
  const run2 = await c.mutation("crons:runDeadlineMonitorNow", { projectId: F.deadline.id });
  await sleep(900);
  const after2 = await snapshot("after-run2");

  const now = new Date();
  const tz = "America/New_York";
  const localDate = zonedDate(now, tz);
  const utcDate = now.toISOString().slice(0, 10);
  const localDayEnd = new Date(`${localDate}T23:59:59.999-04:00`).getTime();
  const deadlineUtcDayEnd = new Date(`${F.deadline.packages.localTodayNoBids ? localDate : localDate}T23:59:59.999Z`).getTime();

  const clock = {
    nowIso: now.toISOString(),
    utcDate,
    localDate,
    localDateTime: zonedDateTime(now, tz),
    localDayEndIso: new Date(localDayEnd).toISOString(),
    localDayEndPassed: now.getTime() > localDayEnd,
    deadlineUtcDayEndIso: new Date(deadlineUtcDayEnd).toISOString(),
    prematureFlaggingMs: now.getTime() > deadlineUtcDayEnd && now.getTime() < localDayEnd ? localDayEnd - now.getTime() : 0,
  };
  say(`clock: ${JSON.stringify(clock)}`);

  // Static parity of scheduled vs manual monitor expressions (touched file).
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const cronsSrc = fs.readFileSync(path.join(root, "convex", "crons.ts"), "utf8");
  const parseExprs = [...cronsSrc.matchAll(/Date\.parse\(`\$\{pkg\.bidDeadline\}([^`]*)`\)/g)].map((m) => m[1]);
  const parity = { expressions: parseExprs, bothEndOfUtcDay: parseExprs.length === 2 && parseExprs.every((e) => e === "T23:59:59.999Z"), oldStringCompareLeft: /pkg\.bidDeadline <= today/.test(cronsSrc) };

  const A = after1.packages;
  const A2 = after2.packages;

  record("A15-05.localTodayNoBids-NOT-flagged", A.localTodayNoBids.flags === 0, { deadline: A.localTodayNoBids.deadline, flags: A.localTodayNoBids.flags, expected: "0 (per requirement: user local today must not be flagged)" });
  record("A15-05.utcTodayNoBids-NOT-flagged", A.utcTodayNoBids.flags === 0, { deadline: A.utcTodayNoBids.deadline, flags: A.utcTodayNoBids.flags });
  record("A15-05.localTodayWithBids-NOT-transitioned", A.localTodayWithBids.status !== "leveling", { status: A.localTodayWithBids.status, expected: "rfqs_dispatched (deadline day not over for NY user)" });
  record("A15-05.utcTodayWithBids-NOT-transitioned", A.utcTodayWithBids.status !== "leveling", { status: A.utcTodayWithBids.status });
  record("A15-05.flag-once-idempotent", A.localTodayNoBids.flags >= 1 && A2.localTodayNoBids.flags === A.localTodayNoBids.flags, { afterRun1: A.localTodayNoBids.flags, afterRun2: A2.localTodayNoBids.flags });
  record("A15-05.monitor-parity", parity.bothEndOfUtcDay && !parity.oldStringCompareLeft, parity);

  const out = {
    capturedAt: now.toISOString(),
    clock,
    parity,
    twoDaysLocalCreation: F.deadline.twoDaysLocalCreation,
    runs: { run1, run2 },
    before,
    after1,
    after2,
    requirementMapping: {
      localToday: F.clock.nyToday,
      utcToday: F.clock.utcToday,
      yesterdayUtc: F.clock.nyToday,
      note: "At the verification clock, NY local today (2026-09-18) IS yesterday-UTC; the two requirement cases coincide. A date two days before UTC today (2026-09-17) is rejected by validateBidDeadline as past.",
    },
    results,
  };
  writeEvidence("deadline", out);
  writeLog("deadline", log);
  console.log(`results: ${results.filter((r) => r.pass).length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("deadline-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});