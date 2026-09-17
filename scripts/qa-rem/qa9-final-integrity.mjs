import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const url = "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(url);

const log = [];
const say = (s) => {
  console.log(s);
  log.push(s);
};

say(`QA9 FINAL DEMO INTEGRITY CHECK at ${new Date().toISOString()}`);
const projects = await client.query("projects:listProjects", {});
say(`projects remaining: ${projects.length}`);
for (const p of projects) say(`  - ${p.title} | demo=${p.isDemoProject} | id=${p._id}`);

const demo = projects.find((p) => p.isDemoProject);
if (!demo) throw new Error("demo missing");

const pkgs = await client.query("tradePackages:listByProject", { projectId: demo._id });
const files = await client.query("files:listFilesByProject", { projectId: demo._id });
const agreements = await client.query("agreements:listAgreements", { projectId: demo._id });
say(`\ndemo "${demo.title}": packages=${pkgs.length} files=${files.length} agreements=${agreements.length}`);

let bidsTotal = 0;
let convosTotal = 0;
for (const p of pkgs) {
  const bids = await client.query("bids:listByPackage", { tradePackageId: p._id });
  const convos = await client.query("rfq:listConversations", { tradePackageId: p._id });
  bidsTotal += bids.length;
  convosTotal += convos.length;
  say(`  pkg ${p.csiDivision} ${p.tradeName}: status=${p.status} bids=${bids.length} convos=${convos.length}`);
}
say(`demo bids total=${bidsTotal} conversations total=${convosTotal}`);

const clashes = await client.query("coordination:detectCrossTradeClashes", { projectId: demo._id });
say(
  `demo clashes: doubleBuys=${clashes.doubleBuys.length} scopeVoids=${clashes.scopeVoids.length} redundant=$${clashes.summary.totalDoubleBuyExposure} void=$${clashes.summary.totalScopeVoidExposure}`
);

const qa9Left = projects.filter((p) => p.title.startsWith("QA-REM-QA9-"));
say(`QA-REM-QA9-* residue: ${qa9Left.length}`);

const pass =
  demo.title === "The Domain Tower B - Commercial MEP" &&
  pkgs.length === 3 &&
  bidsTotal === 6 &&
  agreements.length === 1 &&
  files.length === 8 &&
  clashes.doubleBuys.length === 2 &&
  clashes.scopeVoids.length === 2 &&
  clashes.summary.totalDoubleBuyExposure === 50500 &&
  clashes.summary.totalScopeVoidExposure === 46500 &&
  qa9Left.length === 0;
say(`\nFINAL INTEGRITY: ${pass ? "PASS" : "FAIL"}`);

fs.writeFileSync(
  path.join(EVIDENCE_DIR, "remediation-qa9-07-final-integrity.txt"),
  log.join("\n") + "\n",
  "utf8"
);
process.exitCode = pass ? 0 : 1;