// QA-8 (round 3) adversarial read-only probe: malformed / nonexistent / wrong-project / wrong-table IDs.
// Queries only; no mutations. Usage: node scripts/qa-rem/qa8-bad-id-probe.mjs
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

const BACKEND = "https://brainy-skunk-440.convex.cloud";
const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const client = new ConvexHttpClient(BACKEND);

const lines = [];
const t0 = Date.now();
const log = (s) => {
  lines.push(s);
  console.log(s);
};

function safeJson(v, max = 400) {
  try {
    const s = JSON.stringify(v);
    return s.length > max ? s.slice(0, max) + `…(truncated ${s.length} chars)` : s;
  } catch {
    return String(v);
  }
}

const NX = "jx70000000000000000000000000000000"; // syntactically valid, nonexistent

async function probe(label, fn, argsPreview) {
  const started = Date.now();
  try {
    const result = await fn();
    const elapsed = Date.now() - started;
    const summary = Array.isArray(result)
      ? { type: "array", length: result.length, first: result[0] ?? null }
      : result === null
      ? null
      : typeof result === "object"
      ? Object.fromEntries(Object.entries(result).slice(0, 6))
      : result;
    log(`OK    ${label} :: args=${argsPreview} :: ${elapsed}ms :: ${safeJson(summary)}`);
    return { ok: true, result };
  } catch (err) {
    const elapsed = Date.now() - started;
    log(
      `ERR   ${label} :: args=${argsPreview} :: ${elapsed}ms :: name=${err?.name} :: message=${String(
        err?.message
      )
        .split("\n")
        .slice(0, 2)
        .join(" | ")} :: data=${safeJson(err?.data)}`
    );
    return { ok: false, error: err };
  }
}

log("=== QA-8 BAD-ID / CROSS-PROJECT READ PROBE (read-only queries) ===");
log(`Backend: ${BACKEND}`);
log(`UTC    : ${new Date().toISOString()}`);
log("");

const projectsP = await probe("projects:listProjects", () => client.query("projects:listProjects"), "{}");
const all = Array.isArray(projectsP.result) ? projectsP.result : [];
const demo = all.find((p) => p.isDemoProject) || all.find((p) => /Domain Tower/i.test(p.title || ""));
const qaProjects = all.filter((p) => /^QA-REM-/.test(p.title || ""));
log(`projects total=${all.length} demo=${demo?._id} qa-rem-count=${qaProjects.length}`);
if (demo) log(`  demo: "${demo.title}" isDemoProject=${demo.isDemoProject}`);
for (const p of qaProjects) log(`  QA-REM: ${p._id} "${p.title}" created=${p._creationTime}`);
log("");

log("--- 1) projects:getProject ---");
await probe("getProject(demo)", () => client.query("projects:getProject", { projectId: demo._id }), `demo id`);
await probe("getProject(nonexistent-shape)", () => client.query("projects:getProject", { projectId: NX }), `NX`);
await probe("getProject(malformed 'abc')", () => client.query("projects:getProject", { projectId: "abc" }), `"abc"`);
await probe("getProject(mock 'proj_domain_tower')", () => client.query("projects:getProject", { projectId: "proj_domain_tower" }), `"proj_domain_tower"`);
await probe("getProject(empty string)", () => client.query("projects:getProject", { projectId: "" }), `""`);
await probe("getProject(number 12345)", () => client.query("projects:getProject", { projectId: 12345 }), `12345`);

log("");
log("--- 2) tradePackages:listByProject ---");
const demoPkgsP = await probe("listByProject(demo)", () => client.query("tradePackages:listByProject", { projectId: demo._id }), "demo id");
const demoPkgs = Array.isArray(demoPkgsP.result) ? demoPkgsP.result : [];
log(`      demo packages=${demoPkgs.length} ids=${demoPkgs.map((p) => `${p._id}${p.csiDivision ? `(${p.csiDivision})` : ""}`).join(", ").slice(0, 400)}`);
await probe("listByProject(nonexistent-shape)", () => client.query("tradePackages:listByProject", { projectId: NX }), "NX");
await probe("listByProject(malformed 'abc')", () => client.query("tradePackages:listByProject", { projectId: "abc" }), '"abc"');
await probe("listByProject(empty string)", () => client.query("tradePackages:listByProject", { projectId: "" }), '""');
await probe("listByProject(number)", () => client.query("tradePackages:listByProject", { projectId: 999 }), "999");

