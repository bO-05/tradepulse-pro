import { ConvexHttpClient } from "convex/browser";
import { writeJson, writeLog } from "./lib.mjs";
import fs from "node:fs";

const c = new ConvexHttpClient(process.env.REM_CONVEX_URL || "https://brainy-skunk-440.convex.cloud");
const DEMO = "The Domain Tower B - Commercial MEP";

async function call(fn, args) {
  try { return { threw: false, value: await c.mutation(fn, args) }; }
  catch (e) { return { threw: true, data: e && e.data !== undefined ? e.data : null, message: e && e.message ? e.message : String(e) }; }
}
async function query(fn, args) {
  try { return { threw: false, value: await c.query(fn, args) }; }
  catch (e) { return { threw: true, data: e && e.data !== undefined ? e.data : null, message: e && e.message ? e.message : String(e) }; }
}
const errText = (r) => (r.data && typeof r.data === "string" ? r.data : r.data ? JSON.stringify(r.data) : r.message);

const snapshotDemo = async () => {
  const projects = (await query("projects:listProjects", {})).value;
  const demo = projects.find((p) => p.title === DEMO);
  return {
    project: { id: demo._id, estBudget: demo.estBudget, title: demo.title },
    packages: (await query("tradePackages:listByProject", { projectId: demo._id })).value.map((p) => ({ id: p._id, csi: p.csiDivision, status: p.status, budget: p.budgetEstimate })),
    bids: (await query("bids:listAllProjectBids", { projectId: demo._id })).value.map((b) => ({ id: b._id, base: b.baseBidAmount, leveled: b.leveledTotalCost, awarded: b.isAwarded })),
    agreements: (await query("agreements:listAgreements", { projectId: demo._id })).value.map((a) => ({ id: a._id, status: a.status, sum: a.contractSum })),
    contractors: (await query("contractors:listByProject", { projectId: demo._id })).value.map((x) => ({ id: x._id, name: x.companyName, rfq: x.rfqStatus })),
    files: (await query("files:listFilesByProject", { projectId: demo._id })).value.map((f) => ({ id: f._id, name: f.fileName })),
  };
};

const run = async () => {
  const out = { startedAt: new Date().toISOString(), cleanup: [], beforeDemo: null, afterDemo: null };
  const beforeProjects = (await query("projects:listProjects", {})).value;
  out.projectsBefore = beforeProjects.map((p) => ({ id: p._id, title: p.title }));
  out.beforeDemo = await snapshotDemo();

  // 1. Verify the V24 orphan package is gone
  const orphan = await query("tradePackages:getPackage", { tradePackageId: "k17bjk1zb52c1eq473zz7yg5tn8emqfv" });
  out.orphanPackageStillExists = orphan.threw ? "query-error" : orphan.value !== null;
  if (!orphan.threw && orphan.value !== null) {
    const del = await call("tradePackages:deleteTradePackage", { tradePackageId: "k17bjk1zb52c1eq473zz7yg5tn8emqfv" });
    out.cleanup.push({ kind: "orphan-package", result: del.threw ? errText(del) : del.value });
  }

  // 2. Delete every AUDIT-QA3-* project (and cascaded children)
  const projects = (await query("projects:listProjects", {})).value;
  for (const p of projects) {
    if (p.title.startsWith("AUDIT-QA3")) {
      const del = await call("projects:deleteProject", { projectId: p._id });
      out.cleanup.push({ kind: "project", id: p._id, title: p.title, result: del.threw ? errText(del) : del.value });
    }
  }

  // 3. Final project list verification
  const after = (await query("projects:listProjects", {})).value;
  out.projectsAfter = after.map((p) => ({ id: p._id, title: p.title }));
  out.onlyExpectedRemain = after.every(
    (p) => p.isDemoProject || p.title.startsWith("AUDIT-5-") || p.title.startsWith("GC-AUDIT")
  );
  out.noQa3Remain = after.every((p) => !p.title.startsWith("AUDIT-QA3"));
  out.afterDemo = await snapshotDemo();

  out.demoUntouched = JSON.stringify(out.beforeDemo) === JSON.stringify(out.afterDemo);
  writeJson("fix4-qa3-99-cleanup.json", out);
  writeLog("fix4-qa3-99-cleanup.log", [
    `cleanup actions: ${out.cleanup.length}`,
    ...out.cleanup.map((x) => JSON.stringify(x)),
    `projects after: ${out.projectsAfter.map((p) => p.title).join(" | ")}`,
    `onlyExpectedRemain=${out.onlyExpectedRemain} noQa3Remain=${out.noQa3Remain} demoUntouched=${out.demoUntouched}`,
  ]);
  console.log(JSON.stringify({ cleanup: out.cleanup, projectsAfter: out.projectsAfter, onlyExpectedRemain: out.onlyExpectedRemain, noQa3Remain: out.noQa3Remain, demoUntouched: out.demoUntouched, beforeDemo: out.beforeDemo, afterDemo: out.afterDemo }, null, 1));
};
run().catch((e) => { console.error("ERR", e && e.stack ? e.stack : e); process.exit(1); });