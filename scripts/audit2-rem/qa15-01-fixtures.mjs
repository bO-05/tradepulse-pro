/**
 * QA15 fixtures: AUDIT-QA15-MAIN (print/superseded/prefix/clash/smoke) and
 * AUDIT-QA15-CRON (deadline TZ + deadline monitor). Backend-only.
 * Default fixture prefix is AUDIT-QA15-*.
 */
import {
  client,
  fixtureTitle,
  hardDeleteProject,
  writeEvidence,
  writeLog,
  call,
  sleep,
  utcDate,
  zonedDate,
  zonedDateTime,
  addDays,
} from "./qa15-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const MAIN = fixtureTitle("MAIN");
const CRON = fixtureTitle("CRON");

async function createProject(title, type) {
  const id = await c.mutation("projects:createProject", {
    title,
    location: "New York, NY",
    projectType: type,
    estBudget: 4_000_000,
    targetCompletionWeeks: 52,
    specDocumentText: `${title} fixture spec. Divisions 26, 23, 22, 27, 08, 31.`,
    isDemoProject: false,
    generalContractorName: "AUDIT-QA15 General Contractor LLC",
  });
  return await c.query("projects:getProject", { projectId: id });
}

async function createPackage(projectId, csiDivision, tradeName, budgetEstimate, bidDeadline) {
  const id = await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision,
    tradeName,
    budgetEstimate,
    scopeSummary: `${tradeName} fixture scope for QA15 verification.`,
    mandatoryInclusions: ["QA15 inclusion A", "QA15 inclusion B"],
    bidDeadline,
  });
  return await c.query("tradePackages:getPackage", { tradePackageId: id });
}

async function setStatus(pkgId, status) {
  await c.mutation("tradePackages:updateStatus", { tradePackageId: pkgId, status });
}

async function createContractor(pkgId, companyName, email) {
  const id = await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId,
    companyName,
    contactEmail: email,
    phone: "+1 (212) 555-0155",
    licenseNumber: "NY-QA15-0001",
    licenseStatus: "Active / Verified (QA15)",
    sourceUrl: "https://qa15.example.invalid",
    rfqStatus: "invited",
  });
  const list = (await c.query("contractors:listByPackage", { tradePackageId: pkgId })) || [];
  return list.find((x) => x._id === id) || null;
}

async function createBid(pkgId, contractor, amount) {
  return await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkgId,
    contractorId: contractor._id,
    subcontractorName: contractor.companyName,
    baseBidAmount: amount,
    lineItems: [{ item: "QA15 base scope", unit: "LS", quantity: 1, unitCost: amount, totalCost: amount }],
    identifiedExclusions: [],
    valueEngineeringAlternates: [],
    longLeadEquipmentWeeks: 8,
    leadTimePenalty: 0,
    coiComplianceStatus: "compliant",
    coiPenalty: 0,
  });
}

