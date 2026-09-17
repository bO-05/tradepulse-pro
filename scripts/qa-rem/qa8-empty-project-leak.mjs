// QA-8: empty QA-REM project vs demo — detectCrossTradeClashes equality probe (read-only).
// Usage: node scripts/qa-rem/qa8-empty-project-leak.mjs
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

const BACKEND = "https://brainy-skunk-440.convex.cloud";
const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const client = new ConvexHttpClient(BACKEND);

const fixture = JSON.parse(
  fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa8-fixture.json"), "utf8")
);
const QA = fixture.qaProjectId;
const lines = [];
const log = (s) => {
  lines.push(s);
  console.log(s);
};
const J = (o, max = 1500) => {
  const s = JSON.stringify(o);
  return s.length > max ? s.slice(0, max) + `…(truncated ${s.length} chars)` : s;
};

log("=== QA-8 EMPTY-PROJECT DATA PROBE (read-only) ===");
log(`UTC: ${new Date().toISOString()}`);
log(`QA empty project: ${QA} "${fixture.qaProjectTitle}"`);
log("");

const projects = await client.query("projects:listProjects");
const demo = projects.find((p) => p.isDemoProject);
log(`demo project: ${demo._id} "${demo.title}"`);
log("");

const qaPkgs = await client.query("tradePackages:listByProject", { projectId: QA });
const demoPkgs = await client.query("tradePackages:listByProject", { projectId: demo._id });
const qaBids = await client.query("bids:listAllProjectBids", { projectId: QA });
const qaFiles = await client.query("files:listFilesByProject", { projectId: QA });
const qaAgr = await client.query("agreements:listAgreements", { projectId: QA });
log(`QA project own data: packages=${qaPkgs.length} bids=${qaBids.length} files=${qaFiles.length} agreements=${qaAgr.length}`);
log(`demo project data: packages=${demoPkgs.length}`);
log("");

const qaClashes = await client.query("coordination:detectCrossTradeClashes", { projectId: QA });
const demoClashes = await client.query("coordination:detectCrossTradeClashes", { projectId: demo._id });

const qaDouble = qaClashes.doubleBuys || [];
const demDouble = demoClashes.doubleBuys || [];
const qaVoids = qaClashes.scopeVoids || [];
const demVoids = demoClashes.scopeVoids || [];

log("--- detectCrossTradeClashes(QA empty project) ---");
log(`counts: doubleBuys=${qaDouble.length} scopeVoids=${qaVoids.length}`);
log(`ids: doubleBuys=[${qaDouble.map((d) => d.id).join(", ")}] scopeVoids=[${qaVoids.map((v) => v.id).join(", ")}]`);
log(`payload: ${J(qaClashes, 2500)}`);
log("");
log("--- detectCrossTradeClashes(demo) ---");
log(`counts: doubleBuys=${demDouble.length} scopeVoids=${demVoids.length}`);
log(`ids: doubleBuys=[${demDouble.map((d) => d.id).join(", ")}] scopeVoids=[${demVoids.map((v) => v.id).join(", ")}]`);
log("");
const identical = JSON.stringify(qaClashes) === JSON.stringify(demoClashes);
log(`IDENTICAL payload for empty project vs demo: ${identical}`);
log("");

const qaIds = new Set([...qaDouble, ...qaVoids].map((c) => c.id));
const demIds = new Set([...demDouble, ...demVoids].map((c) => c.id));
const shared = [...qaIds].filter((i) => demIds.has(i));
log(`shared clash ids between empty QA project and demo: ${shared.length} [${shared.join(", ")}]`);
log("");

const refFields = ["clash-vfd-01"];
for (const c of [...qaDouble, ...qaVoids]) {
  const refs = Object.entries(c).filter(([k, v]) => /pkg|package|project/i.test(k) && typeof v === "string");
  if (refs.length) log(`clash ${c.id} id-like fields: ${J(Object.fromEntries(refs))}`);
}
log("");
log("NOTE: The empty QA-REM project has 0 packages/bids/files/agreements in Convex,");
log("      yet the header badge shows clashes and the Scope Clash view renders this payload.");

fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa8-empty-project-leak.txt"), lines.join("\n") + "\n", "utf8");
console.log(`Wrote ${path.join(EVIDENCE_DIR, "remediation-qa8-empty-project-leak.txt")}`);