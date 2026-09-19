/** QA22-03b probe: inspect journey project state for ingest #2 + dispatch outcomes. */
import { client, writeEvidence, writeLog } from "./qa22-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const projects = (await c.query("projects:listProjects", {})) || [];
const p = projects.find((x) => x.title === "AUDIT-QA22-JOURNEY");
if (!p) throw new Error("journey project missing");
const [pkgs, bids, files, logs, ctrs] = await Promise.all([
  c.query("tradePackages:listByProject", { projectId: p._id }),
  c.query("bids:listAllProjectBids", { projectId: p._id }),
  c.query("files:listFilesByProject", { projectId: p._id }),
  c.query("auditLogs:listRecentLogs", { projectId: p._id, limit: 500 }),
  c.query("contractors:listByProject", { projectId: p._id }),
]);
const out = {
  project: { id: p._id, title: p.title },
  packages: pkgs.map((x) => ({ id: x._id, csi: x.csiDivision, status: x.status })),
  contractors: ctrs.map((x) => ({ name: x.companyName, status: x.rfqStatus, dispatchedAt: x.dispatchedAt ?? null })),
  bids: bids.map((b) => ({ name: b.subcontractorName, base: b.baseBidAmount, leveled: b.leveledTotalCost, rev: b.revisionNumber, sourceFileId: b.sourceFileId ?? null, receivedAt: b.receivedAt })),
  files: files.map((f) => ({ name: f.fileName, type: f.fileType, by: f.uploadedBy })),
  dispatchLogs: logs.filter((l) => /RFQ|Dispatch|Invitation/i.test(l.title)).map((l) => ({ title: l.title, actor: l.actor, ts: l.timestamp })),
  errorLogs: logs.filter((l) => /Error|Failed|failed/i.test(l.title)).map((l) => l.title),
  bidLogs: logs.filter((l) => /Bid Leveled|Forensic Bid/i.test(l.title)).map((l) => ({ title: l.title, ts: l.timestamp })),
};
say(JSON.stringify(out, null, 1));
writeEvidence("journey-probe", out);
writeLog("journey-probe", log);