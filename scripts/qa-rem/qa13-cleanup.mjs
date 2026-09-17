// QA-13 targeted cleanup: deletes ONLY QA-REM-QA13-* fixtures (never the demo, never
// other agents' concurrent fixtures). Verifies demo integrity afterwards.
// Usage: node scripts/qa-rem/qa13-cleanup.mjs
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

const url = "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(url);
const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const LOG = [];
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};

async function fingerprint() {
  const projects = await client.query("projects:listProjects", {});
  const demo = projects.find((p) => p.isDemoProject);
  const out = {
    totalProjects: projects.length,
    titles: projects.map((p) => p.title),
    demo: null,
  };
  if (demo) {
    const pkgs = await client.query("tradePackages:listByProject", { projectId: demo._id });
    const bids = await client.query("bids:listAllProjectBids", { projectId: demo._id });
    const files = await client.query("files:listFilesByProject", { projectId: demo._id });
    const agrs = await client.query("agreements:listAgreements", { projectId: demo._id });
    let convCount = 0;
    for (const p of pkgs) {
      convCount += (await client.query("rfq:listConversations", { tradePackageId: p._id })).length;
    }
    out.demo = {
      id: demo._id,
      title: demo.title,
      packages: pkgs.length,
      bids: bids.length,
      files: files.length,
      agreements: agrs.length,
      conversations: convCount,
    };
  }
  return out;
}

const before = await fingerprint();
ev("=== QA-13 CLEANUP ===");
ev(`Before: ${JSON.stringify(before)}`);

const mine = before.titles.filter((t) => t.startsWith("QA-REM-QA13-"));
const projects = await client.query("projects:listProjects", {});
let deleted = 0;
for (const p of projects) {
  if (!p.title.startsWith("QA-REM-QA13-")) continue;
  try {
    await client.mutation("projects:deleteProject", { projectId: p._id });
    deleted += 1;
    ev(`deleted: ${p.title} (${p._id})`);
  } catch (err) {
    ev(`FAILED to delete ${p.title}: ${err && err.message ? err.message : err}`);
  }
}

const after = await fingerprint();
ev(`Deleted ${deleted}/${mine.length} QA-REM-QA13 fixtures.`);
ev(`After: ${JSON.stringify(after)}`);
const leftoverMine = after.titles.filter((t) => t.startsWith("QA-REM-QA13-"));
const demoIntact =
  after.demo &&
  after.demo.packages === 3 &&
  after.demo.bids === 6 &&
  after.demo.files === 8 &&
  after.demo.agreements === 1 &&
  after.demo.conversations === 5;
ev(`QA-REM-QA13 leftovers: ${JSON.stringify(leftoverMine)}`);
ev(`Demo intact (3 pkgs / 6 bids / 8 files / 1 agreement / 5 convs): ${demoIntact}`);
ev(`Remaining non-demo projects (NOT touched by QA-13): ${JSON.stringify(after.titles.filter((t) => t !== after.demo.title))}`);

const logPath = path.join(EVIDENCE_DIR, "remediation-qa13-cleanup.txt");
fs.writeFileSync(logPath, LOG.join("\n") + "\n", "utf8");
console.log(`Wrote ${logPath}`);
process.exitCode = deleted === mine.length && demoIntact ? 0 : 1;