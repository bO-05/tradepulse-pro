import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const EVIDENCE_DIR = "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const state = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa5-state.json"), "utf8"));
const client = new ConvexHttpClient(BACKEND);
const out = { backend: BACKEND, at: new Date().toISOString(), projectTitle: state.projectTitle };

const projects = await client.query("projects:listProjects", {});
const mine = projects.find((p) => p.title === state.projectTitle);
const demo = projects.find((p) => p.isDemoProject) || projects.find((p) => /Domain Tower B/i.test(p.title));
out.myProject = mine ? { id: mine._id, title: mine.title } : null;
out.demoProject = demo ? { id: demo._id, title: demo.title, isDemoProject: demo.isDemoProject } : null;

const minePkgs = await client.query("tradePackages:listByProject", { projectId: mine._id });
out.myPackages = minePkgs.map((p) => ({ csiDivision: p.csiDivision, tradeName: p.tradeName, budget: p.budgetEstimate, status: p.status }));
out.myBidsByPackage = {};
for (const p of minePkgs) {
  const bids = await client.query("bids:listByPackage", { tradePackageId: p._id });
  out.myBidsByPackage[p.csiDivision] = bids.map((b) => ({ name: b.subcontractorName, base: b.baseBidAmount, leveled: b.leveledTotalCost, awarded: !!b.isAwarded, exclusions: (b.identifiedExclusions || []).length }));
}
out.myAgreements = (await client.query("agreements:listAgreements", { projectId: mine._id })).map((a) => ({ number: a.agreementNumber, sub: a.subcontractorName, sum: a.contractSum, status: a.status }));
out.myFiles = (await client.query("files:listFilesByProject", { projectId: mine._id })).map((f) => ({ fileName: f.fileName, type: f.fileType }));
out.myAudit = (await client.query("auditLogs:listRecentLogs", { projectId: mine._id, limit: 100 })).map((l) => ({ title: l.title, actor: l.actor, ts: l.timestamp }));
out.myClashes = await client.query("coordination:detectCrossTradeClashes", { projectId: mine._id });
out.demoClashes = demo ? await client.query("coordination:detectCrossTradeClashes", { projectId: demo._id }) : null;
out.demoAuditNewest = demo ? (await client.query("auditLogs:listRecentLogs", { projectId: demo._id, limit: 5 })).map((l) => ({ title: l.title, ts: l.timestamp })) : null;

const myClashSignature = JSON.stringify((out.myClashes.doubleBuys || []).map((d) => [d.id, d.title, d.redundantAmount]).concat((out.myClashes.scopeVoids || []).map((v) => [v.id, v.title, v.estimatedVoidCost])));
const demoClashSignature = JSON.stringify((out.demoClashes.doubleBuys || []).map((d) => [d.id, d.title, d.redundantAmount]).concat((out.demoClashes.scopeVoids || []).map((v) => [v.id, v.title, v.estimatedVoidCost])));
out.clashSignaturesIdentical = myClashSignature === demoClashSignature;

const qa5Start = Date.parse("2026-09-16T11:27:00Z");
out.demoWritesDuringQa5 = (out.demoAuditNewest || []).filter((l) => l.ts >= qa5Start);

fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa5-FINAL-backend-state.json"), JSON.stringify(out, null, 2), "utf8");
const lines = [];
lines.push(`QA-5 FINAL BACKEND STATE @ ${out.at}`);
lines.push(`my project: ${mine.title} (${mine._id})`);
lines.push(`packages: ${out.myPackages.map((p) => `${p.csiDivision} ${p.tradeName} [${p.status}]`).join("; ")}`);
lines.push(`bids: ${JSON.stringify(out.myBidsByPackage)}`);
lines.push(`agreements: ${out.myAgreements.map((a) => `${a.number} ${a.sub} $${a.sum} ${a.status}`).join("; ")}`);
lines.push(`files: ${out.myFiles.map((f) => `${f.fileName}(${f.type})`).join("; ")}`);
lines.push(`audit events (${out.myAudit.length}): ${out.myAudit.map((l) => l.title).join(" | ")}`);
lines.push(`my clashes: doubleBuys=${(out.myClashes.doubleBuys || []).length} scopeVoids=${(out.myClashes.scopeVoids || []).length}`);
lines.push(`demo clashes: doubleBuys=${(out.demoClashes.doubleBuys || []).length} scopeVoids=${(out.demoClashes.scopeVoids || []).length}`);
lines.push(`clash signature identical (mine == demo): ${out.clashSignaturesIdentical}`);
lines.push(`demo project newest audit events: ${JSON.stringify(out.demoAuditNewest)}`);
lines.push(`demo writes during QA-5 window (>=2026-09-16T11:27Z): ${out.demoWritesDuringQa5.length}`);
fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa5-FINAL-backend-state.txt"), lines.join("\n") + "\n", "utf8");
console.log(lines.join("\n"));