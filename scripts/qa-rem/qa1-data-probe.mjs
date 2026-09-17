import { ConvexHttpClient } from "convex/browser";

const url = process.argv[2] || "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(url);

console.log("DEPLOYMENT:", url);
const projects = await client.query("projects:listProjects", {});
console.log(`PROJECT COUNT: ${projects.length}`);
for (const p of projects) {
  console.log(`\nPROJECT: ${p.title} | demo=${p.isDemoProject} | _id=${p._id} | location=${p.location}`);
  let pkgCount = 0;
  let bids = [];
  try {
    const pkgs = await client.query("tradePackages:listByProject", { projectId: p._id });
    pkgCount = pkgs.length;
    for (const k of pkgs) {
      console.log(`    pkg ${k.csiDivision} | ${k.tradeName} | status=${k.status} | _id=${k._id}`);
    }
    bids = await client.query("bids:listAllProjectBids", { projectId: p._id });
    console.log(`  packages=${pkgs.length} bids=${bids.length}`);
  } catch (e) {
    console.log(`  package/bid query error: ${e.message}`);
  }
  try {
    const ags = await client.query("agreements:listAgreements", { projectId: p._id });
    console.log(`  agreements=${ags.length}`);
    for (const a of ags) {
      const bid = bids.find((b) => b._id === a.bidId);
      console.log(
        `    - ${a.agreementNumber} | status=${a.status} | sub=${a.subcontractorName} | bidId=${a.bidId} | awarded=${bid ? bid.isAwarded : "n/a"} | subs=${bid ? bid.subcontractorName : "n/a"}`
      );
    }
  } catch (e) {
    console.log(`  agreements query error: ${e.message}`);
  }
}