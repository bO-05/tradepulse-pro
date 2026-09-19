import { client, fixtureTitle, writeEvidence, writeLog, sleep } from "./qa11-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const TITLES = {
  MAIN: fixtureTitle("MAIN"),
  EXEC: fixtureTitle("EXEC"),
  CYCLE: fixtureTitle("CYCLE"),
  PLAIN: fixtureTitle("PLAIN"),
  DEL: fixtureTitle("DEL"),
  INGEST: fixtureTitle("INGEST"),
};

async function findProject(title) {
  const projects = await c.query("projects:listProjects", {});
  return (projects || []).find((p) => p.title === title) || null;
}

async function ensureProject(title) {
  let p = await findProject(title);
  if (p) { say(`reuse project ${title} ${p._id}`); return p; }
  const id = await c.mutation("projects:createProject", {
    title,
    location: "Austin, TX",
    projectType: "Class-A Commercial Mixed-Use QA11",
    estBudget: 2_000_000,
    targetCompletionWeeks: 40,
    specDocumentText:
      "QA11 fixture specification. Division 26 electrical, Division 23 HVAC. Base building distribution and rooftop AHUs.",
    isDemoProject: false,
    generalContractorName: "QA11 General Contractor LLC",
  });
  p = await c.query("projects:getProject", { projectId: id });
  say(`created project ${title} ${id}`);
  return p;
}

async function ensurePackage(projectId, csiDivision, tradeName, budget) {
  const pkgs = await c.query("tradePackages:listByProject", { projectId });
  const found = (pkgs || []).find((p) => p.csiDivision === csiDivision && p.tradeName === tradeName);
  if (found) { say(`reuse package ${tradeName} ${found._id}`); return found; }
  const id = await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision,
    tradeName,
    budgetEstimate: budget,
    scopeSummary: `QA11 ${tradeName} scope summary.`,
    mandatoryInclusions: [`QA11 inclusion for ${csiDivision}`],
    bidDeadline: "2026-12-31",
  });
  const pkg = await c.query("tradePackages:getPackage", { tradePackageId: id });
  say(`created package ${tradeName} ${id}`);
  return pkg;
}

async function ensureContractor(pkgId, companyName, email) {
  const list = await c.query("contractors:listByPackage", { tradePackageId: pkgId });
  const found = (list || []).find((x) => x.contactEmail === email);
  if (found) { say(`reuse contractor ${companyName} ${found._id}`); return found; }
  const id = await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId,
    companyName,
    contactEmail: email,
    phone: "+1 (512) 555-0199",
    licenseNumber: "TX-QA11-0001",
    licenseStatus: "Active / Verified (TDLR-QA11)",
    sourceUrl: "https://qa11.example.invalid",
    rfqStatus: "invited",
  });
  const list2 = await c.query("contractors:listByPackage", { tradePackageId: pkgId });
  say(`created contractor ${companyName} ${id}`);
  return (list2 || []).find((x) => x._id === id);
}

async function ensureBid(pkg, contractor, amount, lineItems) {
  const bids = await c.query("bids:listByPackage", { tradePackageId: pkg._id });
  const found = (bids || []).find((b) => b.contractorId === contractor._id);
  if (found) { say(`reuse bid ${found._id}`); return found; }
  const res = await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkg._id,
    contractorId: contractor._id,
    subcontractorName: contractor.companyName,
    baseBidAmount: amount,
    lineItems,
    identifiedExclusions: [],
    valueEngineeringAlternates: [],
    longLeadEquipmentWeeks: 12,
    leadTimePenalty: 0,
    coiComplianceStatus: "compliant",
    coiPenalty: 0,
  });
  const bids2 = await c.query("bids:listByPackage", { tradePackageId: pkg._id });
  say(`created bid ${res.bidId} leveled=${res.leveledTotalCost}`);
  return (bids2 || []).find((b) => b._id === res.bidId);
}

function baseLine(amount, item = "QA11 Base Scope") {
  return [{ item, unit: "LS", quantity: 1, unitCost: amount, totalCost: amount }];
}

