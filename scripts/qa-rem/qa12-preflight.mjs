// QA-12 (round 5, final convergence) preflight: DB state + demo baseline snapshot.
// Usage: node scripts/qa-rem/qa12-preflight.mjs
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
    agreementCount: agreements.length,
    agreementIds: agreements.map((a) => a._id).sort(),
    auditLogCount: logs.length,
    auditLogIds: logs.map((l) => l._id).sort(),
    contractorCount: contractors.length,
    contractorIds: contractors.map((c) => c._id).sort(),
  };
}

async function main() {
  ev("=== QA-12 PREFLIGHT ===");
  ev(`Backend: ${BACKEND}`);
  ev(`UTC    : ${new Date().toISOString()}`);
  ev("");

  const projects = await client.query("projects:listProjects", {});
  ev(`projects: count=${projects.length}`);
  for (const p of projects) {
    ev(`  - ${p.title} | isDemo=${p.isDemoProject} | id=${p._id} | budget=${p.estBudget}`);
  }
  ev("");

  const demo = projects.find((p) => p.isDemoProject);
  const nonDemo = projects.filter((p) => !p.isDemoProject);
  ev(`demo present: ${Boolean(demo)}; non-demo count: ${nonDemo.length}`);
  ev(`non-demo titles: ${JSON.stringify(nonDemo.map((p) => p.title))}`);
  ev("");

  let demoSnap = null;
  if (demo) {
    demoSnap = await snapshotProject(demo._id);
    ev(`demo snapshot: title="${demoSnap.title}" budget=${demoSnap.estBudget} packages=${demoSnap.packageCount} bids=${demoSnap.bidCount} agreements=${demoSnap.agreementCount} logs=${demoSnap.auditLogCount} contractors=${demoSnap.contractorCount}`);
    const divisions = demoSnap.packages.map((p) => p.csiDivision).join(",");
    ev(`demo package divisions: ${divisions}`);
  }

  // clash query on demo
  let demoClashes = null;
  try {
    demoClashes = await client.query("coordination:detectCrossTradeClashes", { projectId: demo._id });
    ev(`demo clashes: ${JSON.stringify(Array.isArray(demoClashes) ? { count: demoClashes.length, sample: demoClashes[0] ?? null } : demoClashes)}`);
  } catch (err) {
    ev(`demo clashes ERROR: ${err?.message}`);
  }
  ev("");

  const out = {
    at: new Date().toISOString(),
    backend: BACKEND,
    projectCount: projects.length,
    projects: projects.map((p) => ({ id: p._id, title: p.title, isDemoProject: Boolean(p.isDemoProject) })),
    nonDemoCount: nonDemo.length,
    demoSnapshot: demoSnap,
    demoClashCount: Array.isArray(demoClashes) ? demoClashes.length : null,
    demoClashesSample: Array.isArray(demoClashes) ? demoClashes.slice(0, 2) : null,
  };
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa12-preflight.txt"), LOG.join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa12-baseline.json"), JSON.stringify(out, null, 2), "utf8");
  console.log("Wrote preflight evidence.");
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});