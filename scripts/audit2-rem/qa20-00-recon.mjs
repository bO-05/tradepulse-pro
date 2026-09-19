/**
 * QA20-00 recon: enumerate projects and check the live surface we will build on.
 * Read-only.
 */
import { client, writeEvidence, writeLog } from "./qa20-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function main() {
  const projects = (await c.query("projects:listProjects", {})) || [];
  const summary = projects.map((p) => ({
    id: p._id,
    title: p.title,
    isDemo: p.isDemoProject,
    budget: p.estBudget,
    location: p.location,
  }));
  say(`projects (${summary.length}):`);
  for (const p of summary) say(`  ${p.isDemo ? "[DEMO]" : "      "} ${p.title} :: ${p.id} :: $${p.budget}`);

  // Read-only global state-machine scan (counts only, no names) to know the baseline.
  const violations = [];
  for (const p of projects.filter((x) => !x.isDemoProject)) {
    const [packages, agreements, bids] = await Promise.all([
      c.query("tradePackages:listByProject", { projectId: p._id }),
      c.query("agreements:listAgreements", { projectId: p._id }),
      c.query("bids:listAllProjectBids", { projectId: p._id }),
    ]);
    const activeByPkg = new Map();
    for (const a of agreements || []) {
      if (a.status !== "superseded") activeByPkg.set(a.tradePackageId, (activeByPkg.get(a.tradePackageId) || 0) + 1);
    }
    for (const [pkgId, n] of activeByPkg) {
      if (n > 1) violations.push({ project: p.title, kind: "two_active_agreements", pkgId, n });
    }
    for (const a of agreements || []) {
      const bid = (bids || []).find((b) => b._id === a.bidId);
      if (!bid) violations.push({ project: p.title, kind: "agreement_bid_missing", agreement: a.agreementNumber, status: a.status });
      if (a.status === "executed" && bid && !bid.isAwarded) {
        violations.push({ project: p.title, kind: "executed_agreement_bid_not_awarded", agreement: a.agreementNumber });
      }
      const pkg = (packages || []).find((x) => x._id === a.tradePackageId);
      if (!pkg) violations.push({ project: p.title, kind: "agreement_pkg_missing", agreement: a.agreementNumber });
    }
    for (const pkg of packages || []) {
      const pkgBids = (bids || []).filter((b) => b.tradePackageId === pkg._id);
      const awarded = pkgBids.filter((b) => b.isAwarded);
      if (awarded.length > 1) violations.push({ project: p.title, kind: "two_awarded_bids", pkg: pkg.csiDivision, n: awarded.length });
      if (pkg.status === "awarded" && awarded.length === 0 && !activeByPkg.has(pkg._id)) {
        violations.push({ project: p.title, kind: "awarded_flag_without_award", pkg: pkg.csiDivision });
      }
      if (awarded.length > 0 && pkg.status !== "awarded") {
        violations.push({ project: p.title, kind: "awarded_bid_but_pkg_not_awarded", pkg: pkg.csiDivision, status: pkg.status });
      }
    }
  }
  say(`baseline read-only violations on non-demo projects: ${violations.length}`);
  for (const v of violations.slice(0, 20)) say(`  ${JSON.stringify(v)}`);

  const cron = await c.query("crons:getCronStatus", {});
  say(`cron status: ${JSON.stringify(cron)}`);

  writeEvidence("recon", { summary, violations, cron });
  writeLog("recon", log);
  console.log("recon done");
}

main().catch((e) => {
  console.error(e);
  writeLog("recon-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});