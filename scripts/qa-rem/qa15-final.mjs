// QA-15 Item 3: delete all QA-15 fixtures and prove demo integrity vs preflight baseline.
// Usage: node scripts/qa-rem/qa15-final.mjs
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const client = new ConvexHttpClient(BACKEND);

const LOG = [];
const OUT = { at: new Date().toISOString(), items: {} };
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};

async function snapshotProject(projectId) {
  const project = await client.query("projects:getProject", { projectId });
  const packages = await client.query("tradePackages:listByProject", { projectId });
  const bids = await client.query("bids:listAllProjectBids", { projectId });
  const agreements = await client.query("agreements:listAgreements", { projectId });
  const logs = await client.query("auditLogs:listRecentLogs", { projectId, limit: 1000 });
  const contractors = await client.query("contractors:listByProject", { projectId });
  const files = await client.query("files:listFilesByProject", { projectId });
  return {
    id: projectId,
    title: project?.title,
    location: project?.location,
    estBudget: project?.estBudget,
    targetCompletionWeeks: project?.targetCompletionWeeks,
    isDemoProject: project?.isDemoProject,
    packageCount: packages.length,
    packageIds: packages.map((p) => p._id).sort(),
    bidCount: bids.length,
    bidIds: bids.map((b) => b._id).sort(),
    agreementCount: agreements.length,
    agreementIds: agreements.map((a) => a._id).sort(),
    auditLogCount: logs.length,
    auditLogIds: logs.map((l) => l._id).sort(),
    contractorCount: contractors.length,
    contractorIds: contractors.map((c) => c._id).sort(),
    fileCount: files.length,
    fileNames: files.map((f) => f.fileName).sort(),
  };
}

async function main() {
  ev("=== QA-15 FINAL CLEANUP + DEMO INTEGRITY ===");
  ev(`UTC: ${new Date().toISOString()}`);
  ev("");

  // 1) delete all QA-REM fixtures
  const before = await client.query("projects:listProjects", {});
  const mine = before.filter((p) => !p.isDemoProject && p.title.startsWith("QA-REM"));
  ev(`fixtures to delete: ${mine.length}`);
  for (const p of mine) {
    try {
      await client.mutation("projects:deleteProject", { projectId: p._id });
      ev(`  deleted: ${p.title} [${p._id}]`);
    } catch (e) {
      ev(`  DELETE FAILED: ${p.title} -> ${e?.message || e}`);
    }
  }
  const after = await client.query("projects:listProjects", {});
  ev(`projects after cleanup: ${after.length} -> ${JSON.stringify(after.map((p) => p.title))}`);
  OUT.items.only_demo_project = after.length === 1 && after[0].isDemoProject === true;
  OUT.items.no_qa_fixtures_left = !after.some((p) => (p.title || "").startsWith("QA-REM"));

  // 2) demo snapshot vs preflight baseline
  const baseline = JSON.parse(
    fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa15-preflight-baseline.json"), "utf8")
  );
  const demo = after.find((p) => p.isDemoProject);
  const snap = await snapshotProject(demo._id);
  const base = baseline.demoSnapshot;

  const countKeys = ["packageCount", "bidCount", "agreementCount", "fileCount", "contractorCount"];
  const countMismatch = countKeys.filter((k) => snap[k] !== base[k]);
  // Preflight baseline stored packages as objects and files as "name:size"; normalize both sides.
  const basePackageIds = (base.packages || []).map((p) => p.id).sort();
  const baseFileNames = (base.fileSizes || []).map((f) => f.slice(0, f.lastIndexOf(":"))).sort();
  const idMismatch = [];
  if (JSON.stringify(snap.packageIds) !== JSON.stringify(basePackageIds)) idMismatch.push("packageIds");
  if (JSON.stringify(snap.fileNames) !== JSON.stringify(baseFileNames)) idMismatch.push("fileNames");
  for (const k of ["bidIds", "agreementIds", "contractorIds"]) {
    if (JSON.stringify(snap[k]) !== JSON.stringify(base[k])) idMismatch.push(k);
  }
  const metaKeys = ["title", "location", "estBudget", "targetCompletionWeeks"];
  const metaMismatch = metaKeys.filter((k) => snap[k] !== base[k]);

  ev(`demo now: packages=${snap.packageCount} bids=${snap.bidCount} agreements=${snap.agreementCount} files=${snap.fileCount} contractors=${snap.contractorCount} logs=${snap.auditLogCount}`);
  ev(`demo base: packages=${base.packageCount} bids=${base.bidCount} agreements=${base.agreementCount} files=${base.fileCount} contractors=${base.contractorCount} logs=${base.auditLogCount}`);
  ev(`count mismatches: ${JSON.stringify(countMismatch)}; id mismatches: ${JSON.stringify(idMismatch)}; meta mismatches: ${JSON.stringify(metaMismatch)}`);
  ev(`auditLog count base=${base.auditLogCount} now=${snap.auditLogCount} (informational)`);

  const demoClash = await client.query("coordination:detectCrossTradeClashes", { projectId: demo._id });
  ev(`demo clashes now: active=${demoClash.summary.activeClashesCount} doubleBuys=${demoClash.doubleBuys.length} voids=${demoClash.scopeVoids.length}`);

  OUT.items.demo_counts_unchanged = countMismatch.length === 0;
  OUT.items.demo_ids_unchanged = idMismatch.length === 0;
  OUT.items.demo_meta_unchanged = metaMismatch.length === 0;
  OUT.items.demo_clashes_4_active =
    demoClash.summary.activeClashesCount === 4 && demoClash.doubleBuys.length === 2 && demoClash.scopeVoids.length === 2;
  OUT.steps = {
    deletedFixtures: mine.map((p) => ({ id: p._id, title: p.title })),
    remainingProjects: after.map((p) => ({ id: p._id, title: p.title, isDemo: Boolean(p.isDemoProject) })),
    demoNow: snap,
    demoBaseline: {
      packageCount: base.packageCount,
      bidCount: base.bidCount,
      agreementCount: base.agreementCount,
      fileCount: base.fileCount,
      contractorCount: base.contractorCount,
      auditLogCount: base.auditLogCount,
    },
    countMismatch,
    idMismatch,
    metaMismatch,
    demoClashActive: demoClash.summary.activeClashesCount,
  };

  const expected = { packages: 3, bids: 6, files: 8, agreements: 1 };
  ev("");
  ev(
    `EXPECTED demo counts 3 packages / 6 bids / 8 files / 1 agreement -> now ${snap.packageCount}/${snap.bidCount}/${snap.fileCount}/${snap.agreementCount}: ${
      snap.packageCount === expected.packages &&
      snap.bidCount === expected.bids &&
      snap.fileCount === expected.files &&
      snap.agreementCount === expected.agreements
        ? "MATCH"
        : "MISMATCH"
    }`
  );

  const failed = Object.entries(OUT.items).filter(([, v]) => !v).map(([k]) => k);
  OUT.overall = failed.length === 0 ? "PASS" : "FAIL";
  ev(`ITEMS: ${Object.entries(OUT.items).map(([k, v]) => `${k}=${v ? "PASS" : "FAIL"}`).join(" | ")}`);
  ev(`OVERALL: ${OUT.overall}${failed.length ? ` (failed: ${failed.join(", ")})` : ""}`);

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa15-final.txt"), LOG.join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa15-final.json"), JSON.stringify(OUT, null, 2), "utf8");
  console.log("Wrote final cleanup evidence.");
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("FATAL", e);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa15-final.txt"), LOG.join("\n") + `\nFATAL: ${e?.stack || e?.message}\n`, "utf8");
  process.exit(1);
});