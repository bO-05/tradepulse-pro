import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";

const c = new ConvexHttpClient(process.env.REM_CONVEX_URL || "https://brainy-skunk-440.convex.cloud");
const PROJECT = "jx7emzjxc9q9ckdrb0pnjd90zd8ejz06";

const q = async (name, args) => {
  try { return await c.query(name, args); } catch (e) { return { __error: e.message }; }
};

const main = async () => {
  const out = { fetchedAt: new Date().toISOString(), projectId: PROJECT };
  out.bids = await q("bids:listAllProjectBids", { projectId: PROJECT });
  out.agreements = await q("agreements:listAgreements", { projectId: PROJECT });
  out.files = await q("files:listFilesByProject", { projectId: PROJECT });
  out.logs = await q("auditLogs:listRecentLogs", { projectId: PROJECT, limit: 30 });
  out.clashes = await q("coordination:detectCrossTradeClashes", { projectId: PROJECT });
  const pkgs = await q("tradePackages:listByProject", { projectId: PROJECT });
  out.packages = pkgs;
  out.conversations = {};
  if (Array.isArray(pkgs)) {
    for (const p of pkgs) {
      out.conversations[p._id] = await q("rfq:listConversations", { tradePackageId: p._id });
    }
  }
  fs.writeFileSync("evidence/fix-backend-demo.json", JSON.stringify(out, null, 2));
  const summ = (x) => Array.isArray(x) ? x.length : x;
  console.log("bids:", summ(out.bids));
  if (Array.isArray(out.bids)) for (const b of out.bids) {
    console.log(`  bid ${b.subcontractorName} base=${b.baseBidAmount} leveled=${b.leveledTotalCost} awarded=${b.isAwarded} pkg=${b.tradePackageId} exclusions=${(b.identifiedExclusions||[]).length} lead=${b.leadTimePenalty} coi=${b.coiPenalty} ve=${(b.valueEngineeringAlternatives||[]).length}`);
  }
  console.log("agreements:", summ(out.agreements));
  if (Array.isArray(out.agreements)) for (const a of out.agreements) {
    console.log(`  agr ${a.agreementNumber} ${a.subcontractorName} sum=${a.contractSum} status=${a.status} ld=${a.liquidatedDamagesDaily} exec=${a.executedAt || "none"}`);
  }
  console.log("files:", summ(out.files));
  if (Array.isArray(out.files)) for (const f of out.files) console.log(`  file ${f.fileName} size=${f.fileSize} pkg=${f.tradePackageId || "-"} url=${f.url ? "yes" : "no"} textLen=${(f.textContent||"").length}`);
  console.log("logs:", summ(out.logs));
  console.log("clashes:", Array.isArray(out.clashes) ? JSON.stringify(out.clashes.map(x => ({ id: x.id, type: x.type, amount: x.redundantAmount, status: x.status, title: x.title }))) : out.clashes);
  for (const [pid, conv] of Object.entries(out.conversations)) {
    console.log(`conversations pkg ${pid}:`, summ(conv));
    if (Array.isArray(conv)) for (const cv of conv) console.log(`   conv status=${cv.status} subject=${(cv.inboundSubject||"").slice(0,70)} ts=${cv.timestamp} conf=${cv.confidenceScore}`);
  }
};

main().catch((e) => { console.error("ERR", e); process.exit(1); });