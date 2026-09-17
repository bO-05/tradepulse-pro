// QA-13 (round 6) preflight + fixture setup for live P3/P4 closure verification.
// Creates ONLY QA-REM-* fixtures. Never touches the seeded demo project.
// Usage: node scripts/qa-rem/qa13-setup.mjs
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

const url = process.argv[2] || "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(url);
const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const LOG = [];
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};

async function fingerprint() {
  const projects = await client.query("projects:listProjects", {});
  const demo = projects.find((p) => p.isDemoProject);
  const out = {
    totalProjects: projects.length,
    nonDemoTitles: projects.filter((p) => !p.isDemoProject).map((p) => p.title),
    demo: null,
  };
  if (demo) {
    const pkgs = await client.query("tradePackages:listByProject", { projectId: demo._id });
    const bids = await client.query("bids:listAllProjectBids", { projectId: demo._id });
    const files = await client.query("files:listFilesByProject", { projectId: demo._id });
    const agrs = await client.query("agreements:listAgreements", { projectId: demo._id });
    let convCount = 0;
    for (const p of pkgs) {
      convCount += (await client.query("rfq:listConversations", { tradePackageId: p._id })).length;
    }
    out.demo = {
      id: demo._id,
      title: demo.title,
      packages: pkgs.length,
      bids: bids.length,
      files: files.length,
      agreements: agrs.length,
      conversations: convCount,
    };
  }
  return out;
}

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(2, 14);
const EMPTY_TITLE = `QA-REM-QA13-EMPTY-${stamp}`;
const CLASH_TITLE = `QA-REM-QA13-CLASH-${stamp}`;

async function run() {
  ev("=== QA-13 SETUP / PREFLIGHT ===");
  ev(`UTC: ${new Date().toISOString()}`);
  ev(`Backend: ${url}`);

  const before = await fingerprint();
  ev(`Preflight projects: ${before.totalProjects} total; non-demo=${JSON.stringify(before.nonDemoTitles)}`);
  ev(`Demo fingerprint before: ${JSON.stringify(before.demo)}`);
  const foreign = before.nonDemoTitles.filter((t) => !t.startsWith("QA-REM-"));
  if (foreign.length > 0) {
    throw new Error(
      `PREFLIGHT FAILED: unexpected non-demo, non-QA-REM project(s): ${JSON.stringify(foreign)}`
    );
  }
  const otherQaRem = before.nonDemoTitles.filter((t) => !t.includes("QA13"));
  if (otherQaRem.length > 0) {
    ev(
      `[preflight] NOTE: other QA-REM fixture(s) present (likely a concurrent round-6 agent). QA-13 will NOT delete these: ${JSON.stringify(otherQaRem)}`
    );
  }

  ev("");
  ev("[setup] creating empty fixture");
  const emptyProjectId = await client.mutation("projects:createProject", {
    title: EMPTY_TITLE,
    location: "Austin, TX",
    projectType: "QA Fixture - Empty State",
    estBudget: 650000,
    targetCompletionWeeks: 26,
    specDocumentText:
      "QA-REM QA13 empty fixture. Zero trade packages are intentionally configured to exercise empty-state CTAs and the loading skeleton.",
    isDemoProject: false,
    generalContractorName: "QA-REM QA13 Harness",
  });
  ev(`    emptyProjectId=${emptyProjectId}`);

  ev("[setup] creating clash fixture (Div 26 + Div 23 packages + 1 contractor)");
  const clashProjectId = await client.mutation("projects:createProject", {
    title: CLASH_TITLE,
    location: "Austin, TX",
    projectType: "QA Fixture - Cross-Trade Clash",
    estBudget: 2500000,
    targetCompletionWeeks: 30,
    specDocumentText:
      "QA-REM QA13 clash fixture. Division 26 Electrical and Division 23 HVAC packages used to verify clash resolution persistence and bid revision markers.",
    isDemoProject: false,
    generalContractorName: "QA-REM QA13 Harness",
  });
  const pkg26 = await client.mutation("tradePackages:createTradePackage", {
    projectId: clashProjectId,
    csiDivision: "26 00 00",
    tradeName: "Electrical & Lighting Systems",
    budgetEstimate: 1500000,
    scopeSummary:
      "QA-REM fixture electrical scope: main switchgear, distribution, lighting and controls.",
    mandatoryInclusions: ["Crane hoisting to penthouse switchgear room", "Seismic bracing"],
    bidDeadline: "2026-12-31",
  });
  const pkg23 = await client.mutation("tradePackages:createTradePackage", {
    projectId: clashProjectId,
    csiDivision: "23 00 00",
    tradeName: "Heating, Ventilating & Air Conditioning",
    budgetEstimate: 1500000,
    scopeSummary:
      "QA-REM fixture HVAC scope: rooftop AHUs, chilled water distribution, VAV terminals and controls.",
    mandatoryInclusions: ["Rooftop crane pick and rigging", "TAB air balancing"],
    bidDeadline: "2026-12-31",
  });
  const contractorId = await client.mutation("contractors:createContractor", {
    tradePackageId: pkg26,
    companyName: "QA-REM QA13 Electric LLC",
    contactEmail: "qa13.electric@example.org",
    licenseNumber: "QA13-TX-LIC-0001",
    licenseStatus: "Active / Verified (TX)",
    sourceUrl: "https://example.org/qa13-electric",
    rfqStatus: "invited",
  });
  ev(`    clashProjectId=${clashProjectId}`);
  ev(`    pkg26=${pkg26}`);
  ev(`    pkg23=${pkg23}`);
  ev(`    contractorId=${contractorId}`);

  const fixture = {
    createdAt: new Date().toISOString(),
    backend: url,
    emptyProjectId,
    emptyProjectTitle: EMPTY_TITLE,
    clashProjectId,
    clashProjectTitle: CLASH_TITLE,
    pkg26,
    pkg23,
    contractorId,
    contractorName: "QA-REM QA13 Electric LLC",
  };
  const fixturePath = path.join(EVIDENCE_DIR, "remediation-qa13-fixtures.json");
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), "utf8");
  ev(`fixture written: ${fixturePath}`);

  const after = await fingerprint();
  ev(`Demo fingerprint after setup: ${JSON.stringify(after.demo)}`);
  ev(`Projects now: ${JSON.stringify(after.nonDemoTitles)}`);

  const logPath = path.join(EVIDENCE_DIR, "remediation-qa13-setup.txt");
  fs.writeFileSync(logPath, LOG.join("\n") + "\n", "utf8");
  console.log(`Wrote ${logPath}`);
}

run().catch((e) => {
  console.error("SETUP FAILED:", e && e.message ? e.message : e);
  if (e && e.data) console.error(JSON.stringify(e.data));
  process.exit(1);
});