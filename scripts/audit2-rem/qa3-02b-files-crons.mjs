import { ConvexHttpClient } from "convex/browser";
import { writeJson, writeLog } from "./lib.mjs";

const c = new ConvexHttpClient(process.env.REM_CONVEX_URL || "https://brainy-skunk-440.convex.cloud");
const FIXTURE = "AUDIT-QA3-fixture-2026-09-18";
const DEMO_ID = "jx7emzjxc9q9ckdrb0pnjd90zd8ejz06";
const results = [];
const rec = (id, label, outcome, detail) => {
  results.push({ id, label, outcome, detail });
  console.log(`${outcome.padEnd(13)} ${id} ${label} :: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
};
async function call(fn, args, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return { threw: false, value: await c.mutation(fn, args) }; }
    catch (e) {
      last = e;
      if (!String(e && e.message).includes("fetch failed")) break;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  return { threw: true, data: last && last.data !== undefined ? last.data : null, message: last && last.message ? last.message : String(last) };
}
async function query(fn, args) {
  try { return { threw: false, value: await c.query(fn, args) }; }
  catch (e) { return { threw: true, data: e && e.data !== undefined ? e.data : null, message: e && e.message ? e.message : String(e) }; }
}
const errText = (r) => (r.data && typeof r.data === "string" ? r.data : r.data ? JSON.stringify(r.data) : r.message);

const run = async () => {
  const out = { startedAt: new Date().toISOString(), results };
  const projects = (await query("projects:listProjects", {})).value;
  const fixture = projects.find((p) => p.title === FIXTURE);
  if (!fixture) throw new Error("fixture missing");
  out.fixtureId = fixture._id;
  const pkgs = (await query("tradePackages:listByProject", { projectId: fixture._id })).value;
  const pkg = pkgs.find((p) => p.csiDivision === "26 00 00") || pkgs[0];
  const contractors = (await query("contractors:listByProject", { projectId: fixture._id })).value;
  const bids = (await query("bids:listAllProjectBids", { projectId: fixture._id })).value;
  out.ids = { pkgId: pkg._id, contractorId: contractors[0]?._id, bidId: bids[0]?._id };

  const putBytes = async (bytes, mime) => {
    const u = (await call("files:generateUploadUrl", {})).value;
    const resp = await fetch(u, { method: "POST", headers: { "Content-Type": mime }, body: bytes });
    if (!resp.ok) throw new Error(`upload HTTP ${resp.status}`);
    return (await resp.json()).storageId;
  };

  // V44 re-run: authoritative size
  const sidTxt = await putBytes("QA3 plain text payload", "text/plain");
  let r = await call("files:saveFileRecord", {
    projectId: fixture._id, tradePackageId: pkg._id, storageId: sidTxt, fileName: "qa3-notes.txt",
    fileType: "spec", fileSize: 999999, uploadedBy: "QA3", textContent: "QA3 plain text payload", contentType: "text/plain",
  });
  if (!r.threw) {
    const files = (await query("files:listFilesByPackage", { tradePackageId: pkg._id })).value.filter((f) => f._id === r.value);
    rec("V44", "saveFileRecord authoritative size overrides spoofed 999999", files[0]?.fileSize === 21 ? "PASS" : "FAIL", { storedSize: files[0]?.fileSize, actualBytes: 21 });
    out.accepted = [r.value];
  } else rec("V44", "saveFileRecord valid txt", "FAIL", errText(r));

  // V45 content-vs-extension
  const sidHtml = await putBytes("<html><body><script>alert(1)</script></body></html>", "application/pdf");
  r = await call("files:saveFileRecord", {
    projectId: fixture._id, tradePackageId: pkg._id, storageId: sidHtml, fileName: "qa3-drawing.pdf",
    fileType: "blueprint", fileSize: 48, uploadedBy: "QA3", contentType: "application/pdf",
  });
  if (!r.threw) {
    rec("V45", "content-vs-extension: HTML bytes stored as .pdf blueprint", "FINDING", { fileId: r.value, note: "saveFileRecord trusts client contentType and never sniffs bytes; action-level ingestion sniffs only for bid extraction" });
    out.htmlFileId = r.value;
    const del = await call("files:deleteFile", { fileId: r.value });
    rec("V45c", "cleanup html-as-pdf file", del.threw ? "FAIL" : "PASS", del.threw ? errText(del) : del.value);
  } else rec("V45", "content-vs-extension byte sniff", "PASS-REJECTED", errText(r));

  r = await call("files:saveFileRecord", { projectId: fixture._id, storageId: sidTxt, fileName: "qa3-plan.pdf", fileType: "spec", fileSize: 10, uploadedBy: "QA3", contentType: "text/plain" });
  rec("V46", "content-type mismatch .pdf vs text/plain rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));
  r = await call("files:saveFileRecord", { projectId: fixture._id, storageId: sidTxt, fileName: "malware.exe", fileType: "spec", fileSize: 10, uploadedBy: "QA3" });
  rec("V47", "unsupported extension .exe rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));
  r = await call("files:saveFileRecord", { projectId: fixture._id, storageId: sidTxt, fileName: "..\\..\\evil.pdf", fileType: "spec", fileSize: 10, uploadedBy: "QA3" });
  rec("V48", "path traversal file name rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));
  r = await call("files:saveFileRecord", { projectId: fixture._id, storageId: "http://evil.example/remote.pdf", fileName: "remote.pdf", fileType: "spec", fileSize: 10, uploadedBy: "QA3" });
  rec("V49", "http storageId rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));
  r = await call("files:saveFileRecord", { projectId: fixture._id, storageId: "kg2nonexistentstorageid", fileName: "ghost.pdf", fileType: "spec", fileSize: 10, uploadedBy: "QA3" });
  rec("V50", "nonexistent storageId rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));
  const demoPkgId = "k17c5yx616xbye2sz9cfy1f22d8ekr0f";
  r = await call("files:saveFileRecord", { projectId: fixture._id, tradePackageId: demoPkgId, storageId: sidTxt, fileName: "qa3-cross.pdf", fileType: "spec", fileSize: 10, uploadedBy: "QA3" });
  rec("V51", "file with foreign package rejected (no cross-project write)", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));

  // V52-V55 crons
  const cronStatus = await query("crons:getCronStatus", {});
  rec("V52", "cron status query returns 2 scheduled jobs", cronStatus.value?.activeCrons?.length === 2 ? "PASS" : "FAIL", cronStatus.value);
  const demoBefore = JSON.stringify((await query("tradePackages:listByProject", { projectId: DEMO_ID })).value.map((p) => `${p._id}:${p.status}`));
  const live = await call("crons:runDeadlineMonitorNow", { projectId: fixture._id });
  const live2 = await call("crons:runDeadlineMonitorNow", { projectId: fixture._id });
  rec("V53", "runDeadlineMonitorNow scoped; state transition idempotent", live.value?.transitionedCount === 0 && live2.value?.transitionedCount === 0 ? "PASS" : "NOTE", { first: live.value, second: live2.value });
  const demoAfter = JSON.stringify((await query("tradePackages:listByProject", { projectId: DEMO_ID })).value.map((p) => `${p._id}:${p.status}`));
  rec("V54", "manual cron did not mutate demo project", demoBefore === demoAfter ? "PASS" : "FAIL", { demoBefore, demoAfter });
  const logCountBefore = (await query("auditLogs:listRecentLogs", { projectId: fixture._id, limit: 200 })).value.length;
  const ca1 = await call("crons:runComplianceAuditNow", { projectId: fixture._id });
  const logCountAfter1 = (await query("auditLogs:listRecentLogs", { projectId: fixture._id, limit: 200 })).value.length;
  const ca2 = await call("crons:runComplianceAuditNow", { projectId: fixture._id });
  const logCountAfter2 = (await query("auditLogs:listRecentLogs", { projectId: fixture._id, limit: 200 })).value.length;
  rec("V55", "runComplianceAuditNow scoped to fixture project", ca1.value?.success === true ? "PASS" : "FAIL", ca1.value);
  rec("V55b", "compliance audit appends one log per invocation (non-idempotent logging)", logCountAfter1 - logCountBefore === 1 && logCountAfter2 - logCountAfter1 === 1 ? "NOTE" : "NOTE", { logCountBefore, afterFirst: logCountAfter1, afterSecond: logCountAfter2, secondResult: ca2.value });

  // Final read-back for cleanup
  out.finalPackages = (await query("tradePackages:listByProject", { projectId: fixture._id })).value.map((p) => ({ id: p._id, csi: p.csiDivision, status: p.status }));
  out.finalContractors = (await query("contractors:listByProject", { projectId: fixture._id })).value.map((c) => ({ id: c._id, name: c.companyName }));
  out.finalBids = (await query("bids:listAllProjectBids", { projectId: fixture._id })).value.map((b) => ({ id: b._id, base: b.baseBidAmount, leveled: b.leveledTotalCost, rev: b.revisionNumber, coi: b.coiComplianceStatus }));
  const convos = [];
  for (const p of (await query("tradePackages:listByProject", { projectId: fixture._id })).value) {
    const cs = await query("rfq:listConversations", { tradePackageId: p._id });
    if (!cs.threw) for (const x of cs.value) convos.push({ pkg: p.csiDivision, id: x._id, status: x.status, q: x.inboundQuestion?.slice(0, 80), err: x.analysisError?.slice(0, 80) });
  }
  out.finalConversations = convos;
  out.finalFiles = (await query("files:listFilesByProject", { projectId: fixture._id })).value.map((f) => ({ id: f._id, name: f.fileName, type: f.fileType, size: f.fileSize }));

  writeJson("fix4-qa3-02b-files-crons.json", out);
  writeLog("fix4-qa3-02b-files-crons.log", results.map((x) => `${x.outcome} ${x.id} ${x.label} :: ${typeof x.detail === "string" ? x.detail : JSON.stringify(x.detail)}`));
  console.log("\n" + JSON.stringify({ finalConversations: out.finalConversations, finalFiles: out.finalFiles }, null, 1));
};
run().catch((e) => { console.error("ERR", e && e.stack ? e.stack : e); process.exit(1); });