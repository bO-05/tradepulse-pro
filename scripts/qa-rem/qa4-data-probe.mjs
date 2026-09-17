import { ConvexHttpClient } from "convex/browser";

const url = process.argv[2] || "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(url);

console.log("DEPLOYMENT:", url);
const t0 = Date.now();
const projects = await client.query("projects:listProjects", {});
console.log(`QUERY_MS: ${Date.now() - t0}`);
console.log(`PROJECT COUNT: ${projects.length}`);
for (const p of projects) {
  const row = { title: p.title, demo: !!p.isDemoProject, id: p._id, created: new Date(p._creationTime).toISOString() };
  let pkgs = [];
  let bids = [];
  let ags = [];
  let files = [];
  let convos = [];
  let logs = [];
  try { pkgs = await client.query("tradePackages:listByProject", { projectId: p._id }); } catch (e) { row.pkgErr = e.message; }
  try { bids = await client.query("bids:listAllProjectBids", { projectId: p._id }); } catch (e) { row.bidErr = e.message; }
  try { ags = await client.query("agreements:listAgreements", { projectId: p._id }); } catch (e) { row.agErr = e.message; }
  try { files = await client.query("files:listFilesByProject", { projectId: p._id }); } catch (e) { row.fileErr = e.message; }
  try { convos = await client.query("rfq:listConversations", { projectId: p._id }); } catch (e) { row.convErr = e.message; }
  try { logs = await client.query("auditLogs:listRecentLogs", { projectId: p._id, limit: 200 }); } catch (e) { row.logErr = e.message; }
  console.log(JSON.stringify({
    ...row,
    packages: pkgs.length,
    bids: bids.length,
    agreements: ags.map((a) => `${a.agreementNumber}:${a.status}`),
    files: files.map((f) => `${f.fileName}:${f.fileType}`),
    conversations: convos.map((c) => `${c.status}${c.pmCertifiedAt ? ":certified" : ""}`),
    auditLogs: logs.length,
    pkgDivisions: pkgs.map((k) => k.csiDivision),
  }));
}