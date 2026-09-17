import { ConvexHttpClient } from "convex/browser";
import { writeLog } from "./qa1-lib.mjs";

const url = process.argv[2] || "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(url);
const log = [];
const say = (s) => {
  console.log(s);
  log.push(s);
};

say(`QA7 PREFLIGHT (read-only) at ${new Date().toISOString()}`);
say(`deployment: ${url}`);

const projects = await client.query("projects:listProjects", {});
say(`projects count: ${projects.length}`);
const demo = projects.filter((p) => p.isDemoProject);
say(`demo projects: ${demo.map((p) => `${p.title} [${p._id}]`).join(" | ") || "(none)"}`);

for (const p of projects) {
  say(`- ${p.title} (demo=${Boolean(p.isDemoProject)}) id=${p._id}`);
  const pkgs = await client.query("tradePackages:listByProject", { projectId: p._id });
  say(`    packages: ${pkgs.length}`);
  for (const pk of pkgs) {
    const contractors = await client.query("contractors:listByPackage", { tradePackageId: pk._id });
    const bids = await client.query("bids:listByPackage", { tradePackageId: pk._id });
    const convos = await client.query("rfq:listConversations", { tradePackageId: pk._id });
    say(
      `      - ${pk.csiDivision} ${pk.tradeName} id=${pk._id} contractors=${contractors.length} bids=${bids.length} convos=${convos.length} status=${pk.status}`
    );
    say(`        contractors: ${contractors.map((c) => `${c.companyName}[${c._id}]`).join(", ") || "(none)"}`);
    say(
      `        bids: ${bids.map((b) => `${b.subcontractorName}$=${b.baseBidAmount}${b.isAwarded ? " AWARDED" : ""}[${b._id}]`).join(", ") || "(none)"}`
    );
    say(
      `        convos: ${convos.map((c) => `${c.status}:${(c.inboundSubject || "").slice(0, 60)}[${c._id}]`).join(", ") || "(none)"}`
    );
  }
}

const nonDemo = projects.filter((p) => !p.isDemoProject);
say(`NON-DEMO PROJECTS: ${nonDemo.length} (${nonDemo.map((p) => p.title).join(", ") || "none"})`);
const clean = nonDemo.length === 0;
say(`CLEANUP-STATE CHECK: ${clean ? "PASS (only demo project present)" : "NOTE (fixtures present)"}`);

const p = writeLog("remediation-qa7-00-preflight.txt", log);
console.log(`LOG: ${p}`);