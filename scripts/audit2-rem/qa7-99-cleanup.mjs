/**
 * QA7 final cleanup: delete every remaining AUDIT-QA7-* fixture and prove no
 * new orphan rows were introduced (delta vs fix4-qa7-00-recon baseline).
 * Evidence: evidence/fix4-qa7-99-cleanup.json
 */
import fs from "node:fs";
import path from "node:path";
import { client, call, writeEvidence, cliDump, EVIDENCE_DIR } from "./qa7-lib.mjs";

const c = client();
const out = { ranAt: new Date().toISOString(), deleted: [], remainingProjects: [], orphanDelta: {}, checks: [] };

const recon = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "fix4-qa7-00-recon.json"), "utf8"));
const baselineIds = {};
for (const [table, list] of Object.entries(recon.orphans)) {
  baselineIds[table] = new Set(list.map((r) => r.id));
}

const all = await c.query("projects:listProjects", {});
const fixtures = all.filter((p) => /^AUDIT-QA7-/.test(p.title));
for (const p of fixtures) {
  const res = await call(`delete ${p.title}`, () => c.mutation("projects:deleteProject", { projectId: p._id }));
  out.deleted.push({ title: p.title, id: p._id, result: res.ok ? "deleted" : res.data ?? res.message });
}
await new Promise((r) => setTimeout(r, 1500));

const TABLES = ["projects", "tradePackages", "contractors", "bids", "agreements", "conversations", "clashResolutions", "auditLogs", "projectFiles"];
const tables = {};
for (const t of TABLES) tables[t] = cliDump(t);
const rows = (t) => (Array.isArray(tables[t]) ? tables[t] : []);
const projectIds = new Set(rows("projects").map((r) => r._id));
const packageIds = new Set(rows("tradePackages").map((r) => r._id));

const currentOrphans = {
  projects: [],
  tradePackages: rows("tradePackages").filter((r) => !projectIds.has(r.projectId)).map((r) => ({ id: r._id, projectId: r.projectId, title: r.tradeName })),
  contractors: rows("contractors").filter((r) => !packageIds.has(r.tradePackageId)).map((r) => ({ id: r._id, packageId: r.tradePackageId, name: r.companyName })),
  bids: rows("bids").filter((r) => !packageIds.has(r.tradePackageId)).map((r) => ({ id: r._id, packageId: r.tradePackageId })),
  agreements: rows("agreements").filter((r) => !packageIds.has(r.tradePackageId) || !projectIds.has(r.projectId)).map((r) => ({ id: r._id })),
  conversations: rows("conversations").filter((r) => !packageIds.has(r.tradePackageId)).map((r) => ({ id: r._id })),
  clashResolutions: rows("clashResolutions").filter((r) => !projectIds.has(r.projectId)).map((r) => ({ id: r._id, projectId: r.projectId, clashId: r.clashId })),
  auditLogs: rows("auditLogs").filter((r) => !projectIds.has(r.projectId)).map((r) => ({ id: r._id, projectId: r.projectId, title: r.title })),
  projectFiles: rows("projectFiles").filter((r) => !projectIds.has(r.projectId)).map((r) => ({ id: r._id, projectId: r.projectId })),
};

const newOrphans = {};
for (const [table, list] of Object.entries(currentOrphans)) {
  const base = baselineIds[table] ?? new Set();
  newOrphans[table] = list.filter((r) => !base.has(r.id));
}
out.orphanDelta = {
  tableCounts: Object.fromEntries(Object.entries(currentOrphans).map(([k, v]) => [k, v.length])),
  newSinceBaseline: Object.fromEntries(Object.entries(newOrphans).map(([k, v]) => [k, v.length])),
  newRows: newOrphans,
};
out.remainingProjects = (await c.query("projects:listProjects", {})).filter((p) => /^AUDIT-QA7-/.test(p.title)).map((p) => p.title);

out.checks.push({
  label: "no AUDIT-QA7-* project remains",
  expected: "0",
  observed: `${out.remainingProjects.length}`,
  ok: out.remainingProjects.length === 0,
});
out.checks.push({
  label: "no new orphan rows vs pre-run baseline",
  expected: "0 new orphans",
  observed: JSON.stringify(out.orphanDelta.newSinceBaseline),
  ok: Object.values(newOrphans).every((l) => l.length === 0),
});
out.baselineNote =
  "Baseline orphans (clashResolutions=12, auditLogs=4) are legacy rows from projects deleted before the A3-07 fix; they are NOT part of the QA7 fixture and were deliberately not touched.";

writeEvidence("99-cleanup", out);
for (const k of out.checks) console.log(`${k.ok ? "PASS" : "FAIL"} ${k.label} :: ${k.observed}`);
console.log(`remainingProjects=${out.remainingProjects.length} newOrphans=${JSON.stringify(out.orphanDelta.newSinceBaseline)}`);