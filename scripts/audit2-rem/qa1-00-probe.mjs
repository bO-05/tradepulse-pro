import { ConvexHttpClient } from "convex/browser";
import { writeJson } from "./lib.mjs";

const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const out = { at: new Date().toISOString() };
const projects = await http.query("projects:listProjects", {});
out.projects = projects.map((p) => ({
  id: p._id,
  title: p.title,
  demo: p.isDemoProject,
  budget: p.estBudget,
}));
const demo = projects.find((p) => p.isDemoProject);
if (demo) {
  out.demoPackages = (await http.query("tradePackages:listByProject", { projectId: demo._id })).map((p) => ({
    id: p._id,
    csi: p.csiDivision,
    name: p.tradeName,
    budget: p.budgetEstimate,
    status: p.status,
  }));
  out.demoBids = (await http.query("bids:listAllProjectBids", { projectId: demo._id })).map((b) => ({
    id: b._id,
    csi: b.csiDivision,
    sub: b.subcontractorName,
    base: b.baseBidAmount,
    leveled: b.leveledTotalCost,
    awarded: b.isAwarded,
    rev: b.revisionNumber,
  }));
  out.demoAgreements = (await http.query("agreements:listAgreements", { projectId: demo._id })).map((a) => ({
    id: a._id,
    num: a.agreementNumber,
    status: a.status,
    sum: a.contractSum,
    pkg: a.tradePackageId,
    bid: a.bidId,
    sub: a.subcontractorName,
  }));
}
for (const p of projects.filter((x) => !x.isDemoProject)) {
  try {
    out[`pkg_${p.title}`] = (await http.query("tradePackages:listByProject", { projectId: p._id })).map((x) => ({
      id: x._id,
      csi: x.csiDivision,
      name: x.tradeName,
      status: x.status,
      budget: x.budgetEstimate,
    }));
    out[`bids_${p.title}`] = (await http.query("bids:listAllProjectBids", { projectId: p._id })).map((b) => ({
      id: b._id,
      sub: b.subcontractorName,
      base: b.baseBidAmount,
      leveled: b.leveledTotalCost,
      awarded: b.isAwarded,
      rev: b.revisionNumber,
    }));
    out[`agr_${p.title}`] = (await http.query("agreements:listAgreements", { projectId: p._id })).map((a) => ({
      num: a.agreementNumber,
      status: a.status,
      sum: a.contractSum,
      bid: a.bidId,
    }));
  } catch (e) {
    out[`err_${p.title}`] = String(e);
  }
}
writeJson("fix4-qa1-probe.json", out);
console.log(JSON.stringify(out, null, 2).slice(0, 12000));