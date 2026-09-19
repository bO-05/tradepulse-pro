import {
  client,
  readEvidence,
  writeEvidence,
  writeLog,
  call,
  sleep,
  utcDate,
  zonedDate,
  zonedDateTime,
} from "./qa14-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const fx = readEvidence("fixtures");

async function allPackageStatuses() {
  const projects = (await c.query("projects:listProjects", {})) || [];
  const out = {};
  for (const p of projects) {
    const pkgs = (await c.query("tradePackages:listByProject", { projectId: p._id })) || [];
    for (const pkg of pkgs) out[pkg._id] = { project: p.title, csi: pkg.csiDivision, status: pkg.status, deadline: pkg.bidDeadline };
  }
  return out;
}

async function main() {
  const result = { capturedAt: new Date().toISOString() };
  const now = new Date();
  const todayUtc = utcDate(now);
  const nyDate = zonedDate(now, "America/New_York");
  result.clock = {
    todayUtc,
    nyDate,
    nyNow: zonedDateTime(now, "America/New_York"),
    utcNow: now.toISOString(),
    nyLocalDayDiffersFromUtc: nyDate !== todayUtc,
  };
  say(`clock UTC=${todayUtc} NY=${nyDate} (${zonedDateTime(now, "America/New_York")})`);

  // ------------------------------------------------------------------
  // A14-01: deadline validation uses the UTC calendar day, not the
  // user's local day. A NY user at ~8pm on their local "today" cannot
  // set that date as a deadline; server calls it "in the past".
  // ------------------------------------------------------------------
  const localTodayCreate = await call(
    `createTradePackage(deadline=${nyDate}) while NY local date is ${nyDate}`,
    () =>
      c.mutation("tradePackages:createTradePackage", {
        projectId: fx.tzProjectId,
        csiDivision: "02 00 00",
        tradeName: "AUDIT-QA14 Local Today Probe",
        budgetEstimate: 100_000,
        scopeSummary: "QA14 timezone validation probe.",
        mandatoryInclusions: ["probe"],
        bidDeadline: nyDate,
      })
  );
  const utcTodayCreate = await call(
    `createTradePackage(deadline=${todayUtc}) same instant`,
    () =>
      c.mutation("tradePackages:createTradePackage", {
        projectId: fx.tzProjectId,
        csiDivision: "03 00 00",
        tradeName: "AUDIT-QA14 UTC Today Probe",
        budgetEstimate: 100_000,
        scopeSummary: "QA14 UTC-day control probe.",
        mandatoryInclusions: ["probe"],
        bidDeadline: todayUtc,
      })
  );
  const utcTodayProbePkg = utcTodayCreate.ok
    ? await c.query("tradePackages:getPackage", { tradePackageId: utcTodayCreate.value })
    : null;
  result.tzValidation = {
    nyLocalDate: nyDate,
    utcDate: todayUtc,
    localTodayCreate,
    utcTodayCreate,
    utcTodayProbePackage: utcTodayProbePkg,
  };
  say(`local-today create ok=${localTodayCreate.ok} err=${localTodayCreate.data || localTodayCreate.message || ""}`);
  say(`utc-today create ok=${utcTodayCreate.ok}`);

  // The exact instant a date-only deadline "expires" per Date.parse:
  const parsedInstant = new Date(Date.parse(todayUtc));
  result.dateOnlyInstant = {
    utc: parsedInstant.toISOString(),
    newYork: parsedInstant.toLocaleString("en-US", { timeZone: "America/New_York" }),
    losAngeles: parsedInstant.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }),
  };
  say(`date-only ${todayUtc} parses to instant: NY=${result.dateOnlyInstant.newYork}`);

  // ------------------------------------------------------------------
  // A14-02: deadline-day closure. P1 (due today UTC, has a bid) is
  // transitioned on the deadline DAY, and in NY that is the previous
  // local evening.
  // ------------------------------------------------------------------
  const beforeAll = await allPackageStatuses();
  const beforeTz = await c.query("tradePackages:listByProject", { projectId: fx.tzProjectId });
  result.before = { packages: beforeTz.map((p) => ({ id: p._id, csi: p.csiDivision, deadline: p.bidDeadline, status: p.status })) };
  say(`before: ${beforeTz.map((p) => `${p.csi}:${p.status}`).join(", ")}`);

  const run1 = await call("runDeadlineMonitorNow #1", () =>
    c.mutation("crons:runDeadlineMonitorNow", { projectId: fx.tzProjectId })
  );
  await sleep(700);
  const after1Tz = await c.query("tradePackages:listByProject", { projectId: fx.tzProjectId });
  const logs1 = (await c.query("auditLogs:listRecentLogs", { projectId: fx.tzProjectId, limit: 500 })) || [];
  result.run1 = {
    call: run1,
    packages: after1Tz.map((p) => ({ id: p._id, csi: p.csiDivision, deadline: p.bidDeadline, status: p.status })),
    logsAdded: logs1.slice(0, 6).map((l) => ({ title: l.title, packageId: l.tradePackageId || null })),
  };
  say(`run1 ${JSON.stringify(run1.value || run1.data)} -> ${after1Tz.map((p) => `${p.csi}:${p.status}`).join(", ")}`);

  const run2 = await call("runDeadlineMonitorNow #2 (idempotency)", () =>
    c.mutation("crons:runDeadlineMonitorNow", { projectId: fx.tzProjectId })
  );
  await sleep(700);
  const after2Tz = await c.query("tradePackages:listByProject", { projectId: fx.tzProjectId });
  const logs2 = (await c.query("auditLogs:listRecentLogs", { projectId: fx.tzProjectId, limit: 500 })) || [];
  const afterAll = await allPackageStatuses();

  result.run2 = {
    call: run2,
    packages: after2Tz.map((p) => ({ id: p._id, csi: p.csiDivision, deadline: p.bidDeadline, status: p.status })),
    manualTriggerRows: logs2.filter((l) => l.title.startsWith("Manual Trigger: Bid Deadline Monitor")).length,
    perPackageDeadlineRows: logs2.filter((l) => /Deadline passed|Bid Deadline Closed/.test(l.title)).map((l) => l.title),
  };
  say(`run2 ${JSON.stringify(run2.value || run2.data)} -> ${after2Tz.map((p) => `${p.csi}:${p.status}`).join(", ")}`);
  say(`manual trigger audit rows after 2 runs: ${result.run2.manualTriggerRows}`);

  const changed = [];
  for (const [id, s] of Object.entries(afterAll)) {
    const b = beforeAll[id];
    if (!b) changed.push({ id, status: s.status, note: "new package" });
    else if (b.status !== s.status) changed.push({ id, project: s.project, csi: s.csi, before: b.status, after: s.status });
  }
  result.globalStatusChanges = changed;
  result.unrelatedPackagesTouched = changed.filter((x) => x.project !== fx.tzProjectTitle);
  say(`global status changes: ${JSON.stringify(changed)}`);

  const byId = Object.fromEntries(after2Tz.map((p) => [p._id, p.status]));
  result.expectedVsObserved = {
    dueTodayWithBid: { id: fx.dueTodayElectPackageId, expected: "leveling on deadline day", observed: byId[fx.dueTodayElectPackageId] },
    dueTodayNoBid: { id: fx.dueTodayNoBidPackageId, expected: "unchanged (rfqs_dispatched)", observed: byId[fx.dueTodayNoBidPackageId] },
    futureControl: { id: fx.futureControlPackageId, expected: "rfqs_dispatched", observed: byId[fx.futureControlPackageId] },
    otherProjectControl: { id: fx.controlPackageId, expected: "rfqs_dispatched", observed: afterAll[fx.controlPackageId]?.status },
  };

  const ctrlLogs = (await c.query("auditLogs:listRecentLogs", { projectId: fx.controlProjectId, limit: 50 })) || [];
  result.controlProjectLogs = ctrlLogs.map((l) => l.title);

  writeEvidence("tz-backend", result);
  writeLog("tz-backend", log);
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});