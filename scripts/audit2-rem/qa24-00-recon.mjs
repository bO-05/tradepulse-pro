/**
 * QA24-00 recon: deployment reachability, project inventory, QA24 leftovers.
 */
import { client, writeEvidence, writeLog, PREFIX } from "./qa24-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const t0 = Date.now();
const projects = (await c.query("projects:listProjects", {})) || [];
const out = {
  capturedAt: new Date().toISOString(),
  url: "https://brainy-skunk-440.convex.cloud",
  latencyMs: Date.now() - t0,
  projectCount: projects.length,
  qa24Leftovers: projects.filter((p) => p.title.startsWith(PREFIX)).map((p) => p.title),
  foreignFixtures: projects.filter((p) => /AUDIT|GC-AUDIT|demo|Demo/i.test(p.title) && !p.title.startsWith(PREFIX)).map((p) => p.title),
  allTitles: projects.map((p) => p.title),
};
say(`projects=${out.projectCount} qa24Leftovers=${out.qa24Leftovers.length} latencyMs=${out.latencyMs}`);
say(`foreign=${JSON.stringify(out.foreignFixtures)}`);
writeEvidence("recon", out);
writeLog("recon", log);