// QA-10 fixture setup: creates ONE throwaway QA-REM-QA10-UI-* project with a single
// Div 26 package (no contractors). Used by the browser sweep + two-context realtime dock test.
// Writes remediation-qa10-fixture.json for downstream scripts.
// Usage: node scripts/qa-rem/qa10-setup-fixture.mjs
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const TAG = `QA-REM-QA10-UI-${Date.now()}`;

const client = new ConvexHttpClient(BACKEND);

const projectId = await client.mutation("projects:createProject", {
  title: TAG,
  location: "Austin, TX",
  projectType: "commercial",
  estBudget: 2400000,
  targetCompletionWeeks: 52,
  specDocumentText:
    "QA-10 UI/realtime fixture. Division 26 electrical scope: switchgear, feeders, emergency lighting, seismic bracing.",
  isDemoProject: false,
});

const packageId = await client.mutation("tradePackages:createTradePackage", {
  projectId,
  csiDivision: "26 00 00",
  tradeName: "Electrical & Lighting Systems (QA-10 UI)",
  budgetEstimate: 1200000,
  scopeSummary:
    "QA-10 UI fixture electrical scope: 1600A switchgear, penthouse feeders, emergency lighting, seismic bracing.",
  mandatoryInclusions: ["Switchgear", "Seismic bracing", "Temporary power"],
  bidDeadline: "2026-12-31",
});

const fixture = {
  tag: TAG,
  backend: BACKEND,
  projectId,
  packageId,
  createdAt: new Date().toISOString(),
};
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa10-fixture.json"), JSON.stringify(fixture, null, 2), "utf8");
console.log(JSON.stringify(fixture, null, 2));