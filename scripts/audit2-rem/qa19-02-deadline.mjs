/**
 * QA19-02: A17-01 deadline monitor — local-day closing.
 * Clock at capture: UTC date is ahead of America/New_York local date.
 * Verifies both the scheduled and manual monitor paths carry the +12h slack.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { client, readEvidence, writeEvidence, writeLog, sleep, zonedDate } from "./qa19-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${JSON.stringify(detail)}`);
};

const flagCount = (logs, pkgId) =>
  logs.filter((l) => l.tradePackageId === pkgId && (l.title || "").startsWith("Deadline passed with no bids")).length;
const closeLogCount = (logs, pkgId) =>
  logs.filter((l) => l.tradePackageId === pkgId && (l.title || "").startsWith("Cron Monitor: Bid Deadline Closed")).length;

async function snapshot(tag) {
  const pkgs = (await c.query("tradePackages:listByProject", { projectId: F.deadline.id })) || [];
  const logs = (await c.query("auditLogs:listRecentLogs", { projectId: F.deadline.id, limit: 300 })) || [];
  const s = {};
  for (const [k, id] of Object.entries(F.deadline.packages)) {
    const p = pkgs.find((x) => x._id === id);
    s[k] = {
      status: p ? p.status : null,
      deadline: p ? p.bidDeadline : null,
      flags: flagCount(logs, id),
      closeLogs: closeLogCount(logs, id),
    };
  }
  say(`[${tag}] ${JSON.stringify(s)}`);
  return { tag, packages: s };
}

async function main() {
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
  const clock = {
    nowIso: now.toISOString(),
    utcDate,
    localDate,
    utcDateAheadOfLocal: utcDate > localDate,
    localTodayDeadlineIsUtcYesterday: F.deadline.packages.localTodayNoBids !== undefined,
    closingLocalTodayIso: new Date(F.deadline.expected.closingTimeLocalTodayIso).toISOString(),
    closingLocalTodayInFuture: F.deadline.expected.closingTimeLocalTodayIso > now.getTime(),
  };
  say(`clock: ${JSON.stringify(clock)}`);

  // Static parity: both monitor paths must include the +12h slack constant.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const cronsSrc = fs.readFileSync(path.join(root, "convex", "crons.ts"), "utf8");
  const parseExprs = [...cronsSrc.matchAll(/Date\.parse\(`\$\{pkg\.bidDeadline\}([^`]*)`\)([^;&\n]*)/g)].map((m) => ({
    suffix: m[1],
    trailing: (m[2] || "").trim(),
  }));
  const parity = {
    expressions: parseExprs,
    bothHave12hSlack: parseExprs.length === 2 && parseExprs.every((e) => /12 \* 60 \* 60 \* 1000/.test(e.trailing)),
  };
  say(`parity: ${JSON.stringify(parity)}`);

  const A = after1.packages;
  const A2 = after2.packages;

  record("A17-01.localTodayNoBids-NOT-flagged", A.localTodayNoBids.flags === 0, {
    deadline: A.localTodayNoBids.deadline,
    utcDate,
    localDate,
    flags: A.localTodayNoBids.flags,
    oldBehaviorWouldFlag: new Date(`${A.localTodayNoBids.deadline}T23:59:59.999Z`).getTime() <= now.getTime(),
  });
  record("A17-01.utcTodayNoBids-NOT-flagged", A.utcTodayNoBids.flags === 0, {
    deadline: A.utcTodayNoBids.deadline,
    flags: A.utcTodayNoBids.flags,
  });
  record("A17-01.localTodayNoBids-status-unchanged", A.localTodayNoBids.status === "rfqs_dispatched", {
    status: A.localTodayNoBids.status,
  });
  record("A17-01.localTodayWithBids-NOT-transitioned", A.localTodayWithBids.status !== "leveling", {
    status: A.localTodayWithBids.status,
    closeLogs: A.localTodayWithBids.closeLogs,
    expected: "rfqs_dispatched until closing time 2026-09-19T11:59:59.999Z",
  });
  record("A17-01.withBids-no-close-log", A.localTodayWithBids.closeLogs === 0, {
    closeLogs: A.localTodayWithBids.closeLogs,
  });
  record("A17-01.flag-once-idempotent", A.localTodayNoBids.flags === 0 && A2.localTodayNoBids.flags === A.localTodayNoBids.flags, {
    afterRun1: A.localTodayNoBids.flags,
    afterRun2: A2.localTodayNoBids.flags,
  });
  record("A17-01.monitor-parity", parity.bothHave12hSlack, parity);
  record("A17-01.no-transitions-at-local-today", run1.transitionedCount === 0 && run2.transitionedCount === 0, {
    run1: run1.transitionedCount,
    run2: run2.transitionedCount,
    monitored: run1.monitoredCount,
  });

  const out = {
    capturedAt: now.toISOString(),
    clock,
    parity,
    fixtures: F.deadline,
    runs: { run1, run2 },
    before,
    after1,
    after2,
    note:
      "Live >12h-past case cannot be created via the public API at this clock (validator rejects 2026-09-17). " +
      "Deterministic boundary proof is the fake-clock vitest (convex qa19Round7.temp.test.ts) plus QA7-6 (2020-01-01).",
    results,
  };
  writeEvidence("deadline", out);
  writeLog("deadline", log);
  console.log(`results: ${results.filter((r) => r.pass).length}/${results.length}`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("deadline-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});