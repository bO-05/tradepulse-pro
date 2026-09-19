/**
 * QA34-04 UI reproduction of the two Medium state-machine findings on a fresh
 * AUDIT-QA34-EQUI project (created backend for speed; the precondition $26,500
 * manual VFD coverage is entered through the real leveling Adjust modal):
 *  1. apply both $12,000 credits, decline the VFD credit row in the UI
 *     -> VFD card STILL shows "Credit Deducted & Leveled $12,000" (phantom)
 *  2. re-accept, then Reverse the VFD credit from the card
 *     -> the disconnect $12,000 credit is silently removed too; bid restored $24,000.
 * Screenshots + KPI/backend reconciliation. No code changes.
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab, selectProjectByTitle } from "./lib.mjs";
import { client, fixtureTitle, writeEvidence, writeLog, sleep } from "./qa34-lib.mjs";

const c = client();
const BASE = "https://brainy-skunk-440.convex.site";
const TITLE = fixtureTitle("EQUI");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1600)}`);
};

async function clickText(page, needle, exact = false) {
  return page.evaluate(({ needle, exact }) => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const b = [...document.querySelectorAll("button")].find((x) => {
      const t = (x.innerText || "").replace(/\s+/g, " ").trim();
      return vis(x) && (exact ? t === needle : t.includes(needle));
    });
    if (!b) return { ok: false };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true, text: (b.innerText || "").replace(/\s+/g, " ").trim() };
  }, { needle, exact });
}

async function clickNth(page, needle, n) {
  return page.evaluate(({ needle, n }) => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const bs = [...document.querySelectorAll("button")].filter((x) => vis(x) && (x.innerText || "").includes(needle));
    const b = bs[n];
    if (!b) return { ok: false, count: bs.length };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true, text: (b.innerText || "").replace(/\s+/g, " ").trim(), count: bs.length };
  }, { needle, n });
}

async function selectPackage(page, name) {
  return page.evaluate((n) => {
    const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => (x.innerText || "").includes(n));
    if (!b) return { ok: false };
    b.click();
    return { ok: true };
  }, name);
}

async function openAdjust(page, rowNeedle) {
  return page.evaluate((rowNeedle) => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    let cand = null;
    for (const el of [...document.querySelectorAll("tr, div")].filter(vis)) {
      if ((el.innerText || "").includes(rowNeedle)) {
        if (!cand || el.innerText.length < cand.innerText.length) cand = el;
      }
    }
    if (!cand) return { ok: false, reason: "no row" };
    let node = cand;
    for (let i = 0; i < 8 && node; i++) {
      const b = [...node.querySelectorAll("button")].find((x) => vis(x) && (x.innerText || "").includes("Adjust"));
      if (b) { b.scrollIntoView({ block: "center" }); b.click(); return { ok: true, text: (b.innerText || "").trim() }; }
      node = node.parentElement;
    }
    return { ok: false, reason: "no adjust button" };
  }, rowNeedle);
}

async function setModalInput(page, placeholder, value) {
  return page.evaluate(({ placeholder, value }) => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const modals = [...document.querySelectorAll("div")].filter((d) => vis(d) && (d.innerText || "").includes("Forensic Leveling Adjustments") && (d.innerText || "").includes("Save Leveling Adjustments"));
    const top = modals.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!top) return false;
    const el = [...top.querySelectorAll("input")].find((i) => (i.getAttribute("placeholder") || "").includes(placeholder));
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return el.value === String(value);
  }, { placeholder, value });
}

async function toggleCredit(page, matchText) {
  return page.evaluate((matchText) => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const modals = [...document.querySelectorAll("div")].filter((d) => vis(d) && (d.innerText || "").includes("Forensic Leveling Adjustments") && (d.innerText || "").includes("Save Leveling Adjustments"));
    const top = modals.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!top) return { ok: false, reason: "no modal" };
    const rows = [...top.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("Cross-Trade Clash Credit") && (!matchText || (d.innerText || "").includes(matchText)) && d.querySelector("button"));
    const row = rows.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!row) return { ok: false, reason: "no matching credit row", text: (top.innerText || "").slice(0, 300) };
    const btn = [...row.querySelectorAll("button")][0];
    btn.click();
    return { ok: true, before: (btn.innerText || "").trim() };
  }, matchText);
}

async function uiKpis(page) {
  return page.evaluate(() => {
    const t = (document.querySelector("main") || document.body).innerText.replace(/\n/g, " ");
    const grab = (label) => new RegExp(label + "\\s*\\$?([\\d,]+)").exec(t)?.[1] ?? null;
    const labels = [...document.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim());
    return {
      doubleBuys: grab("Redundant Double-Buys"),
      credits: grab("Recoverable Buyout Credits"),
      deductedChips: (t.match(/credit deducted & leveled/gi) || []).length,
      staleButtons: labels.filter((x) => /Clear stale credit record/.test(x)).length,
      reverseButtons: labels.filter((x) => /Reverse credit/.test(x)).length,
      deductButtons: labels.filter((x) => /1-Click Deduct Credit/.test(x)).length,
    };
  });
}

const bidById = async (pkgId, bidId) => (await c.query("bids:listByPackage", { tradePackageId: pkgId })).find((b) => b._id === bidId);
const creditRowsOf = (b) => (b?.valueEngineeringAlternates || []).filter((v) => /^Cross-Trade Clash Credit:/.test(v.description));

async function main() {
  // fresh EQ-UI project
  for (const p of ((await c.query("projects:listProjects", {})) || []).filter((x) => x.title === TITLE)) {
    try { await c.mutation("projects:deleteProject", { projectId: p._id }); } catch {}
  }
  const dl = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  const id = await c.mutation("projects:createProject", { title: TITLE, location: "Austin, TX", projectType: "Class-A Commercial", estBudget: 1600000, targetCompletionWeeks: 52, specDocumentText: "QA34 EQ UI scope.", isDemoProject: false, generalContractorName: "QA34 EQ UI GC" });
  const p26 = await c.mutation("tradePackages:createTradePackage", { projectId: id, csiDivision: "26 00 00", tradeName: "QA34 EQUI Electrical", budgetEstimate: 900000, scopeSummary: "Electrical scope.", mandatoryInclusions: ["General scope"], bidDeadline: dl });
  const p23 = await c.mutation("tradePackages:createTradePackage", { projectId: id, csiDivision: "23 00 00", tradeName: "QA34 EQUI HVAC", budgetEstimate: 600000, scopeSummary: "HVAC scope.", mandatoryInclusions: ["General scope"], bidDeadline: dl });
  const c26 = await c.mutation("contractors:createContractor", { tradePackageId: p26, companyName: "AUDIT-QA34 EQUI Electric", contactEmail: "estimating@qa34-equi-e.invalid", phone: "+1 (206) 555-0101", licenseNumber: "TX-QA34-EQUI-E", licenseStatus: "Active / Verified (QA34)", sourceUrl: "https://qa34.example.invalid/license", rfqStatus: "invited" });
  const c23 = await c.mutation("contractors:createContractor", { tradePackageId: p23, companyName: "AUDIT-QA34 EQUI Mechanical", contactEmail: "estimating@qa34-equi-m.invalid", phone: "+1 (206) 555-0102", licenseNumber: "TX-QA34-EQUI-M", licenseStatus: "Active / Verified (QA34)", sourceUrl: "https://qa34.example.invalid/license", rfqStatus: "invited" });
  const b26 = await c.mutation("bids:submitDirectBid", { tradePackageId: p26, contractorId: c26, subcontractorName: "AUDIT-QA34 EQUI Electric", baseBidAmount: 800000, coiComplianceStatus: "compliant", coiPenalty: 0 });
  const b23 = await c.mutation("bids:submitDirectBid", { tradePackageId: p23, contractorId: c23, subcontractorName: "AUDIT-QA34 EQUI Mechanical", baseBidAmount: 480000, coiComplianceStatus: "compliant", coiPenalty: 0 });
  say(`project=${id} p23=${p23} bid23=${b23.bidId}`);

  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  try {
    await page.goto(`${BASE}/?qa34=equi`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
    await selectProjectByTitle(page, TITLE);
    await delay(1500);

    // 1. precondition via the real leveling UI: add accepted manual VFD credit $26,500
    await clickTab(page, "Bid Leveling");
    await delay(1600);
    await selectPackage(page, "QA34 EQUI HVAC");
    await delay(1200);
    const openAdj = await openAdjust(page, "AUDIT-QA34 EQUI Mechanical");
    await delay(900);
    const descSet = await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const modals = [...document.querySelectorAll("div")].filter((d) => vis(d) && (d.innerText || "").includes("Forensic Leveling Adjustments") && (d.innerText || "").includes("Save Leveling Adjustments"));
      const top = modals.sort((a, b) => a.innerText.length - b.innerText.length)[0];
      const el = top && [...top.querySelectorAll("input")].find((i) => (i.getAttribute("placeholder") || "").includes("Add new VE alternate"));
      if (!el) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "VFD factory pricing credit (manual entry)");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value.length > 0;
    });
    const amtSet = await setModalInput(page, "Deduct $", 26500);
    const addAlt = await clickText(page, "Add Alternate");
    await delay(500);
    const saveAlt = await clickText(page, "Save Leveling Adjustments");
    const b1 = await bidById(p23, b23.bidId);
    const detect1 = await c.query("coordination:detectCrossTradeClashes", { projectId: id });
    const vfd1 = detect1.doubleBuys.find((x) => x.id === "clash-vfd-01");
    const disc1 = detect1.doubleBuys.find((x) => x.id === "clash-disconnect-02");
    record("A34-04.1", "precondition entered through the real leveling UI: accepted manual VFD $26,500 -> bid 453,500, both clash redundancies exactly $12,000",
      descSet && amtSet && addAlt.ok && saveAlt.ok && b1.leveledTotalCost === 453500 && vfd1.redundantAmount === 12000 && disc1.redundantAmount === 12000,
      { openAdj, b23: { leveled: b1.leveledTotalCost, ve: b1.valueEngineeringAlternates }, vfd: vfd1.redundantAmount, disc: disc1.redundantAmount });

    // 2. apply BOTH $12,000 credits from the UI
    await clickTab(page, "Scope Clash");
    await delay(1600);
    const k0 = await uiKpis(page);
    const ded1 = await clickNth(page, "1-Click Deduct Credit", 0);
    const b2 = await pollBid(p23, b23.bidId, (b) => b?.leveledTotalCost === 441500);
    await delay(1000);
    const ded2 = await clickNth(page, "1-Click Deduct Credit", 0);
    const b3 = await pollBid(p23, b23.bidId, (b) => b?.leveledTotalCost === 429500);
    await delay(1200);
    const k1 = await uiKpis(page);
    record("A34-04.2", "both credits applied through the UI: bid 429,500, KPI credits $24,000, 2 deducted chips",
      k0.doubleBuys === "24,000" && ded1.ok && ded2.ok && b3.leveledTotalCost === 429500 && k1.credits === "24,000" && k1.deductedChips === 2,
      { ded1, ded2, leveled: b3.leveledTotalCost, k0, k1 });

    // 3. decline ONLY the VFD credit row in the leveling UI
    await clickTab(page, "Bid Leveling");
    await delay(1500);
    await selectPackage(page, "QA34 EQUI HVAC");
    await delay(1000);
    await openAdjust(page, "AUDIT-QA34 EQUI Mechanical");
    await delay(900);
    const t1 = await toggleCredit(page, "Variable Frequency");
    await delay(300);
    const saveDecline = await clickText(page, "Save Leveling Adjustments");
    const b4 = await pollBid(p23, b23.bidId, (b) => b?.leveledTotalCost === 441500);
    const rows4 = creditRowsOf(b4).map((v) => ({ a: v.costDeduct, acc: v.isAccepted, vfd: /Variable Frequency/.test(v.description) }));
    record("A34-04.3", "VFD credit declined via the UI toggle + Save: bid back to 441,500, VFD row isAccepted=false, disconnect row still accepted",
      t1.ok && saveDecline.ok && b4.leveledTotalCost === 441500 && rows4.length === 2 && rows4.some((r) => r.vfd && r.acc === false) && rows4.some((r) => !r.vfd && r.acc === true),
      { toggle: t1, rows: rows4, leveled: b4.leveledTotalCost });

    // 4. phantom check in the UI
    await clickTab(page, "Scope Clash");
    await delay(1600);
    const k2 = await uiKpis(page);
    const detect2 = await c.query("coordination:detectCrossTradeClashes", { projectId: id });
    const vfd2 = detect2.doubleBuys.find((x) => x.id === "clash-vfd-01");
    await shot(page, "fix4-qa34-eq-phantom-credit.png", { full: true });
    const phantom = vfd2.status === "deducted" && k2.credits === "24,000" && k2.deductedChips === 2 && b4.leveledTotalCost === 441500;
    if (phantom) {
      results.push({
        id: "A34-01",
        name: "UI phantom credit: VFD card claims 'Credit Deducted & Leveled $12,000' while its own credit is declined; KPI $24,000 vs $12,000 actually deducted",
        pass: false,
        detail: {
          severity: "Medium",
          card: { status: vfd2.status, deductedAmount: vfd2.deductedAmount, staleResolution: vfd2.staleResolution },
          uiKpiCredits: k2.credits,
          uiDeductedChips: k2.deductedChips,
          backendBidLeveled: b4.leveledTotalCost,
          realAcceptedCredit: 12000,
          screenshot: "evidence/fix4-qa34-eq-phantom-credit.png",
        },
      });
      say("FINDING A34-01 [Medium] UI phantom credit confirmed");
    }
    record("A34-04.4", "no phantom deducted card after declining the VFD credit", !phantom, { vfd2: { status: vfd2.status, amount: vfd2.deductedAmount }, k2, leveled: b4.leveledTotalCost });

    // 5. re-accept the VFD row, then reverse VFD from the card
    await clickTab(page, "Bid Leveling");
    await delay(1500);
    await selectPackage(page, "QA34 EQUI HVAC");
    await delay(1000);
    await openAdjust(page, "AUDIT-QA34 EQUI Mechanical");
    await delay(900);
    const t2 = await toggleCredit(page, "Variable Frequency");
    await delay(300);
    await clickText(page, "Save Leveling Adjustments");
    const b5 = await pollBid(p23, b23.bidId, (b) => b?.leveledTotalCost === 429500);
    record("A34-04.5", "VFD credit re-accepted through the UI: bid back to 429,500, both credits live", t2.ok && b5.leveledTotalCost === 429500, { toggle: t2, leveled: b5.leveledTotalCost });

    await clickTab(page, "Scope Clash");
    await delay(1600);
    const rev = await clickNth(page, "Reverse credit", 0);
    const b6 = await pollBid(p23, b23.bidId, (b) => b?.leveledTotalCost >= 440000);
    await delay(1600);
    const k3 = await uiKpis(page);
    const detect3 = await c.query("coordination:detectCrossTradeClashes", { projectId: id });
    const disc3 = detect3.doubleBuys.find((x) => x.id === "clash-disconnect-02");
    const rows6 = creditRowsOf(b6);
    await shot(page, "fix4-qa34-eq-over-reverse.png", { full: true });
    const overReversed = rev.ok && b6.leveledTotalCost === 453500 && rows6.length === 0 && disc3.status === "detected" && disc3.staleResolution === true;
    const isolated = rev.ok && b6.leveledTotalCost === 441500 && rows6.length === 1 && /disconnect/i.test(rows6[0]?.description || "");
    if (overReversed) {
      results.push({
        id: "A34-02",
        name: "UI reverse of the VFD credit removed the disconnect credit too: bid restored by $24,000 (453,500) while the reverse toast/audit claim $12,000; disconnect card goes stale",
        pass: false,
        detail: {
          severity: "Medium",
          reverseClick: rev.text,
          backendBidLeveled: b6.leveledTotalCost,
          expectedIfHonest: 441500,
          remainingCreditRows: rows6.length,
          disconnectCard: { status: disc3.status, staleResolution: disc3.staleResolution },
          uiKpi: k3,
          screenshot: "evidence/fix4-qa34-eq-over-reverse.png",
        },
      });
      say("FINDING A34-02 [Medium] UI over-reversal confirmed");
    }
    record("A34-04.6", "reverse VFD only, disconnect credit survives, bid 441,500", isolated, { rev, leveled: b6.leveledTotalCost, rows: rows6.map((v) => ({ a: v.costDeduct, d: String(v.description).slice(0, 40) })), disc3: { status: disc3.status, stale: disc3.staleResolution } });

    // 6. diagnostics
    const consoleErrors = diag.consoleLogs.filter((l) => l.type === "error");
    record("A34-04.7", "EQ UI run diagnostics: zero pageerrors, zero failed app requests",
      diag.pageErrors.length === 0 && diag.failedRequests.filter((f) => !/favicon/i.test(f)).length === 0,
      { pageErrors: diag.pageErrors.slice(0, 3), consoleErrors: consoleErrors.slice(0, 3).map((e) => e.text.slice(0, 120)), failed: diag.failedRequests.slice(0, 3) });

    writeEvidence("eq-ui", { projectId: id, p23, bid23: b23.bidId, results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
    writeLog("eq-ui", log);
    console.log(`eq-ui: ${results.filter((r) => r.pass).length}/${results.length} pass`);
  } catch (err) {
    writeEvidence("eq-ui", { results: [...results, { id: "A34-04.ERR", pass: false, name: "aborted", detail: String(err?.stack ?? err) }] });
    writeLog("eq-ui", [...log, String(err?.stack ?? err)]);
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

async function pollBid(pkgId, bidId, pred, timeoutMs = 45000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    last = await c.query("bids:listByPackage", { tradePackageId: pkgId }).then((bs) => bs.find((b) => b._id === bidId));
    if (pred(last)) return last;
    await sleep(1200);
  }
  return last;
}

main().catch((e) => {
  console.error(e);
  writeLog("eq-ui-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});