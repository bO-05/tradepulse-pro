/**
 * QA28-05 UI evidence for the two UI-reachable findings:
 *  A) manual accepted VE "VFD..." ($1,000) -> coordination card claims the static
 *     $38,500 credit and hides the 1-click deduct (project AUDIT-QA28-MANUIEVID)
 *  B) mandatory inclusion containing the substring "bas" (e.g. "Base building...")
 *     -> critical BAS void rendered as "Scope Assigned & Covered" (AUDIT-QA28-UIEVID)
 * Both probe projects are created here and removed by qa28-99.
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab } from "./lib.mjs";
import { client, fixtureTitle, writeEvidence, writeLog, plusDays, sleep } from "./qa28-lib.mjs";

const c = client();
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1500)}`);
};

async function purge(title) {
  for (const p of ((await c.query("projects:listProjects", {})) || []).filter((x) => x.title === title)) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try { await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA28 UI-claim fixture purge of executed record." }); } catch {}
    }
    try { await c.mutation("projects:deleteProject", { projectId: p._id }); } catch {}
  }
}

async function buildProject(title, inclusion) {
  const dl = plusDays(20);
  const id = await c.mutation("projects:createProject", {
    title, location: "Austin, TX", projectType: "Class-A Commercial Mixed-Use",
    estBudget: 1500000, targetCompletionWeeks: 52, specDocumentText: `${title} UI claim probe.`,
    isDemoProject: false, generalContractorName: "QA28 Claims GC",
  });
  const mkPkg = (csi, name, budget) =>
    c.mutation("tradePackages:createTradePackage", {
      projectId: id, csiDivision: csi, tradeName: name, budgetEstimate: budget,
      scopeSummary: `${name} probe scope.`, mandatoryInclusions: [inclusion], bidDeadline: dl,
    });
  const p26 = await mkPkg("26 00 00", "QA28 Claims Electrical", 900000);
  const p23 = await mkPkg("23 00 00", "QA28 Claims HVAC", 600000);
  const mkCtr = (pkgId, name, email, lic) =>
    c.mutation("contractors:createContractor", {
      tradePackageId: pkgId, companyName: name, contactEmail: email, phone: "+1 (206) 555-0199",
      licenseNumber: lic, licenseStatus: "Active / Verified (QA28)", sourceUrl: "https://qa28.example.invalid/license", rfqStatus: "invited",
    });
  const c26 = await mkCtr(p26, `AUDIT-QA28 ${title.slice(-9)} Electric`, `estimating@qa28-${title.slice(-9).toLowerCase()}-e.invalid`, "TX-QA28-CE");
  const c23 = await mkCtr(p23, `AUDIT-QA28 ${title.slice(-9)} Mechanical`, `estimating@qa28-${title.slice(-9).toLowerCase()}-m.invalid`, "TX-QA28-CM");
  const b26 = await c.mutation("bids:submitDirectBid", {
    tradePackageId: p26, contractorId: c26, subcontractorName: c26 && `AUDIT-QA28 ${title.slice(-9)} Electric`,
    baseBidAmount: 780000, coiComplianceStatus: "compliant", coiPenalty: 0,
  });
  const b23 = await c.mutation("bids:submitDirectBid", {
    tradePackageId: p23, contractorId: c23, subcontractorName: `AUDIT-QA28 ${title.slice(-9)} Mechanical`,
    baseBidAmount: 470000, coiComplianceStatus: "compliant", coiPenalty: 0,
  });
  return { id, p26, p23, b26, b23, c26, c23 };
}

const mainText = (page) => page.evaluate(() => (document.querySelector("main") || document.body).innerText);

async function main() {
  const TITLE_M = fixtureTitle("MANUIEVID");
  const TITLE_V = fixtureTitle("UIEVID");
  await purge(TITLE_M);
  await purge(TITLE_V);
  await sleep(400);

  // ---- build manual-VE probe ----
  const m = await buildProject(TITLE_M, "All labor and materials per plans and specifications");
  await c.mutation("bids:updateBidAdjustments", {
    bidId: m.b26.bidId,
    identifiedExclusions: [],
    valueEngineeringAlternates: [{ description: "VFD factory pricing credit (manual entry)", costDeduct: 1000, isAccepted: true }],
    leadTimePenalty: 0, coiPenalty: 0,
  });

  // ---- build "bas" substring probe ----
  const v = await buildProject(TITLE_V, "Base building general conditions allowance");

  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  try {
    // ======= A) manual VE =======
    await page.goto(`${BASE}/?project=${m.id}&tab=coordination&qa28=manuievid`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
    await delay(2000);
    const tM = (await mainText(page)).replace(/\s+/g, " ");
    const cardSlice = (() => {
      const i = tM.indexOf("Variable Frequency Drives");
      return i >= 0 ? tM.slice(Math.max(0, i - 160), i + 700) : "";
    })();
    const mBids = await c.query("bids:listByPackage", { tradePackageId: m.p26 });
    const actualVe = (mBids.find((b) => b._id === m.b26.bidId)?.valueEngineeringAlternates || []).filter((x) => x.isAccepted).reduce((s, x) => s + x.costDeduct, 0);
    const detectM = await c.query("coordination:detectCrossTradeClashes", { projectId: m.id });
    const cardM = detectM.doubleBuys.find((x) => x.id === "clash-vfd-01");
    const deductButtons = (tM.match(/1-Click Deduct Credit/g) || []).length;
    record("A28-05.1", "UI shows the VFD card as 'Credit Deducted & Leveled' claiming the static $38,500 while the only accepted VE is $1,000, and the 1-click deduct control is gone",
      /CREDIT DEDUCTED & LEVELED/i.test(tM) &&
        /Deducted \$38,500 credit alternate from Division 23 HVAC proposal\./.test(tM) &&
        /Recoverable Buyout Credits \$38,500/.test(tM) &&
        cardM?.deductedAmount === undefined && actualVe === 1000 &&
        (tM.match(/1-Click Deduct Credit/g) || []).length === 0,
      { actualAcceptedVe: actualVe, card: cardM ? { status: cardM.status, deductedAmount: cardM.deductedAmount ?? null, resolution: cardM.resolution } : null, deductButtons, cardSlice: cardSlice.slice(0, 640) });
    await shot(page, "fix4-qa28-manual-ve-claim.png");

    // ======= B) "bas" substring =======
    await page.goto(`${BASE}/?project=${v.id}&tab=coordination&qa28=uievid`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
    await delay(2000);
    const tV = (await mainText(page)).replace(/\s+/g, " ");
    const voidIdx = tV.indexOf("Low-Voltage 24V BAS Control & Interlock Wiring");
    const voidSlice = voidIdx >= 0 ? tV.slice(Math.max(0, voidIdx - 140), voidIdx + 700) : "";
    const vPkg26 = (await c.query("tradePackages:listByProject", { projectId: v.id })).find((p) => p._id === v.p26);
    const vBid26 = (await c.query("bids:listByPackage", { tradePackageId: v.p26 })).find((b) => b._id === v.b26.bidId);
    const detectV = await c.query("coordination:detectCrossTradeClashes", { projectId: v.id });
    const basV = detectV.scopeVoids.find((x) => x.id === "void-bas-wiring-01");
    const basInBid = (vBid26?.lineItems || []).some((i) => /BAS|control/i.test(i.item));
    record("A28-05.2", "UI renders the critical BAS void as 'Scope Assigned & Covered' / 'Assigned to Division 26 Electrical' although the only inclusion is 'Base building general conditions allowance' and nothing covers BAS",
      /SCOPE ASSIGNED & COVERED/i.test(tV) &&
        /Assigned to Division 26 Electrical — Included in mandatory scope/.test(tV) &&
        /Unassigned Scope Voids \$18,500/.test(tV) &&
        basV?.status === "assigned" && basV?.assignedToTradeName === "Division 26 Electrical" &&
        vPkg26.mandatoryInclusions.length === 1 && vPkg26.mandatoryInclusions[0] === "Base building general conditions allowance" &&
        !basInBid &&
        !/Assign to Div 26 \(Electrical\)/.test(tV),
      { inclusion: vPkg26.mandatoryInclusions, card: basV ? { id: basV.id, status: basV.status, assignedTo: basV.assignedToTradeName, cost: basV.estimatedVoidCost } : null, basLineItem: basInBid, voidSlice: voidSlice.slice(0, 640) });
    await shot(page, "fix4-qa28-bas-substring-claim.png");

    record("A28-05.3", "evidence diagnostics: zero page errors", diag.pageErrors.length === 0, { pageErrors: diag.pageErrors.slice(0, 5) });

    writeEvidence("ui-claims", { manual: { projectId: m.id }, bas: { projectId: v.id }, results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
    writeLog("ui-claims", log);
    console.log(`ui-claims: ${results.filter((r) => r.pass).length}/${results.length}`);
  } catch (err) {
    writeEvidence("ui-claims", { results: [...results, { id: "A28-05.ERR", pass: false, name: "aborted", detail: String(err?.stack ?? err) }], summary: { pass: results.filter((r) => r.pass).length, total: results.length + 1 } });
    writeLog("ui-claims", [...log, String(err?.stack ?? err)]);
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("ui-claims-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});