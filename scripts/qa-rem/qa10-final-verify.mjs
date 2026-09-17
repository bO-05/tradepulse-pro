// QA-10 pre/post cleanup verification.
//   pre  : snapshot demo integrity + per-QA-REM project record counts
//   post : prove delete cascade (0 rows for fixture ids), selector clean, demo untouched
// Usage: node scripts/qa-rem/qa10-final-verify.mjs pre|post
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

const MODE = process.argv[2] || "post";
const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const client = new ConvexHttpClient(BACKEND);
const fixture = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa10-fixture.json"), "utf8"));
const LOG = [];
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};

async function projectRecordCounts(projectId) {
  const packages = await client.query("tradePackages:listByProject", { projectId });
  let contractors = 0;
  let bids = 0;
  let conversations = 0;
  for (const p of packages) {
    contractors += (await client.query("contractors:listByPackage", { tradePackageId: p._id })).length;
    bids += (await client.query("bids:listByPackage", { tradePackageId: p._id })).length;
    conversations += (await client.query("rfq:listConversations", { tradePackageId: p._id })).length;
  }
  const agreements = await client.query("agreements:listAgreements", { projectId });
  const logs = await client.query("auditLogs:listRecentLogs", { projectId, limit: 1000 });
  return { packages: packages.length, contractors, bids, conversations, agreements: agreements.length, auditLogs: logs.length };
}

async function demoSnapshot() {
  const demo = await client.query("projects:getDemoProject", {});
  const recs = await projectRecordCounts(demo._id);
  return { id: demo._id, title: demo.title, estBudget: demo.estBudget, isDemoProject: demo.isDemoProject, ...recs };
}

async function run() {
  ev(`=== QA-10 ${MODE.toUpperCase()}-CLEANUP VERIFICATION ===`);
  ev(`UTC: ${new Date().toISOString()}`);
  const demo = await demoSnapshot();
  ev(`demo: ${JSON.stringify(demo)}`);
  const projects = await client.query("projects:listProjects", {});
  ev(`projects (${projects.length}): ${projects.map((p) => `${p.title}${p.isDemoProject ? " [DEMO]" : ""}`).join(" | ")}`);

  if (MODE === "pre") {
    const perProject = {};
    for (const p of projects.filter((x) => x.title.startsWith("QA-REM"))) {
      perProject[p.title] = await projectRecordCounts(p._id);
    }
    const out = { at: new Date().toISOString(), demo, projects: projects.map((p) => ({ title: p.title, id: p._id, demo: p.isDemoProject })), perProject };
    fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa10-pre-cleanup.json"), JSON.stringify(out, null, 2), "utf8");
  } else {
    const fixtureCounts = {
      ui: await projectRecordCounts(fixture.projectId),
      empty: await projectRecordCounts(fixture.emptyProjectId),
    };
    ev(`fixture cascade after cleanup: ui=${JSON.stringify(fixtureCounts.ui)} empty=${JSON.stringify(fixtureCounts.empty)}`);
    const leftoverQa = projects.filter((p) => p.title.startsWith("QA-REM") || p.title.startsWith("Pass2") || p.title.startsWith("Production Audit Temporary") || p.title === "QA Test Tower - Temporary Audit");
    ev(`leftover QA-REM/temp projects: ${leftoverQa.length} ${leftoverQa.map((p) => p.title).join(", ")}`);
    const baseline = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa10-backend-invariants.json"), "utf8"));
    const demoBaseline = baseline.steps.find((s) => s.name === "demo_before");
    const demoUnchanged =
      demo.title === demoBaseline.title &&
      demo.estBudget === demoBaseline.estBudget &&
      demo.packages === demoBaseline.packageCount &&
      demo.bids === demoBaseline.bidCount &&
      demo.agreements === demoBaseline.agreementCount &&
      demo.auditLogs === demoBaseline.auditLogCount;
    ev(`demo unchanged vs QA-10 baseline: ${demoUnchanged} (expected title="${demoBaseline.title}" budget=${demoBaseline.estBudget} packages=${demoBaseline.packageCount} bids=${demoBaseline.bidCount} agreements=${demoBaseline.agreementCount} logs=${demoBaseline.auditLogCount})`);
    const cascadeOk = Object.values(fixtureCounts).every((c) => c.packages === 0 && c.bids === 0 && c.contractors === 0 && c.conversations === 0 && c.agreements === 0 && c.auditLogs === 0);
    ev(`cascade clean: ${cascadeOk}`);
    const out = { at: new Date().toISOString(), demo, projects: projects.map((p) => ({ title: p.title, id: p._id, demo: p.isDemoProject })), fixtureCounts, leftoverQa: leftoverQa.map((p) => p.title), demoUnchanged, cascadeOk, overall: cascadeOk && demoUnchanged && leftoverQa.length === 0 ? "PASS" : "FAIL" };
    fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa10-final-verify.json"), JSON.stringify(out, null, 2), "utf8");
    ev(`OVERALL: ${out.overall}`);
  }
  fs.writeFileSync(path.join(EVIDENCE_DIR, `remediation-qa10-${MODE}-cleanup.txt`), LOG.join("\n") + "\n", "utf8");
  console.log(`Wrote remediation-qa10-${MODE}-cleanup.txt`);
}

run().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});