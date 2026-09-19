import { attachDiagnostics, clickHeaderTab, delay, selectProjectByTitle, waitForAppReady } from "./qa6-lib.mjs";
import { BASE_URL, launchBrowser, shot } from "./lib.mjs";
import { client, writeEvidence, writeLog, sleep } from "./qa11-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const out = {};

async function ensureProject(title) {
  const existing = (await c.query("projects:listProjects", {})).find((p) => p.title === title);
  if (existing) return existing;
  const id = await c.mutation("projects:createProject", {
    title,
    location: "Austin, TX",
    projectType: "QA11 UI Deduct Probe",
    estBudget: 1_500_000,
    targetCompletionWeeks: 40,
    specDocumentText: "QA11 UI deduct probe spec.",
    isDemoProject: false,
    generalContractorName: "QA11 GC",
  });
  return await c.query("projects:getProject", { projectId: id });
}

async function ensurePkg(projectId, csi, name, budget) {
  const found = (await c.query("tradePackages:listByProject", { projectId })).find((p) => p.tradeName === name);
  if (found) return found;
  const id = await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision: csi,
    tradeName: name,
    budgetEstimate: budget,
    scopeSummary: `${name} scope`,
    mandatoryInclusions: ["QA11 inclusion"],
    bidDeadline: "2026-12-31",
  });
  return await c.query("tradePackages:getPackage", { tradePackageId: id });
}

async function ensureContractor(pkgId, company, email) {
  const found = (await c.query("contractors:listByPackage", { tradePackageId: pkgId })).find((x) => x.contactEmail === email);
  if (found) return found;
  const id = await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId,
    companyName: company,
    contactEmail: email,
    phone: "+1 (512) 555-0177",
    licenseNumber: "TX-QA11-UI",
    licenseStatus: "Active / Verified",
    sourceUrl: "https://qa11.invalid",
    rfqStatus: "bid_received",
  });
  return (await c.query("contractors:listByPackage", { tradePackageId: pkgId })).find((x) => x._id === id);
}

async function ensureBid(pkg, contractor, amount) {
  const found = (await c.query("bids:listByPackage", { tradePackageId: pkg._id })).find((b) => b.contractorId === contractor._id);
  if (found) return found;
  await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkg._id,
    contractorId: contractor._id,
    subcontractorName: contractor.companyName,
    baseBidAmount: amount,
    lineItems: [{ item: `${pkg.tradeName} base`, unit: "LS", quantity: 1, unitCost: amount, totalCost: amount }],
    longLeadEquipmentWeeks: 12,
    leadTimePenalty: 0,
    coiComplianceStatus: "compliant",
    coiPenalty: 0,
  });
  return (await c.query("bids:listByPackage", { tradePackageId: pkg._id })).find((b) => b.contractorId === contractor._id);
}

