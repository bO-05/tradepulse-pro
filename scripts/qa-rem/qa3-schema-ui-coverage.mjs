import fs from "fs";
import path from "path";

const SRC_DIR = path.resolve("src");
const TABLE_FIELDS = {
  projects: ["title", "location", "projectType", "estBudget", "targetCompletionWeeks", "specDocumentText", "isDemoProject", "generalContractorName", "createdAt"],
  tradePackages: ["projectId", "csiDivision", "tradeName", "budgetEstimate", "agentMailbox", "agentMailboxId", "scopeSummary", "mandatoryInclusions", "bidDeadline", "status"],
  contractors: ["tradePackageId", "companyName", "contactEmail", "phone", "licenseNumber", "licenseStatus", "sourceUrl", "rfqStatus", "dispatchedAt"],
  conversations: ["tradePackageId", "contractorId", "threadId", "inboundSubject", "inboundQuestion", "autonomousReply", "confidenceScore", "status", "pmCertifiedAt", "pmCertifiedBy", "reviewNote", "timestamp"],
  bids: ["tradePackageId", "contractorId", "subcontractorName", "baseBidAmount", "lineItems", "identifiedExclusions", "valueEngineeringAlternates", "longLeadEquipmentWeeks", "leadTimePenalty", "coiComplianceStatus", "coiPenalty", "leveledTotalCost", "isAwarded", "sourceFileId", "receivedAt"],
  agreements: ["projectId", "tradePackageId", "bidId", "contractorId", "agreementNumber", "documentTitle", "subcontractorName", "subcontractorEmail", "generalContractorName", "projectTitle", "projectLocation", "csiDivision", "tradeName", "contractSum", "retainagePercent", "liquidatedDamagesDaily", "scopeSummary", "mandatoryInclusions", "status", "contractText", "executedAt", "createdAt"],
  projectFiles: ["projectId", "tradePackageId", "storageId", "fileName", "fileType", "fileSize", "uploadedBy", "uploadedAt", "textContent"],
  auditLogs: ["projectId", "tradePackageId", "eventType", "title", "description", "actor", "timestamp"],
  evalRuns: ["runId", "targetEnvironment", "triggeredBy", "totalCases", "passedCases", "scopeRecallAvg", "scopePrecisionAvg", "leveledCostMape", "veAccuracyAvg", "coiF1Score", "clashRecallAvg", "aiaConformityAvg", "overallScore", "totalDurationMs", "createdAt"],
  agentTraces: ["runId", "caseId", "csiDivision", "contractorName", "provider", "model", "rawPrompt", "systemPrompt", "rawResponse", "parsedOutput", "groundTruth", "metrics", "status", "latencyMs", "inputTokens", "outputTokens", "costUsd", "timestamp"],
};

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
}
const files = walk(SRC_DIR);
const corpus = files.map((f) => ({ rel: path.relative(process.cwd(), f).replace(/\\/g, "/"), text: fs.readFileSync(f, "utf8") }));

console.log("SCHEMA FIELD -> UI SURFACING REPORT (src/ token scan)");
console.log(`Scanned ${files.length} files under src/\n`);
for (const [table, fields] of Object.entries(TABLE_FIELDS)) {
  console.log(`### ${table}`);
  for (const field of fields) {
    const re = new RegExp(`\\b${field}\\b`);
    const hits = corpus.filter((c) => re.test(c.text));
    const verdict = hits.length === 0 ? "NO-SRC-REFERENCE" : `${hits.length} file(s)`;
    const sample = hits.slice(0, 3).map((h) => h.rel).join(", ");
    console.log(`  ${field.padEnd(28)} ${verdict.padEnd(20)} ${sample}`);
  }
  console.log("");
}