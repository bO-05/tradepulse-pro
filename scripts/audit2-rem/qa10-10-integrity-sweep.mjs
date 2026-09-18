import { client, listQa10Projects, fullFixtureState, writeEvidence, writeLog } from "./qa10-lib.mjs";

const c = client();
const log = [];
const failures = [];
const say = (s) => { log.push(s); console.log(s); };

function calculateLeveledCost(bid) {
  const activeExclusions = (bid.identifiedExclusions || []).reduce((s, e) => (e.isWaived ? s : s + (e.costImpact || 0)), 0);
  const accepted = (bid.valueEngineeringAlternates || []).reduce((s, a) => (a.isAccepted ? s + (a.costDeduct || 0) : s), 0);
  return Math.max(0, bid.baseBidAmount + activeExclusions + (bid.leadTimePenalty || 0) + (bid.coiPenalty || 0) - accepted);
}

const ALLOWED_CONVO = new Set(["pending_analysis", "clarified", "escalated_to_pm", "failed_analysis", "rejected"]);

async function main() {
  const projects = await listQa10Projects(c);
  say(`QA10 projects: ${projects.map((p) => p.title).join(", ") || "(none)"}`);
  const report = { projects: [], failures: [] };

  for (const project of projects) {
    const st = await fullFixtureState(c, project._id);
    const pkgIds = new Set(st.packages.map((p) => p._id));
    const ctrById = new Map(st.contractors.map((x) => [x._id, x]));
    const bidById = new Map(st.bids.map((b) => [b._id, b]));
    const bad = [];
    for (const b of st.bids) {
      if (!pkgIds.has(b.tradePackageId)) bad.push(`orphan bid ${b._id} (package not in project)`);
      const ctr = ctrById.get(b.contractorId);
      if (!ctr) bad.push(`bid ${b._id} contractor ${b.contractorId} missing`);
      else if (ctr.tradePackageId !== b.tradePackageId) bad.push(`bid ${b._id} contractor package mismatch`);
      if (!b.subcontractorName || !String(b.subcontractorName).trim()) bad.push(`bid ${b._id} empty subcontractorName`);
      const expected = calculateLeveledCost(b);
      if (expected !== b.leveledTotalCost) bad.push(`bid ${b._id} leveled mismatch stored=${b.leveledTotalCost} recomputed=${expected}`);
    }
    for (const ctr of st.contractors) {
      if (!pkgIds.has(ctr.tradePackageId)) bad.push(`orphan contractor ${ctr._id}`);
      if (!ctr.companyName || !String(ctr.companyName).trim()) bad.push(`contractor ${ctr._id} empty name`);
      if (!ctr.contactEmail || !String(ctr.contactEmail).trim()) bad.push(`contractor ${ctr._id} empty email`);
    }
    for (const a of st.agreements) {
      if (!pkgIds.has(a.tradePackageId)) bad.push(`orphan agreement ${a._id}`);
      const b = bidById.get(a.bidId);
      if (!b) bad.push(`agreement ${a._id} bid ${a.bidId} missing`);
      else {
        if (b.tradePackageId !== a.tradePackageId) bad.push(`agreement ${a._id} package/bid mismatch`);
        if (a.status !== "superseded" && a.contractSum !== b.leveledTotalCost) bad.push(`agreement ${a._id} contractSum=${a.contractSum} != bid leveled=${b.leveledTotalCost}`);
      }
      if (!a.contractText || a.contractText.length < 100) bad.push(`agreement ${a._id} suspiciously short contractText`);
      if (!a.agreementNumber) bad.push(`agreement ${a._id} missing number`);
    }
    for (const convo of st.conversations) {
      const ctr = ctrById.get(convo.contractorId);
      if (!ctr) bad.push(`conversation ${convo._id} contractor missing`);
      else if (ctr.tradePackageId !== convo.tradePackageId) bad.push(`conversation ${convo._id} contractor/package mismatch`);
      if (!ALLOWED_CONVO.has(convo.status)) bad.push(`conversation ${convo._id} invalid status ${convo.status}`);
    }
    for (const f of st.files) {
      if (f.tradePackageId && !pkgIds.has(f.tradePackageId)) bad.push(`file ${f._id} cross-project package`);
    }
    const seen = new Set();
    for (const b of st.bids) {
      const key = `${b.tradePackageId}|${b.contractorId}`;
      if (seen.has(key)) bad.push(`duplicate bid for package+contractor ${key}`);
      seen.add(key);
    }
    report.projects.push({
      title: project.title, projectId: project._id,
      packages: st.packages.length, contractors: st.contractors.length, bids: st.bids.length,
      conversations: st.conversations.length, agreements: st.agreements.length, files: st.files.length, logs: st.logs.length,
      failures: bad,
    });
    if (bad.length) { failures.push(...bad.map((x) => `${project.title}: ${x}`)); say(`FLAG ${project.title}: ${bad.length} failures`); bad.forEach((x) => say(`   - ${x}`)); }
    else say(`ok ${project.title}: no corrupt/orphan rows (packages=${st.packages.length} contractors=${st.contractors.length} bids=${st.bids.length} agreements=${st.agreements.length} convos=${st.conversations.length} files=${st.files.length})`);
  }
  report.failures = failures;
  writeEvidence("integrity-sweep", report);
  writeLog("integrity-sweep", log);
  console.log(`\nINTEGRITY SWEEP: ${failures.length} failures across ${projects.length} QA10 projects`);
}

main().catch((e) => { console.error(e); process.exit(1); });