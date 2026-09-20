/**
 * AUDIT7 CONV-A round 1 — final state verification after cleanup.
 * Records the live project list, proves zero AUDIT7-CONV-A-* remain, and flags any
 * concurrent (non-CONV-A) fixtures left by other auditors without touching them.
 */
import { q, writeEvidence, PREFIX } from "./lib.mjs";

const projects = (await q("projects:listProjects", {})) || [];
const convA = projects.filter((p) => p.title.startsWith(`${PREFIX}CONV-A-`));
const demo = projects.find((p) => /The Domain Tower B/.test(p.title));
const others = projects.filter((p) => p !== demo && !convA.includes(p));

let demoState = null;
if (demo) {
  const [pkgs, bids, agrs] = await Promise.all([
    q("tradePackages:listByProject", { projectId: demo._id }),
    q("bids:listAllProjectBids", { projectId: demo._id }),
    q("agreements:listAgreements", { projectId: demo._id }),
  ]);
  demoState = { packages: (pkgs || []).length, bids: (bids || []).length, agreements: (agrs || []).length };
}

const out = {
  checkedAt: new Date().toISOString(),
  projects: projects.map((p) => ({ _id: p._id, title: p.title, isDemoProject: p.isDemoProject ?? null })),
  demoState,
  assertions: {
    zeroConvAFixturesRemain: convA.length === 0,
    demoPresent: Boolean(demo),
    onlyDemoRemainsIgnoringConcurrentExternalFixtures: others.length === 0,
    concurrentExternalFixtures: others.map((p) => p.title),
  },
};
await writeEvidence("a7conv-a-final-state.json", out);
console.log(JSON.stringify(out, null, 2));