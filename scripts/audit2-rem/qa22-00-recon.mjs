/**
 * QA22-00 recon (READ-ONLY): snapshot live backend, confirm who exists,
 * confirm no AUDIT-QA22 leftovers, capture demo baseline + provider/cron status.
 */
import fs from "node:fs";
import path from "node:path";
import { client, writeEvidence, writeLog, EVIDENCE_DIR } from "./qa22-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const out = { startedAt: new Date().toISOString() };

async function main() {
  const health = await fetch("https://brainy-skunk-440.convex.site/api/health").then((r) => r.json());
  out.health = health;
  say(`health: ${JSON.stringify(health)}`);

  const projects = (await c.query("projects:listProjects", {})) || [];
  out.projects = projects.map((p) => ({ id: p._id, title: p.title, budget: p.estBudget, demo: p.isDemoProject }));
  say(`projects(${projects.length}): ${projects.map((p) => p.title).join(" | ")}`);

  out.qa22Leftovers = projects.filter((p) => p.title.startsWith("AUDIT-QA22-")).map((p) => p.title);
  const forbidden = projects.filter((p) => /^GC-AUDIT|^AUDIT-5-|^AUDIT-QA(?!22)/.test(p.title)).map((p) => p.title);
  out.foreignFixtures = forbidden;
  say(`qa22 leftovers: ${out.qa22Leftovers.length}; foreign fixtures visible: ${forbidden.length}`);

  const demo = projects.find((p) => p.isDemoProject || /Domain Tower B/.test(p.title));
  if (demo) {
    const [pkgs, agrs, bids] = await Promise.all([
      c.query("tradePackages:listByProject", { projectId: demo._id }),
      c.query("agreements:listAgreements", { projectId: demo._id }),
      c.query("bids:listAllProjectBids", { projectId: demo._id }),
    ]);
    out.demo = {
      id: demo._id,
      title: demo.title,
      budget: demo.estBudget,
      packages: (pkgs || []).map((p) => ({ csi: p.csiDivision, status: p.status, budget: p.budgetEstimate })),
      agreements: (agrs || []).map((a) => ({ num: a.agreementNumber, status: a.status, sum: a.contractSum })),
      bidCount: (bids || []).length,
    };
    say(`demo: ${demo.title} pkgs=${(pkgs || []).length} agrs=${(agrs || []).length} bids=${(bids || []).length}`);
  }

  out.providers = await c.query("llmRouter:getProviderAvailability", {}).catch((e) => ({ error: String(e?.message || e) }));
  say(`providers: ${JSON.stringify(out.providers).slice(0, 400)}`);
  out.cron = await c.query("crons:getCronStatus", {}).catch((e) => ({ error: String(e?.message || e) }));
  say(`cron: ${JSON.stringify(out.cron).slice(0, 300)}`);

  fs.mkdirSync(path.join(EVIDENCE_DIR, "fix4-qa22-journey-downloads"), { recursive: true });
  fs.mkdirSync(path.join(EVIDENCE_DIR, "fix4-qa22-ui-downloads"), { recursive: true });

  writeEvidence("recon", out);
  writeLog("recon", log);
}
main().catch((e) => {
  console.error(e);
  writeLog("recon-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});