// QA-14 (round 6, fresh independent adversarial verifier) preflight.
// Confirms DB contains only the demo project and snapshots the demo baseline.
// Usage: node scripts/qa-rem/qa14-preflight.mjs
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const client = new ConvexHttpClient(BACKEND);

const LOG = [];
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
    packages: packages
      .map((p) => ({
        id: p._id,
        csiDivision: p.csiDivision,
        tradeName: p.tradeName,
        budgetEstimate: p.budgetEstimate,
        status: p.status,
      }))
      .sort((a, b) => String(a.csiDivision).localeCompare(String(b.csiDivision))),
    bidCount: bids.length,
    bidIds: bids.map((b) => b._id).sort(),
    bidRevs: bids.map((b) => `${b._id}:rev${b.revisionNumber ?? 1}`).sort(),
    agreementCount: agreements.length,
    agreementIds: agreements.map((a) => a._id).sort(),
    auditLogCount: logs.length,
    auditLogIds: logs.map((l) => l._id).sort(),
    contractorCount: contractors.length,
    contractorIds: contractors.map((c) => c._id).sort(),
    fileCount: files.length,
    fileSizes: files
      .map((f) => `${f.fileName}:${f.fileSize}`)
      .sort(),
  };
}

async function main() {
  ev("=== QA-14 PREFLIGHT ===");
  ev(`Backend: ${BACKEND}`);
  ev(`UTC    : ${new Date().toISOString()}`);
  ev("");

  const projects = await client.query("projects:listProjects", {});
  ev(`projects: count=${projects.length}`);
  for (const p of projects) {
    ev(`  - ${p.title} | isDemo=${p.isDemoProject} | id=${p._id} | budget=${p.estBudget}`);
  }
  const demo = projects.find((p) => p.isDemoProject);
  const nonDemo = projects.filter((p) => !p.isDemoProject);
  ev(`demo present: ${Boolean(demo)}; non-demo count: ${nonDemo.length}`);
  ev(`non-demo titles: ${JSON.stringify(nonDemo.map((p) => p.title))}`);
  ev("");

  let demoSnap = null;
  let demoClash = null;
  if (demo) {
    demoSnap = await snapshotProject(demo._id);
    ev(
      `demo snapshot: title="${demoSnap.title}" budget=${demoSnap.estBudget} packages=${demoSnap.packageCount} bids=${demoSnap.bidCount} agreements=${demoSnap.agreementCount} logs=${demoSnap.auditLogCount} contractors=${demoSnap.contractorCount} files=${demoSnap.fileCount}`
    );
    demoClash = await client.query("coordination:detectCrossTradeClashes", { projectId: demo._id });
    ev(
      `demo clashes: doubleBuys=${demoClash?.doubleBuys?.length} scopeVoids=${demoClash?.scopeVoids?.length} summary=${JSON.stringify(demoClash?.summary)}`
    );
  }

  const out = {
    at: new Date().toISOString(),
    backend: BACKEND,
    projectCount: projects.length,
    projects: projects.map((p) => ({ id: p._id, title: p.title, isDemoProject: Boolean(p.isDemoProject) })),
    onlyDemo: projects.length === 1 && projects[0].isDemoProject === true,
    demoSnapshot: demoSnap,
    demoClash: demoClash
      ? {
          doubleBuys: demoClash.doubleBuys?.length ?? null,
          scopeVoids: demoClash.scopeVoids?.length ?? null,
          summary: demoClash.summary ?? null,
        }
      : null,
  };

  ev("");
  ev(`ONLY-DEMO PRECONDITION: ${out.onlyDemo ? "PASS" : "FAIL"}`);

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa14-preflight.txt"), LOG.join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa14-baseline.json"), JSON.stringify(out, null, 2), "utf8");
  console.log("Wrote preflight evidence.");
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});