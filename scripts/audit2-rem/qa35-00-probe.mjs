/**
 * QA35-00 probe (read-only): inventory of existing projects, AUDIT-QA35 leftovers,
 * legacy-format credit rows anywhere, and live-deployment reachability.
 * Never mutates.
 */
import { client, writeEvidence, writeLog } from "./qa35-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const LEGACY_RX = /^Cross-Trade Clash Credit: Deduct redundant /;
const NEW_RX = /^Cross-Trade Clash Credit \[[^\]]+\]:/;

async function main() {
  const projects = (await c.query("projects:listProjects", {})) || [];
  const byPrefix = {};
  for (const p of projects) {
    const pref = p.title.split("-").slice(0, 3).join("-");
    byPrefix[pref] = (byPrefix[pref] || 0) + 1;
  }
  const qa35 = projects.filter((p) => p.title.startsWith("AUDIT-QA35-"));
  const qa34 = projects.filter((p) => p.title.startsWith("AUDIT-QA34-"));
  const qa33 = projects.filter((p) => p.title.startsWith("AUDIT-QA33-"));
  say(`projects total=${projects.length}`);
  say(`AUDIT-QA35 leftovers=${qa35.length} :: ${qa35.map((p) => p.title).join(", ")}`);
  say(`AUDIT-QA34 leftovers=${qa34.length} :: ${qa34.map((p) => p.title).join(", ")}`);
  say(`AUDIT-QA33 leftovers=${qa33.length} :: ${qa33.map((p) => p.title).join(", ")}`);

  const legacyHits = [];
  const newHits = [];
  for (const p of projects) {
    const bids = (await c.query("bids:listAllProjectBids", { projectId: p._id })) || [];
    for (const b of bids) {
      for (const v of b.valueEngineeringAlternates || []) {
        const d = String(v.description || "");
        if (LEGACY_RX.test(d)) legacyHits.push({ project: p.title, bidId: b._id, accepted: !!v.isAccepted, amount: v.costDeduct || 0, description: d.slice(0, 140) });
        if (NEW_RX.test(d)) newHits.push({ project: p.title, bidId: b._id, accepted: !!v.isAccepted, amount: v.costDeduct || 0, description: d.slice(0, 140) });
      }
    }
  }
  say(`legacy-format credit rows across ALL projects: ${legacyHits.length}`);
  for (const h of legacyHits.slice(0, 10)) say(`  LEGACY ${JSON.stringify(h)}`);
  say(`new-format credit rows across ALL projects: ${newHits.length}`);

  const data = { projects: projects.map((p) => ({ id: p._id, title: p.title, isDemoProject: !!p.isDemoProject })), qa35: qa35.map((p) => p.title), qa34: qa34.map((p) => p.title), qa33: qa33.map((p) => p.title), legacyHits, newHits, prefixCounts: byPrefix };
  writeEvidence("probe", data);
  writeLog("probe", log);
}

main().catch((e) => {
  console.error(e);
  writeLog("probe-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});