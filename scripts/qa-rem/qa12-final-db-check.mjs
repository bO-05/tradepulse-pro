// QA-12 final DB check: only demo project, no QA-REM fixtures, demo intact vs baseline.
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const client = new ConvexHttpClient(BACKEND);
const baseline = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa12-baseline.json"), "utf8"));

const projects = await client.query("projects:listProjects", {});
const demo = projects.find((p) => p.isDemoProject);
const nonDemo = projects.filter((p) => !p.isDemoProject);
const lines = [];
lines.push("=== QA-12 FINAL DB CHECK ===");
lines.push(`UTC: ${new Date().toISOString()}`);
lines.push(`total projects: ${projects.length}`);
for (const p of projects) lines.push(`  - ${p.title} | isDemo=${p.isDemoProject} | id=${p._id}`);
lines.push(`non-demo remaining: ${nonDemo.length} ${JSON.stringify(nonDemo.map((p) => p.title))}`);

let demoOk = null;
if (demo) {
  const pkgs = await client.query("tradePackages:listByProject", { projectId: demo._id });
  const bids = await client.query("bids:listAllProjectBids", { projectId: demo._id });
  const ags = await client.query("agreements:listAgreements", { projectId: demo._id });
  const logs = await client.query("auditLogs:listRecentLogs", { projectId: demo._id, limit: 1000 });
  const contractors = await client.query("contractors:listByProject", { projectId: demo._id });
  const now = {
    packageCount: pkgs.length,
    bidCount: bids.length,
    agreementCount: ags.length,
    auditLogCount: logs.length,
    contractorCount: contractors.length,
  };
  const b = baseline.demoSnapshot;
  demoOk =
    now.packageCount === b.packageCount &&
    now.bidCount === b.bidCount &&
    now.agreementCount === b.agreementCount &&
    now.auditLogCount === b.auditLogCount &&
    now.contractorCount === b.contractorCount;
  lines.push(`demo counts: ${JSON.stringify(now)}`);
  lines.push(`baseline    : ${JSON.stringify({ packageCount: b.packageCount, bidCount: b.bidCount, agreementCount: b.agreementCount, auditLogCount: b.auditLogCount, contractorCount: b.contractorCount })}`);
  lines.push(`demo intact vs baseline: ${demoOk}`);
}
lines.push(`only demo remains: ${projects.length === 1 && nonDemo.length === 0}`);

fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa12-final-db-check.txt"), lines.join("\n") + "\n", "utf8");
console.log(lines.join("\n"));