log("");
log("--- 3) bids:listByPackage ---");
const firstPkg = demoPkgs[0];
await probe("listByPackage(demo pkg)", () => client.query("bids:listByPackage", { tradePackageId: firstPkg?._id }), `pkg=${firstPkg?._id}`);
await probe("listByPackage(nonexistent-shape)", () => client.query("bids:listByPackage", { tradePackageId: NX }), "NX");
await probe("listByPackage(malformed 'pkg_spec_26')", () => client.query("bids:listByPackage", { tradePackageId: "pkg_spec_26" }), '"pkg_spec_26"');
await probe("listByPackage(empty string)", () => client.query("bids:listByPackage", { tradePackageId: "" }), '""');
await probe("listByPackage(project id = wrong table)", () => client.query("bids:listByPackage", { tradePackageId: demo._id }), "demo project id");

log("");
log("--- 4) files:listFilesByProject ---");
const demoFilesP = await probe("listFilesByProject(demo)", () => client.query("files:listFilesByProject", { projectId: demo._id }), "demo id");
const demoFiles = Array.isArray(demoFilesP.result) ? demoFilesP.result : [];
log(`      demo files=${demoFiles.length}`);
await probe("listFilesByProject(nonexistent-shape)", () => client.query("files:listFilesByProject", { projectId: NX }), "NX");
await probe("listFilesByProject(malformed 'proj_mock')", () => client.query("files:listFilesByProject", { projectId: "proj_mock" }), '"proj_mock"');
await probe("listFilesByProject(empty string)", () => client.query("files:listFilesByProject", { projectId: "" }), '""');

log("");
log("--- 5) agreements:listAgreements ---");
const demoAgrP = await probe("listAgreements(demo)", () => client.query("agreements:listAgreements", { projectId: demo._id }), "demo id");
const demoAgr = Array.isArray(demoAgrP.result) ? demoAgrP.result : [];
log(`      demo agreements=${demoAgr.length}`);
await probe("listAgreements(nonexistent-shape)", () => client.query("agreements:listAgreements", { projectId: NX }), "NX");
await probe("listAgreements(malformed 'agr_mock')", () => client.query("agreements:listAgreements", { projectId: "agr_mock" }), '"agr_mock"');
await probe("listAgreements(empty string)", () => client.query("agreements:listAgreements", { projectId: "" }), '""');

log("");
log("--- 6) rfq:listConversations ---");
const demoRfqP = await probe("listConversations(demo pkg)", () => client.query("rfq:listConversations", { tradePackageId: firstPkg?._id }), `pkg=${firstPkg?._id}`);
const demoRfq = Array.isArray(demoRfqP.result) ? demoRfqP.result : [];
log(`      demo conversations=${demoRfq.length}`);
await probe("listConversations(nonexistent-shape)", () => client.query("rfq:listConversations", { tradePackageId: NX }), "NX");
await probe("listConversations(malformed 'guest')", () => client.query("rfq:listConversations", { tradePackageId: "guest" }), '"guest"');
await probe("listConversations(empty string)", () => client.query("rfq:listConversations", { tradePackageId: "" }), '""');
await probe("listConversations(project id = wrong table)", () => client.query("rfq:listConversations", { tradePackageId: demo._id }), "demo project id");

