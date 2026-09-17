// QA-6 adversarial read-only probe: malformed / nonexistent / cross-project IDs.
// Usage: node scripts/qa-rem/qa6-bad-id-probe.mjs
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

function safeJson(v, max = 600) {
  try {
    const s = JSON.stringify(v);
    return s.length > max ? s.slice(0, max) + `…(truncated ${s.length} chars)` : s;
  } catch {
    return String(v);
  }
}

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
      ? Object.fromEntries(Object.entries(result).slice(0, 8))
      : result;
    log(`PASS  ${label} :: args=${argsPreview} :: ${elapsed}ms :: ${safeJson(summary)}`);
    return { ok: true, result };
  } catch (err) {
    const elapsed = Date.now() - started;
    log(
      `ERR   ${label} :: args=${argsPreview} :: ${elapsed}ms :: name=${err?.name} :: message=${String(
        err?.message
      ).split("\n")[0]} :: data=${safeJson(err?.data)}`
    );
    return { ok: false, error: err };
  }
}

log("=== QA-6 BAD-ID / CROSS-PROJECT READ PROBE (read-only queries) ===");
log(`Backend: ${BACKEND}`);
log(`UTC    : ${new Date().toISOString()}`);
log("");

const projects = await probe("projects:listProjects", () => client.query("projects:listProjects"), "{}");
const all = Array.isArray(projects.result) ? projects.result : [];
const demo = all.find((p) => p.isDemoProject) || all.find((p) => /Domain Tower/i.test(p.title || ""));
const qaProjects = all.filter((p) => /^QA-REM-/.test(p.title || ""));
log(`projects total=${all.length} demo=${demo ? demo._id : "NONE"} qa-rem-count=${qaProjects.length}`);
if (demo) log(`  demo project: "${demo.title}" isDemoProject=${demo.isDemoProject}`);
for (const p of qaProjects.slice(-5)) log(`  QA-REM project: ${p._id} "${p.title}" created=${p._creationTime}`);
log("");

log("--- malformed / nonexistent / wrong-table IDs ---");
await probe("projects:getProject", () => client.query("projects:getProject", { projectId: "abc" }), 'projectId="abc"');
await probe(
  "projects:getProject",
  () => client.query("projects:getProject", { projectId: "proj_domain_tower" }),
  'projectId="proj_domain_tower" (mock id)'
);
await probe(
  "projects:getProject",
  () => client.query("projects:getProject", { projectId: "jx70000000000000000000000000000000" }),
  'projectId="jx700…000" (valid shape, nonexistent)'
);
await probe(
  "projects:getProject",
  () => client.query("projects:getProject", { projectId: "" }),
  'projectId=""'
);
await probe(
  "projects:getProject",
  () => client.query("projects:getProject", { projectId: 12345 }),
  'projectId=12345 (number)'
);
await probe(
  "tradePackages:getPackage",
  () => client.query("tradePackages:getPackage", { tradePackageId: "pkg_spec_26" }),
  'tradePackageId="pkg_spec_26" (mock id)'
);
await probe(
  "tradePackages:getPackage",
  () => client.query("tradePackages:getPackage", { tradePackageId: "jx70000000000000000000000000000000" }),
  'tradePackageId="jx700…000" (nonexistent)'
);
await probe(
  "tradePackages:getPackage",
  () => client.query("tradePackages:getPackage", { tradePackageId: demo?._id }),
  "tradePackageId=<projects table id> (wrong table)"
);
await probe(
  "files:listFilesByProject",
  () => client.query("files:listFilesByProject", { projectId: "proj_domain_tower" }),
  'projectId="proj_domain_tower"'
);
await probe(
  "files:listFilesByProject",
  () => client.query("files:listFilesByProject", { projectId: "jx70000000000000000000000000000000" }),
  'projectId="jx700…000"'
);
await probe(
  "bids:listAllProjectBids",
  () => client.query("bids:listAllProjectBids", { projectId: "not-an-id" }),
  'projectId="not-an-id"'
);
await probe(
  "bids:listAllProjectBids",
  () => client.query("bids:listAllProjectBids", { projectId: "jx70000000000000000000000000000000" }),
  'projectId="jx700…000"'
);
await probe(
  "bids:listByPackage",
  () => client.query("bids:listByPackage", { tradePackageId: "jx70000000000000000000000000000000" }),
  'tradePackageId="jx700…000"'
);
await probe(
  "rfq:listConversations",
  () => client.query("rfq:listConversations", { tradePackageId: "guest" }),
  'tradePackageId="guest"'
);
await probe(
  "contractors:listByProject",
  () => client.query("contractors:listByProject", { projectId: "ctr_mock" }),
  'projectId="ctr_mock"'
);
await probe(
  "agreements:listAgreements",
  () => client.query("agreements:listAgreements", { projectId: "agr_mock" }),
  'projectId="agr_mock"'
);
await probe(
  "agreements:getAgreementByBid",
  () => client.query("agreements:getAgreementByBid", { bidId: "bid_mock" }),
  'bidId="bid_mock"'
);
await probe(
  "coordination:detectCrossTradeClashes",
  () => client.query("coordination:detectCrossTradeClashes", { projectId: "proj_mock" }),
  'projectId="proj_mock"'
);
await probe(
  "auditLogs:listRecentLogs",
  () => client.query("auditLogs:listRecentLogs", { projectId: "proj_mock" }),
  'projectId="proj_mock"'
);
await probe(
  "evals:listTracesForRun",
  () => client.query("evals:listTracesForRun", { runId: "eval_does_not_exist" }),
  'runId="eval_does_not_exist"'
);
log("");

