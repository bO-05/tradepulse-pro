import { ConvexHttpClient } from "convex/browser";

const url = process.argv[2] || "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(url);

const sampleSpec = `SECTION 01 00 00 - SUMMARY OF WORK
General Contractor shall furnish all temporary site utilities, crane access, and safety coordination.
All subcontractors must carry $5,000,000 umbrella liability and name Owner and General Contractor as additional insureds under ACORD 25.

SECTION 26 00 00 - ELECTRICAL SPECIFICATIONS
Furnish and install 1600A 480/277V Main Distribution Switchboard, dry-type step-down transformers, and emergency lighting inverters. Subcontractor is strictly responsible for crane hoisting and rigging of heavy switchgear to the 14th-floor penthouse equipment room. Provide UL 1479 compliant penetrations and IBC Section 1613 seismic bracing for all conduits and cable trays.

SECTION 23 00 00 - HEATING, VENTILATING, AND AIR CONDITIONING (HVAC)
Furnish and install rooftop air handling units, variable air volume (VAV) terminal boxes with electric reheat coils, and hydronic chiller loops. Includes BACnet MS/TP automation protocol integration gateways to central building management system. Subcontractor must provide sound attenuators and vibration isolation springs.

SECTION 22 00 00 - PLUMBING SYSTEMS
Furnish and install domestic cold, hot, and recirculated water piping, sanitary waste, vent piping, and triplex domestic water booster pump system. Subcontractor must provide factory certified startup technician commissioning, seismic snubbers, and shock arrestors.`;

const title = `QA-REM-F6-LIVE-${Date.now()}`;
const projectId = await client.mutation("projects:createProject", {
  title,
  location: "Austin, TX",
  projectType: "QA F6 Verification",
  estBudget: 4000000,
  targetCompletionWeeks: 48,
  specDocumentText: sampleSpec,
  isDemoProject: false,
});

console.log("DEPLOYMENT:", url);
console.log("PROJECT:", projectId);

const started = Date.now();
try {
  const res = await client.action("tradePackages:generateTradePackagesFromSpec", {
    projectId,
    specDocumentTextOverride: sampleSpec,
  });
  const elapsed = Date.now() - started;
  console.log(`F6a action completed in ${(elapsed / 1000).toFixed(1)}s`);
  console.log("F6a result:", JSON.stringify({ success: res?.success, packagesCount: res?.packagesCount, packageIds: res?.packageIds }));
  const pkgs = await client.query("tradePackages:listByProject", { projectId });
  console.log(`F6b persisted packages: ${pkgs.length}`);
  for (const p of pkgs) console.log(`- ${p.csiDivision} | ${p.tradeName} | $${p.budgetEstimate}`);
  console.log(pkgs.length > 0 && res?.success ? "F6 RESULT: PASS" : "F6 RESULT: FAIL");
} catch (err) {
  console.log(`F6a action FAILED after ${((Date.now() - started) / 1000).toFixed(1)}s: ${err?.message || err}`);
  const pkgs = await client.query("tradePackages:listByProject", { projectId });
  console.log(`F6b persisted packages: ${pkgs.length}`);
  console.log("F6 RESULT: FAIL");
  process.exitCode = 1;
}