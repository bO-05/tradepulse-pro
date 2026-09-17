import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const EVIDENCE_DIR = "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const label = process.argv[2] || "snapshot";

const statePath = path.join(EVIDENCE_DIR, "remediation-qa5-state.json");
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : {};
const projectTitle = state.projectTitle;
if (!projectTitle) {
  console.error("No projectTitle in state file; run qa5-part1 first.");
  process.exit(1);
}

const client = new ConvexHttpClient(BACKEND);
const out = { label, backend: BACKEND, projectTitle, queriedAt: new Date().toISOString() };

const projects = await client.query("projects:listProjects", {});
out.projectsTotal = projects.length;
const project = projects.find((p) => p.title === projectTitle);
if (!project) {
  out.error = "project not found in listProjects";
  writeOut();
  process.exit(2);
}
out.project = {
  id: project._id,
  title: project.title,
  location: project.location,
  estBudget: project.estBudget,
  targetCompletionWeeks: project.targetCompletionWeeks,
  isDemoProject: project.isDemoProject,
};

const packages = await client.query("tradePackages:listByProject", { projectId: project._id });
out.packages = packages.map((p) => ({
  id: p._id,
  csiDivision: p.csiDivision,
  tradeName: p.tradeName,
  budgetEstimate: p.budgetEstimate,
  bidDeadline: p.bidDeadline,
  mandatoryInclusions: p.mandatoryInclusions,
  scopeSummary: (p.scopeSummary || "").slice(0, 140),
  status: p.status,
  agentMailbox: p.agentMailbox,
}));

const targetPkg = packages.find((p) => p.csiDivision && p.csiDivision.startsWith("03") && p.tradeName && p.tradeName.includes("QA5"))
  || packages.find((p) => p.csiDivision && p.csiDivision.startsWith("03"))
  || packages[0];
if (!targetPkg) {
  out.error = "no packages";
  writeOut();
  process.exit(0);
}
out.targetPackageId = targetPkg._id;

const contractors = await client.query("contractors:listByPackage", { tradePackageId: targetPkg._id });
out.contractors = contractors.map((c) => ({
  id: c._id,
  companyName: c.companyName,
  contactEmail: c.contactEmail,
  licenseNumber: c.licenseNumber,
  licenseStatus: c.licenseStatus,
  rfqStatus: c.rfqStatus,
  sourceUrl: c.sourceUrl,
}));

const conversations = await client.query("rfq:listConversations", { tradePackageId: targetPkg._id });
out.conversations = conversations.map((c) => ({
  id: c._id,
  subject: c.inboundSubject,
  question: (c.inboundQuestion || "").slice(0, 160),
  reply: (c.autonomousReply || "").slice(0, 220),
  status: c.status,
  pmCertifiedAt: c.pmCertifiedAt ?? null,
  reviewNote: c.reviewNote ?? null,
}));

const bids = await client.query("bids:listByPackage", { tradePackageId: targetPkg._id });
out.bids = bids.map((b) => {
  const exclusions = b.identifiedExclusions || [];
  const alternates = b.valueEngineeringAlternates || [];
  const activeExclusions = exclusions.reduce((s, x) => (x.isWaived ? s : s + (x.costImpact || 0)), 0);
  const acceptedAlternates = alternates.reduce((s, x) => (x.isAccepted ? s + (x.costDeduct || 0) : s), 0);
  const recomputed = Math.max(
    0,
    b.baseBidAmount + activeExclusions + (b.leadTimePenalty || 0) + (b.coiPenalty || 0) - acceptedAlternates
  );
  return {
    id: b._id,
    subcontractorName: b.subcontractorName,
    baseBidAmount: b.baseBidAmount,
    exclusions: exclusions.map((x) => ({ desc: (x.description || "").slice(0, 90), costImpact: x.costImpact, isWaived: !!x.isWaived })),
    alternates: alternates.map((x) => ({ desc: (x.description || "").slice(0, 90), costDeduct: x.costDeduct, isAccepted: !!x.isAccepted })),
    longLeadEquipmentWeeks: b.longLeadEquipmentWeeks,
    leadTimePenalty: b.leadTimePenalty,
    coiComplianceStatus: b.coiComplianceStatus,
    coiPenalty: b.coiPenalty,
    leveledTotalCost: b.leveledTotalCost,
    recomputedLeveledTotal: recomputed,
    recomputeMatches: recomputed === b.leveledTotalCost,
    isAwarded: !!b.isAwarded,
    receivedAt: b.receivedAt,
  };
});

