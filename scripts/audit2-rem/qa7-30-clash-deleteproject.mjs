/**
 * QA7 item 7 live: projects.deleteProject removes clashResolutions (no orphans).
 * Also probes cross-project ID confusion on the clash mutations.
 * Fixture: AUDIT-QA7-clash-2026-09-18 and AUDIT-QA7-clash-b-2026-09-18.
 * Evidence: evidence/fix4-qa7-30-clash-deleteproject.json
 */
import { client, call, expectOk, expectReject, writeEvidence, cliDump } from "./qa7-lib.mjs";

const c = client();
const prefixA = "AUDIT-QA7-clash-2026-09-18";
const prefixB = "AUDIT-QA7-clash-b-2026-09-18";
const out = { ranAt: new Date().toISOString(), fixtures: { a: prefixA, b: prefixB }, checks: [], cleanup: {} };
const mkProject = async (title) =>
  await c.mutation("projects:createProject", {
    title,
    location: "Austin, TX",
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: 2_000_000,
    targetCompletionWeeks: 40,
    specDocumentText: "QA7 clash fixture.",
    isDemoProject: false,
  });
const mkPackage = async (projectId, csi, name) =>
  await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision: csi,
    tradeName: name,
    budgetEstimate: 900_000,
    scopeSummary: `QA7 clash ${name}.`,
    mandatoryInclusions: ["Code compliance"],
    bidDeadline: "2026-10-31",
  });

let projectA;
let projectB;
try {
  projectA = await mkProject(prefixA);
  projectB = await mkProject(prefixB);
  const pkgA = await mkPackage(projectA, "26 00 00", "QA7 Clash Electrical");
  const pkgB = await mkPackage(projectB, "26 00 00", "QA7 Clash Other Project");
  out.fixtures.projectA = projectA;
  out.fixtures.projectB = projectB;
  out.fixtures.pkgA = pkgA;
  out.fixtures.pkgB = pkgB;

  // Cross-project confusion: package from B must be rejected for project A.
  const cross = await call("cross-project deductDoubleBuyCredit", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: projectA,
      clashId: "QA7-CROSS-1",
      tradePackageId: pkgB,
      deductAmount: 500,
      description: "cross-project probe",
    })
  );
  out.checks.push({
    ...expectReject(cross, null, "cross-project package rejected"),
    note:
      cross.name === "Error"
        ? "Plain Error (no client-visible data): rejection confirmed, server text verified in source at coordination.ts:319-321."
        : "message surfaced",
  });

  // Create a real clash resolution row on project A (no-bid path).
  const created = await call("deductDoubleBuyCredit on fixture A", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: projectA,
      clashId: "QA7-CLASH-LIVE-1",
      tradePackageId: pkgA,
      deductAmount: 1_500,
      description: "QA7 live orphan probe",
    })
  );
  out.checks.push(expectOk(created, "clash resolution recorded"));

  await new Promise((r) => setTimeout(r, 600));
  const rowsBefore = cliDump("clashResolutions").filter((r) => r.projectId === projectA);
  out.checks.push({
    label: "clashResolutions row exists before delete",
    expected: "1 row",
    observed: `${rowsBefore.length} rows`,
    ok: rowsBefore.length === 1,
  });

  const deleted = await call("deleteProject fixture A", () =>
    c.mutation("projects:deleteProject", { projectId: projectA })
  );
  const deletedB = await call("deleteProject fixture B", () =>
    c.mutation("projects:deleteProject", { projectId: projectB })
  );
  out.checks.push(expectOk(deleted, "deleteProject A succeeded"));
  out.checks.push(expectOk(deletedB, "deleteProject B succeeded"));

  await new Promise((r) => setTimeout(r, 1000));
  const scan = {
    clashResolutions: cliDump("clashResolutions").filter((r) => r.projectId === projectA || r.projectId === projectB).length,
    tradePackages: cliDump("tradePackages").filter((r) => r.projectId === projectA || r.projectId === projectB).length,
    auditLogs: cliDump("auditLogs").filter((r) => r.projectId === projectA || r.projectId === projectB).length,
    agreements: cliDump("agreements").filter((r) => r.projectId === projectA || r.projectId === projectB).length,
    bids: cliDump("bids").filter((r) => r.tradePackageId === pkgA || r.tradePackageId === pkgB).length,
    contractors: cliDump("contractors").filter((r) => r.tradePackageId === pkgA || r.tradePackageId === pkgB).length,
  };
  out.afterDelete = scan;
  out.checks.push({
    label: "no orphan clashResolutions after deleteProject",
    expected: "0 rows referencing fixture projects",
    observed: `${scan.clashResolutions} rows`,
    ok: scan.clashResolutions === 0,
  });
  out.checks.push({
    label: "no orphan packages/auditLogs/agreements/bids/contractors after deleteProject",
    expected: "all 0",
    observed: JSON.stringify(scan),
    ok: Object.values(scan).every((n) => n === 0),
  });
  out.preexistingOrphans =
    "12 legacy clashResolutions rows for projects deleted before the fix remain in prod (recorded in fix4-qa7-00-recon.json); they are outside this fixture and were not touched.";
} catch (err) {
  out.fatal = String(err?.message ?? err);
  console.error("FATAL", err);
} finally {
  const all = await c.query("projects:listProjects", {});
  for (const p of all.filter((p) => p.title.startsWith("AUDIT-QA7-clash"))) {
    await call(`cleanup ${p._id}`, () => c.mutation("projects:deleteProject", { projectId: p._id }));
  }
  await new Promise((r) => setTimeout(r, 800));
  const remaining = (await c.query("projects:listProjects", {})).filter((p) => p.title.startsWith("AUDIT-QA7-clash"));
  out.cleanup = {
    leftoverProjects: remaining.map((p) => p._id),
    clashResolutions: cliDump("clashResolutions").filter((r) => r.projectId === projectA || r.projectId === projectB).length,
  };
  writeEvidence("30-clash-deleteproject", out);
  const failed = out.checks.filter((k) => !k.ok);
  console.log(`\nQA7-30 done. failed=${failed.length}`);
  for (const f of failed) console.log(`  FAIL ${f.label}: observed=${f.observed}`);
}