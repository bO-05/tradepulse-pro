// QA-6 read-only follow-up: inspect QA-REM-qa6 project data created by the fuzz run.
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

const client = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const lines = [];
const log = (s) => {
  lines.push(s);
  console.log(s);
};
const J = (o) => JSON.stringify(o);

log("=== QA-6 follow-up data inspection (read-only) ===");
log(`UTC: ${new Date().toISOString()}`);
log("");

const projects = await client.query("projects:listProjects");
const qa = projects.filter((p) => /^QA-REM-qa6-/.test(p.title));
for (const p of qa) {
  log(`PROJECT ${p._id} "${p.title}" budget=${p.estBudget} weeks=${p.targetCompletionWeeks}`);
  const pkgs = await client.query("tradePackages:listByProject", { projectId: p._id });
  log(`  packages=${pkgs.length}`);
  for (const k of pkgs) {
    log(`    PKG ${k._id} csi="${k.csiDivision}" name="${k.tradeName}" budget=${k.budgetEstimate} deadline=${k.bidDeadline} status=${k.status}`);
    const cons = await client.query("contractors:listByProject", { projectId: p._id });
    const pkCons = cons.filter((c) => c.tradePackageId === k._id);
    log(`    contractors=${pkCons.length} ${pkCons.map((c) => `"${c.companyName}"(${c.rfqStatus})`).join(", ")}`);
    const bids = await client.query("bids:listByPackage", { tradePackageId: k._id });
    for (const b of bids) {
      log(
        `    BID ${b._id} sub="${b.subcontractorName}" base=${b.baseBidAmount} leveled=${b.leveledTotalCost} lead=${b.longLeadEquipmentWeeks} coi=${b.coiComplianceStatus} exclusions=${(b.identifiedExclusions || []).length} ve=${(b.valueEngineeringAlternates || []).length}`
      );
    }
    const convos = await client.query("rfq:listConversations", { tradePackageId: k._id });
    log(`    conversations=${convos.length}`);
    for (const c of convos.slice(0, 5)) {
      log(`      RFI status=${c.status} subject="${c.inboundSubject}" bodyLen=${(c.inboundBody || "").length}`);
    }
  }
  const logs = await client.query("auditLogs:listRecentLogs", { projectId: p._id, limit: 10 });
  log(`  auditLogs=${logs.length}`);
  for (const l of logs.slice(0, 6)) log(`    LOG ${l.eventType} "${l.title}"`);
}
log("");
log("--- all QA-REM projects in prod selector (count) ---");
const allQa = projects.filter((p) => /^QA-REM-/.test(p.title));
log(`total projects=${projects.length}; QA-REM=${allQa.length}; longest title=${Math.max(...allQa.map((p) => p.title.length))} chars`);
const dest = path.join(EVIDENCE_DIR, "remediation-qa6-fuzz-data-inspection.txt");
fs.writeFileSync(dest, lines.join("\n") + "\n", "utf8");
console.log(`Wrote ${dest}`);