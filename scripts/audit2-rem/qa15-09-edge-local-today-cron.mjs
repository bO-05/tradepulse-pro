/**
 * QA15 edge probe: cross-fix interaction between A14-01 (local-today deadline
 * accepted) and the deadline monitor's UTC-day semantics (A14-03).
 */
import { client, writeEvidence, writeLog, call, sleep, zonedDate } from "./qa15-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${detail}`);
};

const TITLE = "AUDIT-QA15-EDGE";

async function main() {
  const projects = (await c.query("projects:listProjects", {})) || [];
  const existing = projects.find((p) => p.title === TITLE);
  if (existing) {
    try { await c.mutation("projects:deleteProject", { projectId: existing._id }); } catch (err) { say(`pre-clean: ${err?.data ?? err?.message}`); }
    await sleep(600);
  }

  const now = new Date();
  const nyToday = zonedDate(now, "America/New_York");
  const utcToday = now.toISOString().slice(0, 10);
  const projId = await c.mutation("projects:createProject", {
    title: TITLE,
    location: "New York, NY",
    projectType: "QA15 edge cross-fix probe",
    estBudget: 500_000,
    targetCompletionWeeks: 20,
    specDocumentText: "QA15 edge probe spec.",
    isDemoProject: false,
    generalContractorName: "AUDIT-QA15 General Contractor LLC",
  });
  const pkgId = await c.mutation("tradePackages:createTradePackage", {
    projectId: projId,
    csiDivision: "26 00 00",
    tradeName: "AUDIT-QA15 Local Today Edge",
    budgetEstimate: 100_000,
    scopeSummary: "QA15 local-today cron interaction probe.",
    mandatoryInclusions: ["probe"],
    bidDeadline: nyToday,
  });
  await c.mutation("tradePackages:updateStatus", { tradePackageId: pkgId, status: "rfqs_dispatched" });
  say(`created package deadline=${nyToday} (NY local today; UTC today=${utcToday})`);

  const run = await call("runDeadlineMonitorNow on local-today zero-bid package", () =>
    c.mutation("crons:runDeadlineMonitorNow", { projectId: projId })
  );
  await sleep(700);
  const logs = (await c.query("auditLogs:listRecentLogs", { projectId: projId, limit: 200 })) || [];
  const flagged = logs.find((l) => (l.title || "").startsWith("Deadline passed with no bids"));
  const pkg = await c.query("tradePackages:getPackage", { tradePackageId: pkgId });

  writeEvidence("edge-cron", {
    clock: { nyToday, utcToday, nyNow: now.toString(), utcNow: now.toISOString() },
    run,
    flaggedRow: flagged ? { title: flagged.title, ts: flagged.timestamp } : null,
    packageStatus: pkg.status,
    note: "The scheduled monitor uses Date.parse(deadline) <= now, which is equally past for a local-today date-only deadline; code inspection convex/crons.ts:31-39.",
  });
  writeLog("edge-cron", log);
  console.log(`run=${JSON.stringify(run.value || run.data)} flagged=${flagged ? flagged.title : "none"} status=${pkg.status}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("edge-cron-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});