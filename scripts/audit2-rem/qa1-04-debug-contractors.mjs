import { ConvexHttpClient } from "convex/browser";
import { writeJson } from "./lib.mjs";

const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const projects = await http.query("projects:listProjects", {});
const proj = projects.find((p) => p.title === "AUDIT-QA1-BIDS-2026-09-18");
const pkgs = await http.query("tradePackages:listByProject", { projectId: proj._id });
const pkg = pkgs.find((p) => p.tradeName === "AUDIT-QA1 Electrical");
const cs = await http.query("contractors:listByPackage", { tradePackageId: pkg._id });
const bids = await http.query("bids:listAllProjectBids", { projectId: proj._id });
const out = {
  packageId: pkg._id,
  contractors: cs.map((c) => ({ id: c._id, name: c.companyName, email: c.contactEmail, status: c.rfqStatus })),
  bids: bids.map((b) => ({ id: b._id, sub: b.subcontractorName, contractorId: b.contractorId, base: b.baseBidAmount, rev: b.revisionNumber, src: b.sourceFileId || null })),
};
writeJson("fix4-qa1-contractors-debug.json", out);
console.log(JSON.stringify(out, null, 2));