const agreements = await client.query("agreements:listAgreements", { projectId: project._id });
out.agreements = agreements.map((a) => ({
  id: a._id,
  agreementNumber: a.agreementNumber,
  subcontractorName: a.subcontractorName,
  contractSum: a.contractSum,
  status: a.status,
  csiDivision: a.csiDivision,
  executedAt: a.executedAt ?? null,
}));

const auditLogs = await client.query("auditLogs:listRecentLogs", { projectId: project._id, limit: 100 });
out.auditLogsCount = auditLogs.length;
out.auditLogs = auditLogs.map((l) => ({ eventType: l.eventType, title: l.title, actor: l.actor, ts: l.timestamp }));

const clashes = await client.query("coordination:detectCrossTradeClashes", { projectId: project._id });
out.clashes = {
  doubleBuys: ((clashes && clashes.doubleBuys) || []).map((d) => ({
    id: d.id,
    title: d.title,
    redundantAmount: d.redundantAmount,
    status: d.status,
    resolution: d.resolution ?? null,
    involvedPackages: d.involvedPackages ?? d.tradePackageIds ?? null,
  })),
  scopeVoids: ((clashes && clashes.scopeVoids) || []).map((v) => ({
    id: v.id,
    title: v.title,
    estimatedVoidCost: v.estimatedVoidCost,
    status: v.status,
    assignedToTradeName: v.assignedToTradeName ?? null,
  })),
};

const files = await client.query("files:listFilesByProject", { projectId: project._id });
out.files = files.map((f) => ({ id: f._id, fileName: f.fileName, fileType: f.fileType, fileSize: f.fileSize, uploadedBy: f.uploadedBy }));

writeOut();

function writeOut() {
  const jsonPath = path.join(EVIDENCE_DIR, `remediation-qa5-backend-${label}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2), "utf8");
  const summary = [];
  summary.push(`BACKEND SNAPSHOT [${label}] @ ${out.queriedAt}`);
  summary.push(`backend: ${BACKEND}`);
  summary.push(`project: ${projectTitle} -> ${out.project ? out.project.id : "NOT FOUND"}`);
  if (out.packages) summary.push(`packages (${out.packages.length}): ${out.packages.map((p) => p.csiDivision).join(", ")}`);
  if (out.contractors) summary.push(`contractors (${out.contractors.length}): ${out.contractors.map((c) => `${c.companyName}[${c.rfqStatus}]`).join("; ")}`);
  if (out.conversations) summary.push(`RFIs (${out.conversations.length}): ${out.conversations.map((c) => `${c.subject} -> ${c.status}${c.pmCertifiedAt ? " (PM certified)" : ""}`).join("; ")}`);
  if (out.bids) summary.push(`bids (${out.bids.length}): ${out.bids.map((b) => `${b.subcontractorName}: base=${b.baseBidAmount} leveled=${b.leveledTotalCost} recomputed=${b.recomputedLeveledTotal} match=${b.recomputeMatches} awarded=${b.isAwarded}`).join("; ")}`);
  if (out.agreements) summary.push(`agreements (${out.agreements.length}): ${out.agreements.map((a) => `${a.agreementNumber} ${a.subcontractorName} $${a.contractSum} ${a.status}`).join("; ")}`);
  if (out.auditLogs) summary.push(`audit events (${out.auditLogsCount}): ${out.auditLogs.map((l) => l.title).join(" | ")}`);
  if (out.clashes) summary.push(`clashes: doubleBuys=${out.clashes.doubleBuys.length} scopeVoids=${out.clashes.scopeVoids.length}`);
  if (out.files) summary.push(`files (${out.files.length}): ${out.files.map((f) => `${f.fileName}(${f.fileType})`).join("; ")}`);
  const txtPath = path.join(EVIDENCE_DIR, `remediation-qa5-backend-${label}.txt`);
  fs.writeFileSync(txtPath, summary.join("\n") + "\n", "utf8");
  console.log(summary.join("\n"));
  console.log(`\nJSON: ${jsonPath}`);
}