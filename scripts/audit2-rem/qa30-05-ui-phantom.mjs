/**
 * QA30-05 UI repro for the stale-credit state:
 *  backend: apply the 1-click VFD credit ($38,500) -> card deducted.
 *  UI: Bid Leveling -> HVAC bid -> "Adjust Leveling" -> toggle the accepted
 *      "Cross-Trade Clash Credit..." alternate OFF -> "Save Leveling Adjustments".
 *  After saving, the API conjoins the two views: coordination still reports
 *  "Credit Deducted & Leveled" + $38,500 recoverable while the bid is back to $480,000.
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab, selectProjectByTitle } from "./lib.mjs";
import { client, fixtureTitle, writeEvidence, writeLog, plusDays, sleep } from "./qa30-lib.mjs";

const c = client();
const BASE = "https://brainy-skunk-440.convex.site";
const TITLE = fixtureTitle("UIPHANTOM");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1600)}`);
};

async function clickText(page, needle, exact = false) {
  return page.evaluate(
    ({ needle, exact }) => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const b = [...document.querySelectorAll("button")].find((x) => {
        const t = (x.innerText || "").replace(/\s+/g, " ").trim();
        return vis(x) && (exact ? t === needle : t.includes(needle));
      });
      if (!b) return { ok: false, available: [...document.querySelectorAll("button")].map((x) => (x.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 40) };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, text: (b.innerText || "").replace(/\s+/g, " ").trim() };
    },
    { needle, exact }
  );
}

const mainText = (page) => page.evaluate(() => (document.querySelector("main") || document.body).innerText);

const UI = () => {
  const t = (document.querySelector("main") || document.body).innerText.replace(/\s+/g, " ");
  const grab = (label) => new RegExp(label + "\\s*\\$?([\\d,]+)").exec(t)?.[1] ?? null;
  return {
    credits: grab("Recoverable Buyout Credits"),
    doubleBuys: grab("Redundant Double-Buys"),
    deductedChip: /credit deducted & leveled/i.test(t),
    resolutionClaim: /Deducted \$38,500 credit from proposal/.test(t),
    deductButtons: (t.match(/1-Click Deduct Credit/gi) || []).length,
    deductButtonTexts: [...document.querySelectorAll("button")]
      .map((b) => (b.innerText || "").replace(/\s+/g, " ").trim())
      .filter((x) => /1-Click Deduct Credit/i.test(x)),
    noRedundancyMsg: /No remaining redundancy/.test(t),
    raw: t.slice(0, 900),
  };
};

async function build() {
  const dl = plusDays(20);
  const id = await c.mutation("projects:createProject", {
    title: TITLE, location: "Austin, TX", projectType: "Class-A Commercial Mixed-Use",
    estBudget: 1600000, targetCompletionWeeks: 52, specDocumentText: `${TITLE} UI phantom probe.`,
    isDemoProject: false, generalContractorName: "QA30 Phantom GC",
  });
  const mkPkg = (csi, name, budget) =>
    c.mutation("tradePackages:createTradePackage", {
      projectId: id, csiDivision: csi, tradeName: name, budgetEstimate: budget,
      scopeSummary: `${name} scope.`, mandatoryInclusions: ["QA30 general scope per plans and specifications"], bidDeadline: dl,
    });
  const p26 = await mkPkg("26 00 00", "QA30 Phantom Electrical", 900000);
  const p23 = await mkPkg("23 00 00", "QA30 Phantom HVAC", 600000);
  const mkCtr = (pkgId, name, email, lic) =>
    c.mutation("contractors:createContractor", {
      tradePackageId: pkgId, companyName: name, contactEmail: email, phone: "+1 (206) 555-0199",
      licenseNumber: lic, licenseStatus: "Active / Verified (QA30)", sourceUrl: "https://qa30.example.invalid/license", rfqStatus: "invited",
    });
  const c26 = await mkCtr(p26, "AUDIT-QA30 Phantom Electric", "estimating@qa30-phantom-e.invalid", "TX-QA30-PHE");
  const c23 = await mkCtr(p23, "AUDIT-QA30 Phantom Mechanical", "estimating@qa30-phantom-m.invalid", "TX-QA30-PHM");
  const b26 = await c.mutation("bids:submitDirectBid", { tradePackageId: p26, contractorId: c26, subcontractorName: "AUDIT-QA30 Phantom Electric", baseBidAmount: 800000, coiComplianceStatus: "compliant", coiPenalty: 0 });
  const b23 = await c.mutation("bids:submitDirectBid", { tradePackageId: p23, contractorId: c23, subcontractorName: "AUDIT-QA30 Phantom Mechanical", baseBidAmount: 480000, coiComplianceStatus: "compliant", coiPenalty: 0 });
  return { id, p26, p23, b26, b23 };
}

async function main() {
  for (const p of ((await c.query("projects:listProjects", {})) || []).filter((x) => x.title === TITLE)) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try { await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA30 UI phantom purge executed record." }); } catch {}
    }
    try { await c.mutation("projects:deleteProject", { projectId: p._id }); } catch {}
  }
  await sleep(400);

  const f = await build();
  const ded = await c.mutation("coordination:deductDoubleBuyCredit", {
    projectId: f.id, clashId: "clash-vfd-01", tradePackageId: f.p23, deductAmount: 38500,
    description: "Variable Frequency Drives (VFDs) for AHUs & Pumps",
  });
  const bidBefore = (await c.query("bids:listByPackage", { tradePackageId: f.p23 })).find((b) => b._id === f.b23.bidId);

  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  try {
    await page.goto(`${BASE}/?project=${f.id}&tab=leveling&qa30=phantom`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
    await delay(1200);
    await selectProjectByTitle(page, TITLE);
    await delay(1200);
    await clickTab(page, "Bid Leveling");
    await delay(1500);
    const pkgSel = await page.evaluate((name) => {
      const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => (x.innerText || "").includes(name));
      if (!b) return { ok: false, available: [...document.querySelectorAll("button[aria-pressed]")].map((x) => (x.innerText || "").trim()) };
      b.click();
      return { ok: true, text: (b.innerText || "").trim() };
    }, "QA30 Phantom HVAC");
    await delay(1200);
    const adjustOpen = await clickText(page, "Adjust Leveling");
    await delay(900);

    const toggled = await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const cands = [...document.querySelectorAll("div")].filter(
        (el) => vis(el) && /Forensic Leveling Adjustments/.test(el.innerText || "") && /Save Leveling Adjustments/.test(el.innerText || "")
      );
      const top = cands.sort((a, b) => (a.innerText || "").length - (b.innerText || "").length)[0];
      if (!top) return { ok: false, reason: "no adjustment dialog" };
      const btns = [...top.querySelectorAll("button")].filter((b) => /Accepted|Accept Alternate/.test(b.innerText || ""));
      const inCreditRow = (b) => {
        let n = b;
        for (let i = 0; i < 6 && n; i++) {
          if (/Cross-Trade Clash Credit/.test(n.innerText || "")) return true;
          n = n.parentElement;
        }
        return false;
      };
      const btn = btns.find(inCreditRow) || btns[0];
      if (!btn) return { ok: false, reason: "toggle not found", body: (top.innerText || "").slice(0, 400) };
      const before = (btn.innerText || "").trim();
      btn.click();
      return { ok: true, before, buttonCount: btns.length };
    });
    await delay(900);
    const saveClick = await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const cands = [...document.querySelectorAll("div")].filter(
        (el) => vis(el) && /Forensic Leveling Adjustments/.test(el.innerText || "") && /Save Leveling Adjustments/.test(el.innerText || "")
      );
      const top = cands.sort((a, b) => (a.innerText || "").length - (b.innerText || "").length)[0];
      const b = top && [...top.querySelectorAll("button")].find((x) => /Save Leveling Adjustments/.test(x.innerText || ""));
      if (!b) return { ok: false };
      b.click();
      return { ok: true };
    });
    await delay(2500);

    const bidAfter = (await c.query("bids:listByPackage", { tradePackageId: f.p23 })).find((b) => b._id === f.b23.bidId);
    const detect = await c.query("coordination:detectCrossTradeClashes", { projectId: f.id });
    const card = detect.doubleBuys.find((x) => x.id === "clash-vfd-01");
    const veAfter = bidAfter?.valueEngineeringAlternates || [];

    await clickTab(page, "Scope Clash");
    await delay(1800);
    const ui = await page.evaluate(UI);
    await shot(page, "fix4-qa30-phantom-credit-ui.png", { full: true });

    record("A30-05.1", "UI reachable: Bid Leveling adjustment dialog exposes the cross-trade credit as a togglable alternate and the save re-levels the bid to $480,000",
      pkgSel.ok && adjustOpen.ok && toggled.ok && toggled.before === "✓ Accepted (-$38,500)" && saveClick.ok &&
        bidBefore?.leveledTotalCost === 441500 && bidAfter?.leveledTotalCost === 480000 &&
        veAfter.length === 1 && veAfter[0].isAccepted === false,
      { pkgSel, adjustOpen, toggled, saveClick, mockedBefore: bidBefore?.leveledTotalCost, leveledAfter: bidAfter?.leveledTotalCost, veAfter });

    record("A30-05.2", "STALE CREDIT: after the UI un-accepts the credit VE, coordination still shows 'Credit Deducted & Leveled' + $38,500 recoverable and the VFD deduct button stays hidden while no accepted credit exists in the bid",
      card?.status === "deducted" && card?.deductedAmount === 38500 &&
        ui.credits === "38,500" && ui.deductedChip && ui.resolutionClaim &&
        ui.deductButtonTexts.length === 1 && !ui.deductButtonTexts.some((x) => /38,500/.test(x)) &&
        bidAfter?.leveledTotalCost === 480000,
      { card: { status: card?.status, deductedAmount: card?.deductedAmount }, ui, note: "card shows the stale amount via the deductedAmount overlay; bid carries no accepted credit; the remaining 1-Click button belongs to the still-open disconnect card" });

    record("A30-05.3", "phantom probe diagnostics: zero page errors / console errors",
      diag.pageErrors.length === 0 && diag.consoleLogs.filter((l) => l.type === "error").length === 0,
      { pageErrors: diag.pageErrors.slice(0, 4), consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 4).map((e) => e.text.slice(0, 160)) });

    writeEvidence("ui-phantom", {
      projectId: f.id, p23: f.p23, deduct: ded,
      results,
      summary: { pass: results.filter((r) => r.pass).length, total: results.length },
    });
    writeLog("ui-phantom", log);
    console.log(`ui-phantom: ${results.filter((r) => r.pass).length}/${results.length}`);
  } catch (err) {
    writeEvidence("ui-phantom", { results: [...results, { id: "A30-05.ERR", pass: false, name: "aborted", detail: String(err?.stack ?? err) }], summary: { pass: results.filter((r) => r.pass).length, total: results.length + 1 } });
    writeLog("ui-phantom", [...log, String(err?.stack ?? err)]);
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("ui-phantom-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});