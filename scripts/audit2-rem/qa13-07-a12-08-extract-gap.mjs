import { client, call, writeEvidence, writeLog, deleteProjectHard } from "./qa13-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${detail}`);
};

async function main() {
  const title = "AUDIT-QA13-INGEST2";
  const projId = await c.mutation("projects:createProject", {
    title,
    location: "Austin, TX",
    projectType: "Class-A Commercial Mixed-Use QA13",
    estBudget: 2_000_000,
    targetCompletionWeeks: 40,
    specDocumentText: "QA13 extraction canonical-name probe. Division 26.",
    isDemoProject: false,
    generalContractorName: "QA13 General Contractor LLC",
  });
  const pkgId = await c.mutation("tradePackages:createTradePackage", {
    projectId: projId,
    csiDivision: "26 00 00",
    tradeName: "QA13 Electrical Ingest2",
    budgetEstimate: 1_000_000,
    scopeSummary: "QA13 INGEST2 electrical scope.",
    mandatoryInclusions: ["QA13 inclusion 26 00 00"],
    bidDeadline: "2026-12-31",
  });
  const ctrId = await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId,
    companyName: "AUDIT-QA13 Canonical Ingest Co",
    contactEmail: "qa13.canon@qa13.invalid",
    phone: "+1 (512) 555-0199",
    licenseNumber: "TX-QA13-CANON",
    licenseStatus: "Active / Verified (TDLR-QA13)",
    sourceUrl: "https://qa13.example.invalid/canon",
    rfqStatus: "invited",
  });

  const extract = await call("extract with display name differing from contractor record", () =>
    c.action("files:extractBidFromQuoteFile", {
      projectId: projId,
      tradePackageId: pkgId,
      contractorName: "AUDIT-QA13 Canonical Ingest Co LLC",
      quoteText:
        "SUBCONTRACTOR PROPOSAL AND QUOTATION\nPrepared By: AUDIT-QA13 Canonical Ingest Co LLC\nBase Bid Price: $780,000.00\nDivision 26 Electrical distribution and branch wiring.",
    })
  );
  const bids = (await c.query("bids:listByPackage", { tradePackageId: pkgId })) || [];
  const contractors = (await c.query("contractors:listByPackage", { tradePackageId: pkgId })) || [];
  const bid = bids[0] || null;
  const ctr = contractors.find((x) => x._id === ctrId);
  const sameContractor = bid ? bid.contractorId === ctrId : false;
  const nameMatches = bid && ctr ? bid.subcontractorName === ctr.companyName : false;
  record(
    "A12-08-extract-path-canonical-name",
    extract.ok && sameContractor && nameMatches,
    `extract=${extract.ok}; bidName=${JSON.stringify(bid ? bid.subcontractorName : null)}; contractorName=${JSON.stringify(ctr ? ctr.companyName : null)}; linkedToRecord=${sameContractor}; namesEqual=${nameMatches}; note="extraction matched the contractor record by substring but stored the model/arg name"`
  );

  const del = await deleteProjectHard(c, projId);
  const gone = !(await c.query("projects:listProjects", {})).some((p) => p._id === projId);
  say(`INGEST2 cleanup: ${JSON.stringify(del)} gone=${gone}`);

  writeEvidence("a12-08-extract", { results, bid: bid ? { _id: bid._id, subcontractorName: bid.subcontractorName, contractorId: bid.contractorId } : null, contractor: { _id: ctrId, companyName: ctr ? ctr.companyName : null }, extractOk: extract.ok, cleanup: del });
  writeLog("a12-08-extract", log);
}

main().catch((e) => { console.error(e); process.exit(1); });