log("--- cross-project isolation (existing projects) ---");
if (demo) {
  const demoPkgs = await probe(
    "tradePackages:listByProject(demo)",
    () => client.query("tradePackages:listByProject", { projectId: demo._id }),
    `projectId=${demo._id}`
  );
  const demoFiles = await probe(
    "files:listFilesByProject(demo)",
    () => client.query("files:listFilesByProject", { projectId: demo._id }),
    `projectId=${demo._id}`
  );
  const demoBids = await probe(
    "bids:listAllProjectBids(demo)",
    () => client.query("bids:listAllProjectBids", { projectId: demo._id }),
    `projectId=${demo._id}`
  );
  const demoTitles = new Set((demoPkgs.result || []).map((p) => p._id));
  const strayFiles = (demoFiles.result || []).filter((f) => f.projectId !== demo._id);
  const strayBids = (demoBids.result || []).filter((b) => !demoTitles.has(b.tradePackageId));
  log(
    `CROSS-CHECK demo: packages=${(demoPkgs.result || []).length} files=${
      (demoFiles.result || []).length
    } files-with-foreign-projectId=${strayFiles.length} bids=${(demoBids.result || []).length} bids-not-in-demo-packages=${strayBids.length}`
  );
}
const qa = qaProjects[qaProjects.length - 1];
if (qa) {
  const qaPkgs = await probe(
    "tradePackages:listByProject(QA-REM)",
    () => client.query("tradePackages:listByProject", { projectId: qa._id }),
    `projectId=${qa._id}`
  );
  const qaFiles = await probe(
    "files:listFilesByProject(QA-REM)",
    () => client.query("files:listFilesByProject", { projectId: qa._id }),
    `projectId=${qa._id}`
  );
  const pkgIds = new Set((qaPkgs.result || []).map((p) => p._id));
  const stray = (qaFiles.result || []).filter((f) => f.projectId !== qa._id);
  log(
    `CROSS-CHECK QA-REM "${qa.title}": packages=${(qaPkgs.result || []).length} files=${
      (qaFiles.result || []).length
    } files-with-foreign-projectId=${stray.length} pkgIds=${pkgIds.size}`
  );
  // Read a package that belongs to a different project than requested packaging scope.
  if ((qaPkgs.result || []).length > 0) {
    const foreignPkg = qaPkgs.result[0]._id;
    await probe(
      "bids:listByPackage(QA-REM pkg)",
      () => client.query("bids:listByPackage", { tradePackageId: foreignPkg }),
      `tradePackageId=${foreignPkg}`
    );
  }
}
log("");
log(`Total elapsed ${Date.now() - t0}ms`);
log("");
log("NOTE: This deployment has NO auth layer (documented in audit as intentional shared-GC demo model).");
log("      Cross-project reads succeeded where data exists; that is expected under the no-auth model.");
log("      The probe goal is clean, non-500 errors for malformed/nonexistent IDs.");

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const dest = path.join(EVIDENCE_DIR, "remediation-qa6-bad-id-probe.txt");
fs.writeFileSync(dest, lines.join("\n") + "\n", "utf8");
console.log(`Wrote ${dest}`);