log("");
log("--- 7) cross-project isolation of returned rows ---");
function ownerAudit(name, rows, key, expectedId) {
  const foreign = rows.filter((r) => String(r[key]) !== String(expectedId));
  log(`${foreign.length === 0 ? "CLEAN " : "LEAK  "}${name}: rows=${rows.length} foreign-${key}=${foreign.length}${foreign.length ? " :: " + safeJson(foreign.slice(0, 2).map((r) => ({ id: r._id, [key]: r[key] }))) : ""}`);
  return foreign.length;
}
let leaks = 0;
if (demo) {
  leaks += ownerAudit("tradePackages:listByProject(demo)", demoPkgs, "projectId", demo._id);
  leaks += ownerAudit("files:listFilesByProject(demo)", demoFiles, "projectId", demo._id);
  leaks += ownerAudit("agreements:listAgreements(demo)", demoAgr, "projectId", demo._id);
  if (firstPkg) {
    const bidsP = await probe("bids:listByPackage(demo pkg) [owner check]", () => client.query("bids:listByPackage", { tradePackageId: firstPkg._id }), firstPkg._id);
    leaks += ownerAudit("bids:listByPackage(demo pkg)", Array.isArray(bidsP.result) ? bidsP.result : [], "tradePackageId", firstPkg._id);
    const rfqP = await probe("rfq:listConversations(demo pkg) [owner check]", () => client.query("rfq:listConversations", { tradePackageId: firstPkg._id }), firstPkg._id);
    leaks += ownerAudit("rfq:listConversations(demo pkg)", Array.isArray(rfqP.result) ? rfqP.result : [], "tradePackageId", firstPkg._id);
  }
}
for (const qa of qaProjects) {
  const pkgsP = await probe(`tradePackages:listByProject(QA-REM "${qa.title}")`, () => client.query("tradePackages:listByProject", { projectId: qa._id }), qa._id);
  const pkgs = Array.isArray(pkgsP.result) ? pkgsP.result : [];
  leaks += ownerAudit(`tradePackages(QA-REM ${qa._id})`, pkgs, "projectId", qa._id);
  const filesP = await probe(`files:listFilesByProject(QA-REM ${qa._id})`, () => client.query("files:listFilesByProject", { projectId: qa._id }), qa._id);
  leaks += ownerAudit(`files(QA-REM ${qa._id})`, Array.isArray(filesP.result) ? filesP.result : [], "projectId", qa._id);
  const agrP = await probe(`agreements:listAgreements(QA-REM ${qa._id})`, () => client.query("agreements:listAgreements", { projectId: qa._id }), qa._id);
  leaks += ownerAudit(`agreements(QA-REM ${qa._id})`, Array.isArray(agrP.result) ? agrP.result : [], "projectId", qa._id);
  if (pkgs[0]) {
    const bP = await probe(`bids:listByPackage(QA-REM pkg ${pkgs[0]._id})`, () => client.query("bids:listByPackage", { tradePackageId: pkgs[0]._id }), pkgs[0]._id);
    leaks += ownerAudit(`bids(QA-REM pkg)`, Array.isArray(bP.result) ? bP.result : [], "tradePackageId", pkgs[0]._id);
    const rP = await probe(`rfq:listConversations(QA-REM pkg ${pkgs[0]._id})`, () => client.query("rfq:listConversations", { tradePackageId: pkgs[0]._id }), pkgs[0]._id);
    leaks += ownerAudit(`rfq(QA-REM pkg)`, Array.isArray(rP.result) ? rP.result : [], "tradePackageId", pkgs[0]._id);
  }
}
log("");
log(`CROSS-PROJECT FOREIGN-ROW TOTAL: ${leaks} (0 = no rows returned outside the requested parent)`);
log("");
log(`Total elapsed ${Date.now() - t0}ms`);
log("");
log("NOTE: deployment intentionally has no auth layer (shared demo model); reads are global by design.");
log("      This probe checks: malformed/nonexistent IDs produce clean non-crash errors and that");
log("      returned collections are scoped to the requested parent ID (no foreign-parent rows).");

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const dest = path.join(EVIDENCE_DIR, "remediation-qa8-bad-id-probe.txt");
fs.writeFileSync(dest, lines.join("\n") + "\n", "utf8");
console.log(`Wrote ${dest}`);