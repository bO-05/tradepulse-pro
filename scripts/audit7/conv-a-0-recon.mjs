/**
 * AUDIT7 CONV-A (audit-6 remediation convergence round 1) — recon.
 * Read-only: lists live projects and any leftover AUDIT7 fixtures.
 */
import { q, writeEvidence } from "./lib.mjs";

const projects = (await q("projects:listProjects", {})) || [];
const out = {
  startedAt: new Date().toISOString(),
  projects: projects.map((p) => ({
    _id: p._id,
    title: p.title,
    gc: p.generalContractorName,
    budget: p.estBudget,
    isDemoProject: p.isDemoProject ?? null,
    createdAt: p.createdAt,
  })),
};
await writeEvidence("a7conv-a-recon.json", out);
console.log(JSON.stringify(out, null, 2));