async function main() {
  const now = new Date();
  const todayUtc = utcDate(now);
  const nyDate = zonedDate(now, "America/New_York");
  const oneDayAgo = addDays(todayUtc, -1);
  const twoDaysAgo = addDays(todayUtc, -2);
  say(`clock: UTC=${todayUtc} NY=${nyDate} (${zonedDateTime(now, "America/New_York")}); overdue=${oneDayAgo}; twoDaysAgo=${twoDaysAgo}`);

  const cleanup = {
    main: await hardDeleteProject(c, MAIN),
    cron: await hardDeleteProject(c, CRON),
  };
  say(`cleanup: ${JSON.stringify(cleanup)}`);
  await sleep(700);

  // ============================================================ MAIN project
  const main = await createProject(MAIN, "QA15 Round-5 Verification Fixture");
  const F = { mainProjectId: main._id, mainProjectTitle: MAIN };

  const pkgPrint = await createPackage(main._id, "26 00 00", "AUDIT-QA15 Print Electric", 900_000, "2026-12-31");
  const pkgClash = await createPackage(main._id, "23 00 00", "AUDIT-QA15 Clash HVAC", 800_000, "2026-12-31");
  const pkgSuper = await createPackage(main._id, "22 00 00", "AUDIT-QA15 Superseded Plumbing", 400_000, "2026-12-31");
  const pkgPrefix = await createPackage(main._id, "27 00 00", "AUDIT-QA15 Prefix Comms", 300_000, "2026-12-31");
  const pkgSmoke = await createPackage(main._id, "08 00 00", "AUDIT-QA15 Smoke Doors", 600_000, "2026-12-31");
  const pkgEdit = await createPackage(main._id, "31 00 00", "AUDIT-QA15 Edit Earthwork", 700_000, "2026-12-31");
  F.mainPackages = [pkgPrint, pkgClash, pkgSuper, pkgPrefix, pkgSmoke, pkgEdit].map((p) => ({
    id: p._id, csi: p.csiDivision, name: p.tradeName, status: p.status,
  }));

  // --- print electric: bid + agreement (pending) + award
  const cPrint = await createContractor(pkgPrint._id, "AUDIT-QA15 Print Electric Co", "qa15.print@qa15.invalid");
  const bPrint = await createBid(pkgPrint._id, cPrint, 850_000);
  await c.mutation("agreements:generateAgreement", { bidId: bPrint.bidId, tradePackageId: pkgPrint._id });
  const printAgr = ((await c.query("agreements:listAgreements", { projectId: main._id })) || []).find((a) => a.bidId === bPrint.bidId);
  await c.mutation("bids:awardContract", { bidId: bPrint.bidId, tradePackageId: pkgPrint._id });
  const printAgrAfter = (await c.query("agreements:listAgreements", { projectId: main._id })).find((a) => a._id === printAgr._id);
  const pkgPrintAfter = await c.query("tradePackages:getPackage", { tradePackageId: pkgPrint._id });
  F.print = {
    packageId: pkgPrint._id,
    packageName: pkgPrint.tradeName,
    contractorId: cPrint._id,
    bidId: bPrint.bidId,
    agreementId: printAgrAfter._id,
    agreementNumber: printAgrAfter.agreementNumber,
    agreementStatus: printAgrAfter.status,
    contractTextLength: printAgrAfter.contractText.length,
    contractSum: printAgrAfter.contractSum,
    packageStatus: pkgPrintAfter.status,
  };
  say(`print fixture: agr=${printAgrAfter.agreementNumber} status=${printAgrAfter.status} textLen=${printAgrAfter.contractText.length} pkg=${pkgPrintAfter.status}`);

  // --- clash hvac: bid only
  const cClash = await createContractor(pkgClash._id, "AUDIT-QA15 Clash HVAC Co", "qa15.clash@qa15.invalid");
  const bClash = await createBid(pkgClash._id, cClash, 790_000);
  F.clash = { packageId: pkgClash._id, packageName: pkgClash.tradeName, contractorId: cClash._id, bidId: bClash.bidId };

  // --- superseded plumbing: bid + agreement + execute + void
  const cSuper = await createContractor(pkgSuper._id, "AUDIT-QA15 Superseded Plumbing Co", "qa15.super@qa15.invalid");
  const bSuper = await createBid(pkgSuper._id, cSuper, 320_000);
  await c.mutation("agreements:generateAgreement", { bidId: bSuper.bidId, tradePackageId: pkgSuper._id });
  const superAgr = ((await c.query("agreements:listAgreements", { projectId: main._id })) || []).find((a) => a.bidId === bSuper.bidId);
  await c.mutation("bids:awardContract", { bidId: bSuper.bidId, tradePackageId: pkgSuper._id });
  await call("execute superseded fixture agreement", () => c.mutation("agreements:executeAgreement", { agreementId: superAgr._id }));
  await call("void executed fixture agreement", () =>
    c.mutation("agreements:voidExecutedAgreement", {
      agreementId: superAgr._id,
      reason: "QA15 fixture: engineer supersession before verification of the execute refusal path.",
    })
  );
  const superAgrAfter = (await c.query("agreements:listAgreements", { projectId: main._id })).find((a) => a._id === superAgr._id);
  F.superseded = {
    packageId: pkgSuper._id,
    packageName: pkgSuper.tradeName,
    bidId: bSuper.bidId,
    agreementId: superAgrAfter._id,
    agreementNumber: superAgrAfter.agreementNumber,
    agreementStatus: superAgrAfter.status,
  };
  say(`superseded fixture: ${superAgrAfter.agreementNumber} status=${superAgrAfter.status}`);

  // --- prefix comms: contractor record name is a PREFIX of the parsed name
  const cPrefix = await createContractor(pkgPrefix._id, "AUDIT-QA15 Canonical Co", "qa15.canon@qa15.invalid");
  F.prefix = {
    packageId: pkgPrefix._id,
    packageName: pkgPrefix.tradeName,
    contractorId: cPrefix._id,
    contractorName: cPrefix.companyName,
    parsedName: "AUDIT-QA15 Canonical Co LLC",
  };
  say(`prefix fixture: record="${cPrefix.companyName}" parsed="${F.prefix.parsedName}"`);

  // --- smoke doors: bid + fresh-edit contractor
  const cSmoke = await createContractor(pkgSmoke._id, "AUDIT-QA15 Smoke Bidder", "qa15.smoke@qa15.invalid");
  const bSmoke = await createBid(pkgSmoke._id, cSmoke, 500_000);
  const cFresh = await createContractor(pkgSmoke._id, "AUDIT-QA15 Fresh Edit Target", "qa15.fresh@qa15.invalid");
  F.smoke = {
    packageId: pkgSmoke._id,
    packageName: pkgSmoke.tradeName,
    bidId: bSmoke.bidId,
    bidderId: cSmoke._id,
    bidderName: cSmoke.companyName,
    freshContractorId: cFresh._id,
    freshContractorName: cFresh.companyName,
  };

  // --- edit earthwork: A14-02 two-tab stale edit contractor
  const cEdit = await createContractor(pkgEdit._id, "AUDIT-QA15 Edit Target", "qa15.edit@qa15.invalid");
  F.edit = {
    packageId: pkgEdit._id,
    packageName: pkgEdit.tradeName,
    contractorId: cEdit._id,
    contractorName: cEdit.companyName,
    contractorEmail: cEdit.contactEmail,
    updatedAt: cEdit.updatedAt ?? null,
  };
  say(`edit fixture: ${cEdit.companyName} updatedAt=${cEdit.updatedAt}`);
  F.editTargetName = cEdit.companyName;
  F.editTargetEmail = cEdit.contactEmail;

  // --- A11-04 custom deduction on the disconnect clash
  const deduct = await call("deduct custom $9,999 on clash-disconnect-02 (HVAC)", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: main._id,
      clashId: "clash-disconnect-02",
      tradePackageId: pkgClash._id,
      deductAmount: 9999,
      description: "Rooftop Mechanical Equipment Disconnect Switches",
    })
  );
  const clashes = await c.raw.query("coordination:detectCrossTradeClashes", { projectId: main._id });
  const disconnect = (clashes.doubleBuys || []).find((d) => d.id === "clash-disconnect-02");
  F.clashDeduct = {
    call: deduct,
    status: disconnect ? disconnect.status : null,
    deductedAmount: disconnect ? disconnect.deductedAmount ?? null : null,
    resolution: disconnect ? disconnect.resolution ?? null : null,
    redundantAmount: disconnect ? disconnect.redundantAmount : null,
  };
  say(`clash deduct: ${JSON.stringify(F.clashDeduct)}`);

  // --- backend freshness probe: stale expectedUpdatedAt must be refused
  const staleProbe = await call("stale updateContractor probe (expectedUpdatedAt=1)", () =>
    c.mutation("contractors:updateContractor", {
      contractorId: cEdit._id,
      companyName: cEdit.companyName,
      contactEmail: cEdit.contactEmail,
      phone: cEdit.phone,
      licenseNumber: cEdit.licenseNumber,
      licenseStatus: cEdit.licenseStatus,
      sourceUrl: cEdit.sourceUrl,
      rfqStatus: cEdit.rfqStatus,
      expectedUpdatedAt: 1,
    })
  );
  F.staleGuardProbe = staleProbe;
  say(`stale guard probe: ok=${staleProbe.ok} data=${staleProbe.data ?? staleProbe.message}`);

  // ============================================================ CRON project
  const cron = await createProject(CRON, "QA15 Deadline Monitor Fixture");
  const pkgZero = await createPackage(cron._id, "26 00 00", "AUDIT-QA15 Cron Zero Bid", 100_000, oneDayAgo);
  const pkgBid = await createPackage(cron._id, "23 00 00", "AUDIT-QA15 Cron With Bid", 1_000_000, oneDayAgo);
  await setStatus(pkgZero._id, "rfqs_dispatched");
  const cCron = await createContractor(pkgBid._id, "AUDIT-QA15 Cron Bidder", "qa15.cron@qa15.invalid");
  const bCron = await createBid(pkgBid._id, cCron, 600_000);
  // submitDirectBid moves the package to leveling; put it back to rfqs_dispatched
  await setStatus(pkgBid._id, "rfqs_dispatched");
  const pkgZeroBefore = await c.query("tradePackages:getPackage", { tradePackageId: pkgZero._id });
  const pkgBidBefore = await c.query("tradePackages:getPackage", { tradePackageId: pkgBid._id });
  F.cron = {
    projectId: cron._id,
    projectTitle: CRON,
    zeroPackageId: pkgZero._id,
    zeroPackageName: pkgZero.tradeName,
    zeroDeadline: oneDayAgo,
    zeroStatusBefore: pkgZeroBefore.status,
    bidPackageId: pkgBid._id,
    bidPackageName: pkgBid.tradeName,
    bidDeadline: oneDayAgo,
    bidStatusBefore: pkgBidBefore.status,
    contractorId: cCron._id,
    bidId: bCron.bidId,
  };
  say(`cron fixture: zero=${pkgZeroBefore.status}(${oneDayAgo}) withBid=${pkgBidBefore.status}(${oneDayAgo})`);

  // --- A14-01 HTTP deadline probes on the CRON project
  const localTodayCreate = await call(`HTTP createTradePackage(deadline=${nyDate} = NY local today)`, () =>
    c.mutation("tradePackages:createTradePackage", {
      projectId: cron._id,
      csiDivision: "09 00 00",
      tradeName: "AUDIT-QA15 Local Today Accepted",
      budgetEstimate: 100_000,
      scopeSummary: "QA15 A14-01 HTTP local-today acceptance probe.",
      mandatoryInclusions: ["probe"],
      bidDeadline: nyDate,
    })
  );
  const twoDaysAgoCreate = await call(`HTTP createTradePackage(deadline=${twoDaysAgo} = two days ago)`, () =>
    c.mutation("tradePackages:createTradePackage", {
      projectId: cron._id,
      csiDivision: "10 00 00",
      tradeName: "AUDIT-QA15 Two Days Ago Rejected",
      budgetEstimate: 100_000,
      scopeSummary: "QA15 A14-01 HTTP past-deadline refusal probe.",
      mandatoryInclusions: ["probe"],
      bidDeadline: twoDaysAgo,
    })
  );
  const utcYesterdayCreate = await call(`HTTP createTradePackage(deadline=${oneDayAgo} = UTC yesterday)`, () =>
    c.mutation("tradePackages:createTradePackage", {
      projectId: cron._id,
      csiDivision: "11 00 00",
      tradeName: "AUDIT-QA15 UTC Yesterday Accepted",
      budgetEstimate: 100_000,
      scopeSummary: "QA15 A14-01 HTTP one-day-slack probe.",
      mandatoryInclusions: ["probe"],
      bidDeadline: oneDayAgo,
    })
  );
  F.deadline = { todayUtc, nyDate, oneDayAgo, twoDaysAgo, localTodayCreate, twoDaysAgoCreate, utcYesterdayCreate };
  say(`deadline HTTP: localToday=${localTodayCreate.ok} twoDaysAgo=${twoDaysAgoCreate.ok} utcYesterday=${utcYesterdayCreate.ok}`);

  const evidence = {
    generatedAt: new Date().toISOString(),
    clock: { todayUtc, nyDate, oneDayAgo, twoDaysAgo },
    ...F,
  };
  writeEvidence("fixtures", evidence);
  writeLog("fixtures", log);
  console.log("fixtures written");
}

main().catch((e) => {
  console.error(e);
  writeLog("fixtures-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});