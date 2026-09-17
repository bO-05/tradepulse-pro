import { ConvexHttpClient } from "convex/browser";

const url = process.argv[2] || "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(url);

const title = `QA-REM-R4-clash-${Date.now()}`;
const projectId = await client.mutation("projects:createProject", {
  title,
  location: "Austin, TX",
  projectType: "QA Clash Guard",
  estBudget: 2000000,
  targetCompletionWeeks: 30,
  specDocumentText: "Clash guard verification project with no packages.",
  isDemoProject: false,
});

const empty = await client.query("coordination:detectCrossTradeClashes", { projectId });
console.log(`empty project clashes: doubleBuys=${empty.doubleBuys.length} scopeVoids=${empty.scopeVoids.length} redundant=$${empty.totalRedundantAmount} void=$${empty.totalVoidExposure}`);
const emptyOk = empty.doubleBuys.length === 0 && empty.scopeVoids.length === 0;

const projects = await client.query("projects:listProjects", {});
const demo = projects.find((p) => p.isDemoProject);
const demoClashes = await client.query("coordination:detectCrossTradeClashes", { projectId: demo._id });
console.log(`demo project clashes: doubleBuys=${demoClashes.doubleBuys.length} scopeVoids=${demoClashes.scopeVoids.length}`);
const demoOk = demoClashes.doubleBuys.length > 0;

console.log(`CLASH GUARD: ${emptyOk && demoOk ? "PASS" : "FAIL"}`);
process.exitCode = emptyOk && demoOk ? 0 : 1;