async function main() {
  const map = { generatedAt: new Date().toISOString() };

  // ---------- MAIN: clash credits / validation / responsive / award hunts ----------
  const main = await ensureProject(TITLES.MAIN);
  const mainElec = await ensurePackage(main._id, "26 00 00", "QA11 Electrical Main", 1_000_000);
  const mainHvac = await ensurePackage(main._id, "23 00 00", "QA11 HVAC Main", 1_000_000);
  const e1 = await ensureContractor(mainElec._id, "AUDIT-QA11 Main Electric Co", "qa11.elec1@qa11.invalid");
  const e2 = await ensureContractor(mainElec._id, "AUDIT-QA11 Main Electric Backup", "qa11.elec2@qa11.invalid");
  const longName =
    "AUDIT-QA11 Veritably Unreasonably Long Mechanical & HVAC Engineering Contracting Services Company of Greater Austin Metropolitan Area, LLC";
  const h1 = await ensureContractor(mainHvac._id, longName, "qa11.hvac1@qa11.invalid");
  const mainElecBid = await ensureBid(mainElec, e1, 850_000, baseLine(850_000));
  const mainHvacBid = await ensureBid(
    mainHvac,
    h1,
    800_000,
    [
      { item: "Rooftop AHU supply and installation", unit: "LS", quantity: 1, unitCost: 500_000, totalCost: 500_000 },
      { item: "Chilled water piping and VFD starters", unit: "LS", quantity: 1, unitCost: 300_000, totalCost: 300_000 },
    ]
  );
  Object.assign(map, {
    mainProjectId: main._id,
    mainElecPackageId: mainElec._id,
    mainHvacPackageId: mainHvac._id,
    mainElecContractorId: e1._id,
    mainBackupContractorId: e2._id,
    mainHvacContractorId: h1._id,
    mainElecBidId: mainElecBid._id,
    mainHvacBidId: mainHvacBid._id,
    longName,
  });

  // ---------- EXEC: executed subcontract (A10-01 / A10-02 / A5-02) ----------
  const exec = await ensureProject(TITLES.EXEC);
  const execPkg = await ensurePackage(exec._id, "26 00 00", "QA11 Electrical Exec", 900_000);
  const x1 = await ensureContractor(execPkg._id, "AUDIT-QA11 Exec Electric", "qa11.exec1@qa11.invalid");
  const execBid = await ensureBid(execPkg, x1, 900_000, baseLine(900_000));
  let execAgreements = (await c.query("agreements:listAgreements", { projectId: exec._id })) || [];
  let execAgreement = execAgreements.find((a) => a.bidId === execBid._id);
  if (!execAgreement) {
    const gen = await c.mutation("agreements:generateAgreement", {
      bidId: execBid._id,
      tradePackageId: execPkg._id,
    });
    execAgreements = (await c.query("agreements:listAgreements", { projectId: exec._id })) || [];
    execAgreement = execAgreements.find((a) => a._id === gen._id) || execAgreements.find((a) => a.bidId === execBid._id);
    say(`generated exec agreement ${gen._id}`);
  }
  if (execAgreement && execAgreement.status !== "executed") {
    const res = await c.mutation("agreements:executeAgreement", { agreementId: execAgreement._id });
    say(`executed agreement ${execAgreement._id} ${JSON.stringify(res)}`);
    execAgreement = (await c.query("agreements:listAgreements", { projectId: exec._id })).find(
      (a) => a._id === execAgreement._id
    );
  }
  Object.assign(map, {
    execProjectId: exec._id,
    execPackageId: execPkg._id,
    execContractorId: x1._id,
    execBidId: execBid._id,
    execAgreementId: execAgreement ? execAgreement._id : null,
    execAgreementStatus: execAgreement ? execAgreement.status : null,
    execAgreementNumber: execAgreement ? execAgreement.agreementNumber : null,
  });

  // ---------- CYCLE: normal full procurement cycle (A10-01 positive / A10-03) ----------
  const cycle = await ensureProject(TITLES.CYCLE);
  const cyclePkg = await ensurePackage(cycle._id, "26 00 00", "QA11 Electrical Cycle", 1_250_000);
  Object.assign(map, { cycleProjectId: cycle._id, cyclePackageId: cyclePkg._id });

  // ---------- PLAIN: zero-contractor dispatch (A9-01) ----------
  const plain = await ensureProject(TITLES.PLAIN);
  const plainPkg = await ensurePackage(plain._id, "26 00 00", "QA11 Electrical Plain", 800_000);
  Object.assign(map, { plainProjectId: plain._id, plainPackageId: plainPkg._id });

  // ---------- DEL: normal cascade delete (A10-02 positive) ----------
  const del = await ensureProject(TITLES.DEL);
  const delPkg = await ensurePackage(del._id, "26 00 00", "QA11 Electrical DeleteMe", 750_000);
  const d1 = await ensureContractor(delPkg._id, "AUDIT-QA11 DeleteMe Electric", "qa11.del1@qa11.invalid");
  const delBid = await ensureBid(delPkg, d1, 700_000, baseLine(700_000));
  Object.assign(map, {
    delProjectId: del._id,
    delPackageId: delPkg._id,
    delContractorId: d1._id,
    delBidId: delBid._id,
  });

  // ---------- INGEST: file-linked bid (A9-02) ----------
  const ing = await ensureProject(TITLES.INGEST);
  const ingPkg = await ensurePackage(ing._id, "26 00 00", "QA11 Electrical Ingest", 1_000_000);
  const g1 = await ensureContractor(ingPkg._id, "AUDIT-QA11 Ingest Electric", "qa11.ingest1@qa11.invalid");
  const files = await c.query("files:listFilesByProject", { projectId: ing._id });
  let ingFile = (files || []).find((f) => f.fileName === "AUDIT-QA11-Quote.txt");
  if (!ingFile) {
    const fileId = await c.mutation("files:saveFileRecord", {
      projectId: ing._id,
      tradePackageId: ingPkg._id,
      storageId: `quote_qa11_${Date.now()}`,
      fileName: "AUDIT-QA11-Quote.txt",
      fileType: "quote_pdf",
      fileSize: 4096,
      uploadedBy: "QA11 Verifier",
      textContent:
        "PROPOSAL AND QUOTATION\nBase Bid Price: $780,000.00\nDivision 26 Electrical distribution and branch wiring.",
    });
    filesRefresh: {
      const list = (await c.query("files:listFilesByProject", { projectId: ing._id })) || [];
      ingFile = list.find((f) => f._id === fileId) || list.find((f) => f.fileName === "AUDIT-QA11-Quote.txt");
    }
    say(`created ingest file ${ingFile?._id}`);
  }
  let ingestBid = null;
  try {
    const res = await c.action("files:extractBidFromQuoteFile", {
      projectId: ing._id,
      tradePackageId: ingPkg._id,
      contractorId: g1._id,
      fileId: ingFile._id,
      quoteText:
        "PROPOSAL AND QUOTATION\nFrom: AUDIT-QA11 Ingest Electric\nBase Bid Price: $780,000.00\nDivision 26 Electrical: switchgear, feeders, branch power, lighting.\nExclusions: crane hoisting by GC.",
    });
    say(`extracted ingest bid ${JSON.stringify(res)}`);
    if (res && res.bidId) {
      const list = await c.query("bids:listByPackage", { tradePackageId: ingPkg._id });
      ingestBid = (list || []).find((b) => b._id === res.bidId) || null;
    }
  } catch (err) {
    say(`extractBidFromQuoteFile failed: ${err?.data ?? err?.message ?? err}`);
  }
  if (!ingestBid) {
    const list = await c.query("bids:listByPackage", { tradePackageId: ingPkg._id });
    ingestBid = (list || []).find((b) => b.sourceFileId === ingFile._id) || null;
  }
  Object.assign(map, {
    ingestProjectId: ing._id,
    ingestPackageId: ingPkg._id,
    ingestContractorId: g1._id,
    ingestFileId: ingFile ? ingFile._id : null,
    ingestBidId: ingestBid ? ingestBid._id : null,
    ingestBidSourceFileId: ingestBid ? ingestBid.sourceFileId || null : null,
  });

  writeEvidence("fixtures", map);
  writeLog("fixtures", log);
  await sleep(200);
  console.log("fixtures:", JSON.stringify(map, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});