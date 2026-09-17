import { ConvexHttpClient } from "convex/browser";

const url = process.argv[2] || "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(url);
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
};

// O1 fixture: both packages, zero bids -> no clashes; after one bid -> clashes appear
const title = `QA-REM-R7-O1-${Date.now()}`;
const projectId = await client.mutation("projects:createProject", {
  title, location: "Austin, TX", projectType: "QA R7", estBudget: 3000000,
  targetCompletionWeeks: 40, specDocumentText: "QA R7 O1 fixture.", isDemoProject: false,
});
const elecPkg = await client.mutation("tradePackages:createTradePackage", {
  projectId, csiDivision: "26 00 00", tradeName: "QA R7 Electrical", budgetEstimate: 1250000,
  scopeSummary: "QA scope", mandatoryInclusions: ["Code compliance"], bidDeadline: "2026-10-31",
});
const hvacPkg = await client.mutation("tradePackages:createTradePackage", {
  projectId, csiDivision: "23 00 00", tradeName: "QA R7 HVAC", budgetEstimate: 1500000,
  scopeSummary: "QA scope", mandatoryInclusions: ["Code compliance"], bidDeadline: "2026-10-31",
});
check("fixture has both packages", Boolean(elecPkg && hvacPkg));

const zeroBid = await client.query("coordination:detectCrossTradeClashes", { projectId });
check(
  "O1: zero-bid 2-package project shows no clash cards",
  zeroBid.doubleBuys.length === 0 && zeroBid.scopeVoids.length === 0 && zeroBid.summary.activeClashesCount === 0,
  `active=${zeroBid.summary.activeClashesCount}`
);

const contractorId = await client.mutation("contractors:createContractor", {
  tradePackageId: elecPkg, companyName: "QA R7 Electric", contactEmail: "qa.r7@tradepulse-pro.test",
  phone: "+1 (512) 555-0177", licenseNumber: "QA-R7-01", licenseStatus: "Active / Verified",
  sourceUrl: "https://tradepulse-pro.test/r7", rfqStatus: "invited",
});
await client.mutation("bids:submitDirectBid", {
  tradePackageId: elecPkg, contractorId, subcontractorName: "QA R7 Electric", baseBidAmount: 1180000,
});
const withBid = await client.query("coordination:detectCrossTradeClashes", { projectId });
check(
  "O1: clash set appears once bid evidence exists",
  withBid.doubleBuys.length === 2 && withBid.scopeVoids.length === 2,
  `active=${withBid.summary.activeClashesCount}`
);

// Demo must keep its clashes (has bids)
const projects = await client.query("projects:listProjects", {});
const demo = projects.find((p) => p.isDemoProject);
const demoClashes = await client.query("coordination:detectCrossTradeClashes", { projectId: demo._id });
check("Demo project still shows conflicts", demoClashes.doubleBuys.length === 2, `active=${demoClashes.summary.activeClashesCount}`);

// Cleanup
await client.mutation("projects:deleteProject", { projectId });
const remaining = await client.query("projects:listProjects", {});
check("Cleanup; demo intact", remaining.length === 1 && remaining[0].isDemoProject === true, `projects=${remaining.length}`);

const failed = results.filter((r) => !r.ok);
console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length === 0 ? 0 : 1;