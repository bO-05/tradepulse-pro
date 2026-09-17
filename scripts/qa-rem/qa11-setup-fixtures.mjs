// QA-11 fixture setup: creates TWO throwaway custom (non-demo) projects:
//   QA-REM-QA11-UI-*    : 1 Division 26 package, no contractors (mobile-overflow tabs + guest RFI)
//   QA-REM-QA11-EMPTY-* : 0 packages (Scope Clash empty + KPI Buyout 0/0)
// Writes remediation-qa11-fixtures.json. Usage: node scripts/qa-rem/qa11-setup-fixtures.mjs
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const TS = Date.now();
const UI_TAG = `QA-REM-QA11-UI-${TS}`;
const EMPTY_TAG = `QA-REM-QA11-EMPTY-${TS}`;

const client = new ConvexHttpClient(BACKEND);

const uiProjectId = await client.mutation("projects:createProject", {
  title: UI_TAG,
  location: "Austin, TX",
  projectType: "commercial",
  estBudget: 2400000,
  targetCompletionWeeks: 52,
  specDocumentText:
    "QA-11 fixture. Division 26 electrical scope: switchgear, feeders, emergency lighting, seismic bracing.",
  isDemoProject: false,
});

const packageId = await client.mutation("tradePackages:createTradePackage", {
  projectId: uiProjectId,
  csiDivision: "26 00 00",
  tradeName: "Electrical & Lighting Systems (QA-11)",
  budgetEstimate: 1200000,
  scopeSummary:
    "QA-11 fixture electrical scope: 1600A switchgear, penthouse feeders, emergency lighting, seismic bracing.",
  mandatoryInclusions: ["Switchgear", "Seismic bracing", "Temporary power"],
  bidDeadline: "2026-12-31",
});

const emptyProjectId = await client.mutation("projects:createProject", {
  title: EMPTY_TAG,
  location: "Austin, TX",
  projectType: "commercial",
  estBudget: 900000,
  targetCompletionWeeks: 40,
  specDocumentText: "QA-11 zero-package fixture (empty).",
  isDemoProject: false,
});

const fixtures = {
  at: new Date().toISOString(),
  backend: BACKEND,
  ui: { tag: UI_TAG, projectId: uiProjectId, packageId },
  empty: { tag: EMPTY_TAG, projectId: emptyProjectId },
};
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa11-fixtures.json"), JSON.stringify(fixtures, null, 2), "utf8");
console.log(JSON.stringify(fixtures, null, 2));