async function main() {
  // ---------- MAIN KPI expected (backend) ----------
  const mainId = (await c.query("projects:listProjects", {})).find((p) => p.title === "AUDIT-QA11-MAIN")._id;
  const mainPkgs = await c.query("tradePackages:listByProject", { projectId: mainId });
  const mainBids = await c.query("bids:listAllProjectBids", { projectId: mainId });
  const mainAgrs = await c.query("agreements:listAgreements", { projectId: mainId });
  let expectedBuyout = 0;
  const perPkg = [];
  for (const pkg of mainPkgs) {
    const bids = mainBids.filter((b) => b.tradePackageId === pkg._id);
    const effective = bids.find((b) => b.isAwarded) || [...bids].sort((a, b) => a.leveledTotalCost - b.leveledTotalCost)[0];
    expectedBuyout += effective ? effective.leveledTotalCost : pkg.budgetEstimate;
    perPkg.push({ trade: pkg.tradeName, effective: effective ? effective.leveledTotalCost : null, budget: pkg.budgetEstimate });
  }
  const awardedPkgIds = new Set();
  for (const a of mainAgrs) if (a.status !== "superseded") awardedPkgIds.add(a.tradePackageId);
  for (const b of mainBids) if (b.isAwarded) awardedPkgIds.add(b.tradePackageId);
  for (const p of mainPkgs) if (p.status === "awarded") awardedPkgIds.add(p._id);
  const expectedAwarded = mainPkgs.filter((p) => awardedPkgIds.has(p._id)).length;
  out.mainExpected = {
    budget: 2_000_000,
    leveledBuyout: expectedBuyout,
    variance: 2_000_000 - expectedBuyout,
    awarded: `${expectedAwarded}/${mainPkgs.length}`,
    perPkg,
  };
  say(`MAIN expected KPI: ${JSON.stringify(out.mainExpected)}`);

  // ---------- UIDEDUCT fixture (normal UI 1-click deduct) ----------
  const proj = await ensureProject("AUDIT-QA11-UIDEDUCT");
  const elec = await ensurePkg(proj._id, "26 00 00", "QA11 UI Electrical", 600_000);
  const hvac = await ensurePkg(proj._id, "23 00 00", "QA11 UI HVAC", 600_000);
  const ce = await ensureContractor(elec._id, "AUDIT-QA11 UI Electric", "qa11.ui.elec@qa11.invalid");
  const ch = await ensureContractor(hvac._id, "AUDIT-QA11 UI HVAC", "qa11.ui.hvac@qa11.invalid");
  const be = await ensureBid(elec, ce, 500_000);
  const bh = await ensureBid(hvac, ch, 450_000);
  out.uiDeductFixture = { projectId: proj._id, elecPackageId: elec._id, hvacPackageId: hvac._id, hvacBidId: bh._id, elecBidId: be._id, before: bh.leveledTotalCost };
  const clashesBefore = await c.raw.query("coordination:detectCrossTradeClashes", { projectId: proj._id });
  out.uiDeductFixture.clashBefore = (clashesBefore.doubleBuys || []).map((d) => `${d.id}:${d.status}:${d.redundantAmount}`);

  // ---------- UI ----------
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diagnostics = attachDiagnostics(page);
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await selectProjectByTitle(page, "AUDIT-QA11-MAIN");
    await delay(2000);
    out.mainUi = await page.evaluate(() => {
      const bar = [...document.querySelectorAll("div")].find((d) => /Leveled Buyout:/.test(d.innerText) && d.innerText.length < 600);
      const text = bar ? bar.innerText.replace(/\s+/g, " ") : document.body.innerText.split("\n").slice(0, 12).join(" ");
      const budget = (text.match(/Budget: \$([\d,]+)/) || [])[1];
      const buyout = (text.match(/Leveled Buyout: \$([\d,]+)/) || [])[1];
      const variance = (text.match(/Variance: ([+-]?\$[\d,]+)/) || [])[1];
      const awarded = (text.match(/Subcontracts: ([\d/]+) Awarded/) || [])[1];
      return { text: text.slice(0, 400), budget, buyout, variance, awarded };
    });
    const num = (s) => (s ? Number(s.replace(/[^0-9-]/g, "")) : null);
    const mainMatches =
      num(out.mainUi.budget) === out.mainExpected.budget &&
      num(out.mainUi.buyout) === out.mainExpected.leveledBuyout &&
      num(out.mainUi.variance) === out.mainExpected.variance &&
      out.mainUi.awarded === out.mainExpected.awarded;
    say(`MAIN UI KPI: ${JSON.stringify(out.mainUi)} matches=${mainMatches}`);

    await selectProjectByTitle(page, "AUDIT-QA11-UIDEDUCT");
    await delay(2000);
    await clickHeaderTab(page, "05: Scope Clash");
    await delay(1800);
    const deductClick = await page.evaluate(() => {
      const b = [...document.querySelectorAll("main button")].find((x) => /1-Click Deduct Credit/.test(x.innerText || ""));
      if (!b) return { ok: false, buttons: [...document.querySelectorAll("main button")].map((x) => x.innerText.trim().replace(/\s+/g, " ")).slice(0, 25) };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, text: b.innerText.trim().replace(/\s+/g, " ") };
    });
    await delay(3500);
    const toast = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[role="status"]')].find((e) => e.getBoundingClientRect().width > 0);
      return el ? el.innerText.trim() : null;
    });
    await shot(page, "fix4-qa11-hunt-ui-deduct.png");
    const clashesAfter = await c.raw.query("coordination:detectCrossTradeClashes", { projectId: proj._id });
    const hvacAfter = (await c.query("bids:listByPackage", { tradePackageId: hvac._id })).find((b) => b._id === bh._id);
    const vfd = (clashesAfter.doubleBuys || []).find((d) => d.id === "clash-vfd-01");
    out.uiDeduct = {
      click: deductClick,
      toast,
      after: hvacAfter ? hvacAfter.leveledTotalCost : null,
      delta: bh.leveledTotalCost - (hvacAfter ? hvacAfter.leveledTotalCost : 0),
      resolution: vfd ? { status: vfd.status, deductedAmount: vfd.deductedAmount } : null,
      kpi: await page.evaluate(() => {
        const label = [...document.querySelectorAll("span")].find((s) => s.textContent.trim() === "Recoverable Buyout Credits");
        const card = label ? label.closest("div.rounded-xl") : null;
        const v = card ? card.querySelector(".font-mono") : null;
        return v ? v.innerText.trim() : null;
      }),
    };
    say(`UI deduct: ${JSON.stringify(out.uiDeduct)}`);

    out.uiDeductPass =
      deductClick.ok &&
      typeof toast === "string" &&
      /1-Click Deduct Credit applied/i.test(toast) &&
      vfd &&
      vfd.status === "deducted" &&
      vfd.deductedAmount === 38500 &&
      out.uiDeduct.delta === 38500 &&
      out.uiDeduct.kpi === "$38,500";
    say(`UI deduct pass=${out.uiDeductPass}`);
    out.mainKpiPass = mainMatches;
    out.diagnostics = {
      consoleErrors: diagnostics.consoleLogs.filter((l) => l.type === "error").map((e) => e.text.slice(0, 160)),
      pageErrors: diagnostics.pageErrors.slice(0, 6),
      failedRequests: diagnostics.failedRequests.slice(0, 8),
    };
  } finally {
    await browser.close();
  }

  // cleanup probe project
  try {
    await c.mutation("projects:deleteProject", { projectId: out.uiDeductFixture.projectId });
    out.uiDeductFixture.deleted = true;
  } catch (err) {
    out.uiDeductFixture.deleted = false;
    out.uiDeductFixture.deleteError = String(err?.data ?? err?.message ?? err);
  }
  writeEvidence("probe-kpi", out);
  writeLog("probe-kpi", log);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});