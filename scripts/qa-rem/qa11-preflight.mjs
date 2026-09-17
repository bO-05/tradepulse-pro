// QA-11 preflight: confirm DB contains only the demo project; snapshot demo integrity fields.
// Usage: node scripts/qa-rem/qa11-preflight.mjs
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const client = new ConvexHttpClient(BACKEND);
const log = [];
const say = (s) => { console.log(s); log.push(s); };

async function snapshot(projectId) {
  const pkgs = await client.query("tradePackages:listByProject", { projectId });
  const project = (await client.query("projects:listProjects", {})).find((p) => p._id === projectId);
  const bids = await client.query("bids:listByProject", { projectId }).catch(() => []);
  return { project, pkgs, bids };
}

say(`QA-11 PREFLIGHT ${new Date().toISOString()}`);
say(`backend: ${BACKEND}`);
const projects = await client.query("projects:listProjects", {});
say(`project count: ${projects.length}`);
for (const p of projects) {
  say(`- ${p._id} "${p.title}" demo=${p.isDemoProject} estBudget=${p.estBudget} location=${p.location}`);
}
const demo = projects.find((p) => p.isDemoProject);
if (!demo) throw new Error("NO DEMO PROJECT FOUND");
const demoSnap = await snapshot(demo._id);
say(`demo title="${demoSnap.project.title}"`);
say(`demo packages: ${demoSnap.pkgs.length} [${demoSnap.pkgs.map((p) => p.tradeName).join(" | ")}]`);
say(`demo bids: ${demoSnap.bids.length}`);

const out = {
  at: new Date().toISOString(),
  backend: BACKEND,
  projectCount: projects.length,
  projects: projects.map((p) => ({ id: p._id, title: p.title, isDemoProject: p.isDemoProject })),
  demo: {
    id: demo._id,
    title: demo.title,
    isDemoProject: demo.isDemoProject,
    estBudget: demo.estBudget,
    location: demo.location,
    packageCount: demoSnap.pkgs.length,
    packages: demoSnap.pkgs.map((p) => ({ id: p._id, csiDivision: p.csiDivision, tradeName: p.tradeName })),
    bidCount: demoSnap.bids.length,
  },
};
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa11-preflight.json"), JSON.stringify(out, null, 2), "utf8");
fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa11-preflight.txt"), log.join("\n") + "\n", "utf8");
console.log("wrote remediation-qa11-preflight.json/.txt");
process.exitCode = projects.length === 1 && projects[0].isDemoProject ? 0 : 1;