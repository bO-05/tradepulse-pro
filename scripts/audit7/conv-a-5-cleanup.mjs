/**
 * AUDIT7 CONV-A round 1 — Step 7: delete every AUDIT7-CONV-A-* fixture and confirm the
 * Projects list afterwards contains only the demo project.
 */
import { q, writeEvidence, deleteProject, PREFIX } from "./lib.mjs";

const out = { startedAt: new Date().toISOString(), deleted: [], remaining: [], demoUntouched: null };

for (const p of ((await q("projects:listProjects", {})) || []).filter((x) => x.title.startsWith(`${PREFIX}CONV-A-`))) {
  const ok = await deleteProject(p._id);
  out.deleted.push({ _id: p._id, title: p.title, deleted: ok });
}

const remaining = (await q("projects:listProjects", {})) || [];
out.remaining = remaining.map((p) => ({ _id: p._id, title: p.title, isDemoProject: p.isDemoProject ?? null }));
out.assertions = {
  allFixturesDeleted: out.deleted.length > 0 && out.deleted.every((d) => d.deleted),
  onlyDemoRemains: remaining.length === 1 && /The Domain Tower B/.test(remaining[0].title),
};
// demo integrity (never touched): count surfaced items
const demo = remaining.find((p) => /The Domain Tower B/.test(p.title));
if (demo) {
  const [pkgs, bids, agrs] = await Promise.all([
    q("tradePackages:listByProject", { projectId: demo._id }),
    q("bids:listAllProjectBids", { projectId: demo._id }),
    q("agreements:listAgreements", { projectId: demo._id }),
  ]);
  out.demoUntouched = {
    packages: (pkgs || []).length,
    bids: (bids || []).length,
    agreements: (agrs || []).length,
  };
}
await writeEvidence("a7conv-a-cleanup.json", out);
console.log(JSON.stringify(out, null, 2));