import { client, writeEvidence } from "./qa9-lib.mjs";
import { cliDump } from "./qa7-lib.mjs";

const c = client();
const TABLES = ["tradePackages", "contractors", "bids", "agreements", "conversations", "projectFiles", "clashResolutions", "auditLogs", "projects"];
const out = { fetchedAt: new Date().toISOString(), hits: {}, counts: {} };
const projects = await c.query("projects:listProjects", {});
out.projectTitles = projects.map((p) => p.title);
const qa9Needle = /QA9|AUDIT-QA9/i;
for (const t of TABLES) {
  try {
    const rows = cliDump(t);
    out.counts[t] = rows.length;
    const hits = rows.filter((r) => JSON.stringify(r).match(qa9Needle));
    out.hits[t] = hits.length;
    if (hits.length) out.hits[t + "_sample"] = hits.slice(0, 3).map((r) => r.title || r.fileName || r.companyName || r.subcontractorName || r._id);
  } catch (e) {
    out.counts[t] = "ERR " + String(e.message).slice(0, 80);
  }
}
writeEvidence("99b-orphans", out);
console.log(JSON.stringify(out.hits, null, 1));