import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";

const c = new ConvexHttpClient(process.env.REM_CONVEX_URL || "https://brainy-skunk-440.convex.cloud");
const projectId = process.env.REM_PROJECT_ID;

const main = async () => {
  const projects = await c.query("projects:listProjects", {});
  const out = { fetchedAt: new Date().toISOString(), projects: [] };
  for (const p of projects) {
    const rec = { id: p._id, title: p.title, location: p.location, budget: p.totalBudget, duration: p.durationWeeks };
    rec.packages = (await c.query("tradePackages:listByProject", { projectId: p._id }).catch((e) => "ERR " + e.message)) || [];
    if (Array.isArray(rec.packages)) {
      rec.packages = rec.packages.map((x) => ({ id: x._id, csi: x.csiDivision, name: x.tradeName, budget: x.budgetEstimate, status: x.status }));
    }
    rec.contractors = (await c.query("contractors:listByProject", { projectId: p._id }).catch((e) => "ERR " + e.message)) || [];
    if (Array.isArray(rec.contractors)) {
      rec.contractors = rec.contractors.map((x) => ({ id: x._id, pkg: x.tradePackageId, name: x.companyName, email: x.contactEmail, phone: x.phone, license: x.licenseNumber, status: x.licenseStatus, rfq: x.rfqStatus }));
    }
    out.projects.push(rec);
  }
  fs.writeFileSync("evidence/fix-backend-projects.json", JSON.stringify(out, null, 2));
  console.log("projects:", projects.map((p) => `${p.title} [${p._id}]`).join("\n"));
  for (const p of out.projects) {
    console.log("packages:", JSON.stringify(p.packages));
    console.log("contractors:", Array.isArray(p.contractors) ? p.contractors.length : p.contractors);
  }
};

main().catch((e) => { console.error("ERR", e); process.exit(1); });