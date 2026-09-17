import { ConvexHttpClient } from "convex/browser";

const url = process.argv[2] || "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(url);
const projects = await client.query("projects:listProjects", {});

const demo = projects.find((p) => p.isDemoProject);
const f5 = projects.find((p) => p.title.includes("Temporary Audit"));
const newestQa = projects.find((p) => p.title.startsWith("QA-REM-"));

for (const [label, p] of [["DEMO", demo], ["F5_EXECUTED", f5], ["NEWEST_QA_REM", newestQa]]) {
  if (!p) { console.log(`${label}: NOT FOUND`); continue; }
  console.log(`\n=== ${label}: ${p.title} (${p._id}) demo=${p.isDemoProject}`);
  const pkgs = await client.query("tradePackages:listByProject", { projectId: p._id });
  for (const k of pkgs) {
    const bids = await client.query("bids:listByPackage", { tradePackageId: k._id });
    const ags = await client.query("agreements:listAgreements", { projectId: p._id });
    console.log(`  PKG ${k.csiDivision} | ${k.tradeName} | status=${k.status} | bids=${bids.length}`);
    for (const b of bids) {
      const ag = ags.find((a) => a.bidId === b._id && a.status !== "superseded");
      console.log(`     BID ${b.subcontractorName} | awarded=${b.isAwarded} | agreement=${ag ? ag.status : "none"}`);
    }
  }
}

console.log("\nALL QA-REM TITLES:");
for (const p of projects) console.log(`  ${p.title} | ${p._id}`);