/**
 * QA7 item 6 live: crons.runDeadlineMonitorNow behavior on prod.
 * Fixture: AUDIT-QA7-cron-2026-09-18 (created here, deleted here).
 * Evidence: evidence/fix4-qa7-20-cron-live.json
 */
import { client, call, expectOk, expectReject, writeEvidence, fixtureName, cliDump } from "./qa7-lib.mjs";

const c = client();
const prefix = fixtureName("cron");
const out = { ranAt: new Date().toISOString(), fixture: { title: prefix }, checks: [], cleanup: {} };
let projectId;
try {
  projectId = await c.mutation("projects:createProject", {
    title: prefix,
    location: "Austin, TX",
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: 3_000_000,
    targetCompletionWeeks: 52,
    specDocumentText: "QA7 cron fixture.",
    isDemoProject: false,
  });
  out.fixture.projectId = projectId;

  const mkPackage = async (csi, name) =>
    await c.mutation("tradePackages:createTradePackage", {
      projectId,
      csiDivision: csi,
      tradeName: name,
      budgetEstimate: 1_000_000,
      scopeSummary: `QA7 cron ${name}.`,
      mandatoryInclusions: ["Code compliance"],
      bidDeadline: "2026-09-18",
    });
  const emptyPkg = await mkPackage("26 00 00", "QA7 Cron Empty");
  const bidPkg = await mkPackage("23 00 00", "QA7 Cron With Bid");
  out.fixture.emptyPackageId = emptyPkg;
  out.fixture.bidPackageId = bidPkg;

  const contractorId = await c.mutation("contractors:createContractor", {
    tradePackageId: bidPkg,
    companyName: "QA7 Cron Bidder",
    contactEmail: "cron-bidder@qa7.test",
    phone: "+1 (512) 555-0101",
    licenseNumber: "TX-QA7-CRON",
    licenseStatus: "Active / Verified",
    sourceUrl: "https://qa7.test/cron-bidder",
    rfqStatus: "invited",
  });
  await c.mutation("bids:submitDirectBid", {
    tradePackageId: bidPkg,
    contractorId,
    subcontractorName: "QA7 Cron Bidder",
    baseBidAmount: 900_000,
  });
  // submitDirectBid moves the package to leveling; reset to dispatched to arm the cron.
  await c.mutation("tradePackages:updateStatus", { tradePackageId: bidPkg, status: "rfqs_dispatched" });
  await c.mutation("tradePackages:updateStatus", { tradePackageId: emptyPkg, status: "rfqs_dispatched" });

  const run1 = await call("runDeadlineMonitorNow #1", () => c.mutation("crons:runDeadlineMonitorNow", { projectId }));
  const run2 = await call("runDeadlineMonitorNow #2", () => c.mutation("crons:runDeadlineMonitorNow", { projectId }));
  const after1 = {
    empty: (await c.query("tradePackages:getPackage", { tradePackageId: emptyPkg }))?.status,
    withBid: (await c.query("tradePackages:getPackage", { tradePackageId: bidPkg }))?.status,
  };
  const logs = await c.query("auditLogs:listRecentLogs", { projectId, limit: 100 });
  const titles = logs.map((l) => l.title);
  out.checks.push({
    label: "zero-bid overdue package is NOT advanced to leveling",
    expected: "rfqs_dispatched",
    observed: after1.empty,
    ok: after1.empty === "rfqs_dispatched",
  });
  out.checks.push({
    label: "package with bids IS advanced to leveling",
    expected: "leveling",
    observed: after1.withBid,
    ok: after1.withBid === "leveling",
  });
  out.checks.push({
    label: "public monitor returns counts",
    expected: "run1 {monitoredCount:2, transitionedCount:1}, run2 transitionedCount:0",
    observed: JSON.stringify({ run1: run1.value, run2: run2.value }),
    ok:
      run1.ok &&
      run2.ok &&
      run1.value.monitoredCount === 2 &&
      run1.value.transitionedCount === 1 &&
      run2.value.transitionedCount === 0,
  });
  const noBidRows = titles.filter((t) => t.startsWith("Deadline passed with no bids"));
  out.checks.push({
    label: "no duplicate 'Deadline passed with no bids' rows from public monitor",
    expected: "0 rows (the idempotent flag lives in internal monitorBidDeadlines; public monitor writes none)",
    observed: `${noBidRows.length} rows`,
    ok: noBidRows.length === 0,
  });
  const manualRows = titles.filter((t) => t.startsWith("Manual Trigger: Bid Deadline Monitor Executed"));
  out.checks.push({
    label: "manual-trigger audit rows are one per explicit invocation (not repeated spam per package)",
    expected: "2 rows for 2 calls",
    observed: `${manualRows.length} rows`,
    ok: manualRows.length === 2,
  });
  out.internalCronEvidence = "convex/qa7Guards.test.ts#QA7-6 (two runs -> exactly 1 no-bids row, status unchanged)";
  out.auditTitles = titles;
} catch (err) {
  out.fatal = String(err?.message ?? err);
  console.error("FATAL", err);
} finally {
  const all = await c.query("projects:listProjects", {});
  for (const p of all.filter((p) => p.title.startsWith(prefix))) {
    await call(`cleanup ${p._id}`, () => c.mutation("projects:deleteProject", { projectId: p._id }));
  }
  await new Promise((r) => setTimeout(r, 1000));
  const remaining = (await c.query("projects:listProjects", {})).filter((p) => p.title.startsWith(prefix));
  out.cleanup = {
    leftoverProjects: remaining.map((p) => p._id),
    packages: cliDump("tradePackages").filter((r) => r.projectId === projectId).length,
    auditLogs: cliDump("auditLogs").filter((r) => r.projectId === projectId).length,
  };
  writeEvidence("20-cron-live", out);
  const failed = out.checks.filter((k) => !k.ok);
  console.log(`\nQA7-20 done. failed=${failed.length}`);
  for (const f of failed) console.log(`  FAIL ${f.label}: observed=${f.observed}`);
}