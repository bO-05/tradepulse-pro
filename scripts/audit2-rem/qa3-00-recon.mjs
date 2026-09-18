import { ConvexHttpClient } from "convex/browser";
import { writeJson } from "./lib.mjs";

const c = new ConvexHttpClient(process.env.REM_CONVEX_URL || "https://brainy-skunk-440.convex.cloud");

const run = async () => {
  const out = { fetchedAt: new Date().toISOString(), url: c.address || "brainy-skunk-440.convex.cloud" };
  const projects = await c.query("projects:listProjects", {});
  out.projects = projects.map((p) => ({ id: p._id, title: p.title, isDemo: p.isDemoProject, estBudget: p.estBudget, location: p.location }));
  out.byProject = {};
  for (const p of projects) {
    const rec = { title: p.title };
    rec.packages = await c.query("tradePackages:listByProject", { projectId: p._id });
    rec.contractors = await c.query("contractors:listByProject", { projectId: p._id });
    rec.bids = await c.query("bids:listAllProjectBids", { projectId: p._id });
    rec.agreements = await c.query("agreements:listAgreements", { projectId: p._id });
    rec.files = await c.query("files:listFilesByProject", { projectId: p._id });
    rec.logs = await c.query("auditLogs:listRecentLogs", { projectId: p._id, limit: 50 });
    out.byProject[p._id] = rec;
  }
  const latestEval = await c.query("evals:getLatestEvalRun", {}).catch((e) => ({ error: String(e.message) }));
  out.latestEval = latestEval;
  const cronStatus = await c.query("crons:getCronStatus", {}).catch((e) => ({ error: String(e.message) }));
  out.cronStatus = cronStatus;
  const file = writeJson("fix4-qa3-00-recon.json", out);
  console.log("evidence:", file);
  console.log("projects:", projects.map((p) => `${p._id} | ${p.title} | demo=${p.isDemoProject}`).join("\n"));
  for (const [id, rec] of Object.entries(out.byProject)) {
    console.log(`\n${id} ${rec.title}`);
    console.log(`  packages=${rec.packages.length} contractors=${rec.contractors.length} bids=${rec.bids.length} agreements=${rec.agreements.length} files=${rec.files.length} logs=${rec.logs.length}`);
    console.log("  pkg:", rec.packages.map((x) => `${x._id}|${x.csiDivision}|${x.tradeName}|budget=${x.budgetEstimate}|${x.status}`).join(" ;; "));
  }
};

run().catch((e) => { console.error("ERR", e && e.stack ? e.stack : e); process.exit(1); });