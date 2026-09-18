/**
 * QA7 recon (read-only): current live prod state, orphan scan across every table.
 * Evidence: evidence/fix4-qa7-00-recon.json
 */
import { client, cliDump, writeEvidence } from "./qa7-lib.mjs";

const c = client();

const TABLES = [
  "projects",
  "tradePackages",
  "contractors",
  "bids",
  "agreements",
  "conversations",
  "clashResolutions",
  "auditLogs",
  "projectFiles",
];

const projects = await c.query("projects:listProjects", {});
const projectIds = new Set(projects.map((p) => p._id));

const tables = {};
for (const t of TABLES) {
  try {
    tables[t] = cliDump(t);
  } catch (e) {
    tables[t] = { error: String(e.message || e) };
  }
}

const rows = (t) => (Array.isArray(tables[t]) ? tables[t] : []);
const packageIds = new Set(rows("tradePackages").map((r) => r._id));

const orphans = {
  projects: [],
  tradePackages: rows("tradePackages").filter((r) => !projectIds.has(r.projectId)).map((r) => ({ id: r._id, projectId: r.projectId, title: r.tradeName })),
  contractors: rows("contractors").filter((r) => !packageIds.has(r.tradePackageId)).map((r) => ({ id: r._id, packageId: r.tradePackageId, name: r.companyName })),
  bids: rows("bids").filter((r) => !packageIds.has(r.tradePackageId)).map((r) => ({ id: r._id, packageId: r.tradePackageId })),
  agreements: rows("agreements").filter((r) => !packageIds.has(r.tradePackageId) || !projectIds.has(r.projectId)).map((r) => ({ id: r._id, packageId: r.tradePackageId, projectId: r.projectId, status: r.status })),
  conversations: rows("conversations").filter((r) => !packageIds.has(r.tradePackageId)).map((r) => ({ id: r._id, packageId: r.tradePackageId })),
  clashResolutions: rows("clashResolutions").filter((r) => !projectIds.has(r.projectId)).map((r) => ({ id: r._id, projectId: r.projectId, clashId: r.clashId, amount: r.amount })),
  auditLogs: rows("auditLogs").filter((r) => !projectIds.has(r.projectId)).map((r) => ({ id: r._id, projectId: r.projectId, title: r.title })),
  projectFiles: rows("projectFiles").filter((r) => !projectIds.has(r.projectId)).map((r) => ({ id: r._id, projectId: r.projectId, fileName: r.fileName })),
};

const perProject = [];
for (const p of projects) {
  const packages = await c.query("tradePackages:listByProject", { projectId: p._id });
  const bids = await c.query("bids:listAllProjectBids", { projectId: p._id });
  const agreements = await c.query("agreements:listAgreements", { projectId: p._id });
  const contractors = await c.query("contractors:listByProject", { projectId: p._id });
  perProject.push({
    id: p._id,
    title: p.title,
    isDemoProject: p.isDemoProject,
    estBudget: p.estBudget,
    packages: packages.length,
    contractors: contractors.length,
    bids: bids.length,
    agreements: agreements.length,
    packageStatuses: packages.map((x) => `${x.csiDivision}:${x.status}${x.tradeName ? "" : ""}`),
  });
}

const out = {
  fetchedAt: new Date().toISOString(),
  deployment: "brainy-skunk-440 (prod)",
  projectCount: projects.length,
  tableCounts: Object.fromEntries(TABLES.map((t) => [t, Array.isArray(tables[t]) ? tables[t].length : tables[t]])),
  projects: perProject,
  orphans,
  orphanTotal: Object.values(orphans).reduce((n, list) => n + list.length, 0),
};

writeEvidence("00-recon", out);
console.log(`projects=${projects.length} orphanTotal=${out.orphanTotal}`);
for (const [k, list] of Object.entries(orphans)) {
  if (list.length) console.log(`ORPHANS ${k}: ${JSON.stringify(list)}`);
}
for (const p of perProject) {
  console.log(`${p.isDemoProject ? "DEMO" : "    "} ${p.title} | pkgs=${p.packages} bids=${p.bids} agrs=${p.agreements}`);
}