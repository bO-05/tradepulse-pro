import { ConvexHttpClient } from "convex/browser";

const url = process.argv[2] || "https://brainy-skunk-440.convex.cloud";
const siteUrl = url.replace(".convex.cloud", ".convex.site");
const client = new ConvexHttpClient(url);
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
};

// 1) Repair seeded document sizes and verify metadata == served bytes
const repair = await client.mutation("files:repairSeededDocumentSizes", {});
console.log("repaired file sizes:", JSON.stringify(repair));
const projects = await client.query("projects:listProjects", {});
const demo = projects.find((p) => p.isDemoProject);
const demoFiles = await client.query("files:listFilesByProject", { projectId: demo._id });
let sizeMatches = 0;
for (const file of demoFiles) {
  if (!file.storageId.startsWith("/")) continue;
  const resp = await fetch(`${siteUrl}${file.storageId}`);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  const match = bytes.length === file.fileSize;
  if (match) sizeMatches += 1;
  console.log(`- ${file.fileName}: served=${bytes.length} metadata=${file.fileSize} ${match ? "OK" : "MISMATCH"}`);
}
check("Demo document metadata matches served bytes", sizeMatches === demoFiles.filter((f) => f.storageId.startsWith("/")).length && sizeMatches > 0, `${sizeMatches} files`);

// 2) Fixture: clash resolution persists across detect calls
const title = `QA-REM-R6-${Date.now()}`;
const projectId = await client.mutation("projects:createProject", {
  title,
  location: "Austin, TX",
  projectType: "QA R6",
  estBudget: 3000000,
  targetCompletionWeeks: 40,
  specDocumentText: "QA round 6 fixture.",
  isDemoProject: false,
});
const elecPkg = await client.mutation("tradePackages:createTradePackage", {
  projectId, csiDivision: "26 00 00", tradeName: "QA R6 Electrical", budgetEstimate: 1250000,
  scopeSummary: "QA scope", mandatoryInclusions: ["Code compliance"], bidDeadline: "2026-10-31",
});
const hvacPkg = await client.mutation("tradePackages:createTradePackage", {
  projectId, csiDivision: "23 00 00", tradeName: "QA R6 HVAC", budgetEstimate: 1500000,
  scopeSummary: "QA scope", mandatoryInclusions: ["Code compliance"], bidDeadline: "2026-10-31",
});
const before = await client.query("coordination:detectCrossTradeClashes", { projectId });
check("Clash detection populated for 2-package project", before.doubleBuys.length === 2 && before.scopeVoids.length === 2, `active=${before.summary.activeClashesCount}`);
const deducted = await client.mutation("coordination:deductDoubleBuyCredit", {
  projectId, clashId: "clash-vfd-01", tradePackageId: elecPkg, deductAmount: 38500, description: "VFD double-buy",
});
check("Deduct credit recorded", deducted.success === true, JSON.stringify(deducted.note || deducted.newLeveledCost));
const after = await client.query("coordination:detectCrossTradeClashes", { projectId });
const vfd = after.doubleBuys.find((d) => d.id === "clash-vfd-01");
check("Resolved clash stays deducted after re-detect", vfd?.status === "deducted", `active=${after.summary.activeClashesCount}/${after.summary.totalDoubleBuyExposure}`);
const voids = await client.mutation("coordination:assignScopeVoidToTrade", {
  projectId, voidId: "void-bas-wiring-01", tradePackageId: elecPkg, additionalCost: 28000, description: "BAS wiring void",
});
check("Assign scope void recorded", voids.success === true);
const afterVoid = await client.query("coordination:detectCrossTradeClashes", { projectId });
const bas = afterVoid.scopeVoids.find((v) => v.id === "void-bas-wiring-01");
check("Assigned void stays assigned after re-detect", bas?.status === "assigned", `active=${afterVoid.summary.activeClashesCount}`);

// 3) Bid revision increments
const contractorId = await client.mutation("contractors:createContractor", {
  tradePackageId: elecPkg, companyName: "QA R6 Electric", contactEmail: "qa.r6@tradepulse-pro.test",
  phone: "+1 (512) 555-0188", licenseNumber: "QA-R6-01", licenseStatus: "Active / Verified",
  sourceUrl: "https://tradepulse-pro.test/r6", rfqStatus: "invited",
});
await client.mutation("bids:submitDirectBid", { tradePackageId: elecPkg, contractorId, subcontractorName: "QA R6 Electric", baseBidAmount: 1100000 });
await client.mutation("bids:submitDirectBid", { tradePackageId: elecPkg, contractorId, subcontractorName: "QA R6 Electric", baseBidAmount: 1150000 });
const bids = await client.query("bids:listByPackage", { tradePackageId: elecPkg });
const bid = bids.find((b) => b.contractorId === contractorId);
check("Re-ingested bid shows revision 2", bid?.revisionNumber === 2 && typeof bid?.lastRevisedAt === "number", `rev=${bid?.revisionNumber}`);

// Cleanup fixture
await client.mutation("projects:deleteProject", { projectId });
const remaining = await client.query("projects:listProjects", {});
check("Fixture cleaned up; demo intact", remaining.length === 1 && remaining[0].isDemoProject === true, `projects=${remaining.length}`);

const failed = results.filter((r) => !r.ok);
console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length === 0 ? 0 : 1;