/**
 * QA36-06 UI-reachability probe for the A36-01 cross-package phantom clear.
 *
 * Path (all real clicks):
 *  1. Project with Div26 + a Div23 package stored as "23 01 00" named "HVAC"
 *     (the tour's exact-match finder and the card's startsWith("23") finder disagree).
 *  2. Select the ELECTRICAL package, open the demo tour, go to the Scope Clash scene
 *     and click its action ("Advance to Subcontract Execution"):
 *     the tour deducts the VFD credit on the active (Electrical) package.
 *  3. The coordination card shows deducted; click "Reverse credit" (the card always
 *     passes the first "23*" package). The backend then treats it as a stale record,
 *     clears it, and the money stays deducted on the Electrical bid.
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab, selectProjectByTitle } from "./lib.mjs";
import {
  client, fixtureTitle, writeEvidence, writeLog, sleep,
  creditInvariants, getBid, creditRows, creditClashId, CLASH_VFD, VFD_TITLE, EVIDENCE_DIR,
} from "./qa36-lib.mjs";

const c = client();
const BASE = "https://brainy-skunk-440.convex.site";
const TITLE = fixtureTitle("TOUR");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1600)}`);
};
const rows = (b) => creditRows(b).map((r) => ({ id: creditClashId(r.description), a: r.costDeduct || 0, acc: !!r.isAccepted }));
const card = (inv, id) => inv.cards.find((x) => x.id === id);

async function purgeTour(cx = c) {
  const projects = (await cx.query("projects:listProjects", {})) || [];
  for (const p of projects.filter((x) => x.title === TITLE)) {
    const agrs = (await cx.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try { await cx.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA36 tour probe teardown." }); } catch {}
    }
    try { await cx.mutation("projects:deleteProject", { projectId: p._id }); } catch {}
    await sleep(250);
  }
}

async function main() {
  await purgeTour();
  const dl = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  const pid = await c.mutation("projects:createProject", {
    title: TITLE, location: "Austin, TX", projectType: "Class-A Commercial Mixed-Use",
    estBudget: 1600000, targetCompletionWeeks: 52, specDocumentText: "QA36 tour reachability fixture.",
    isDemoProject: false, generalContractorName: "QA36 Tour GC",
  });
  const p26 = await c.mutation("tradePackages:createTradePackage", { projectId: pid, csiDivision: "26 00 00", tradeName: "QA36 TOUR Electrical", budgetEstimate: 900000, scopeSummary: "Electrical scope.", mandatoryInclusions: ["Per plans"], bidDeadline: dl });
  const p23 = await c.mutation("tradePackages:createTradePackage", { projectId: pid, csiDivision: "23 01 00", tradeName: "HVAC", budgetEstimate: 600000, scopeSummary: "HVAC scope.", mandatoryInclusions: ["Per plans"], bidDeadline: dl });
  const c26 = await c.mutation("contractors:createContractor", { tradePackageId: p26, companyName: "AUDIT-QA36 TOUR Electric", contactEmail: "estimating@qa36-tour-e.invalid", licenseNumber: "TX-QA36-TE", licenseStatus: "Active / Verified", sourceUrl: "https://qa36.example.invalid/te", rfqStatus: "invited" });
  const c23 = await c.mutation("contractors:createContractor", { tradePackageId: p23, companyName: "AUDIT-QA36 TOUR Mechanical", contactEmail: "estimating@qa36-tour-m.invalid", licenseNumber: "TX-QA36-TM", licenseStatus: "Active / Verified", sourceUrl: "https://qa36.example.invalid/tm", rfqStatus: "invited" });
  const b26 = await c.mutation("bids:submitDirectBid", { tradePackageId: p26, contractorId: c26, subcontractorName: "AUDIT-QA36 TOUR Electric", baseBidAmount: 800000, identifiedExclusions: [], valueEngineeringAlternates: [], longLeadEquipmentWeeks: 8, leadTimePenalty: 0, coiComplianceStatus: "compliant", coiPenalty: 0 });
  await c.mutation("bids:submitDirectBid", { tradePackageId: p23, contractorId: c23, subcontractorName: "AUDIT-QA36 TOUR Mechanical", baseBidAmount: 480000, identifiedExclusions: [], valueEngineeringAlternates: [], longLeadEquipmentWeeks: 8, leadTimePenalty: 0, coiComplianceStatus: "compliant", coiPenalty: 0 });

  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  try {
    await page.goto(`${BASE}/?qa36=tour`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
    await delay(700);
    const sel = await selectProjectByTitle(page, TITLE);
    await delay(1800);

    // select the ELECTRICAL package as active
    await clickTab(page, "Discovery");
    await delay(1400);
    const pkgSel = await page.evaluate(() => {
      const bs = [...document.querySelectorAll("button[aria-pressed]")];
      const b = bs.find((x) => (x.innerText || "").includes("QA36 TOUR Electrical"));
      if (!b) return { ok: false, available: bs.map((x) => (x.innerText || "").trim()) };
      b.click(); return { ok: true, text: b.innerText.replace(/\s+/g, " ").trim() };
    });
    await delay(900);

    // open the tour, go to the Scope Clash scene, run its action
    const tourOpen = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Toggle Investor Demo Tour"));
      if (!b) return { ok: false };
      b.click(); return { ok: true, text: (b.innerText || "").trim() };
    });
    await delay(900);
    await clickTab(page, "Scope Clash");
    await delay(1500);
    const runScene = await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const b = [...document.querySelectorAll("button")].find((x) => vis(x) && /Advance to Subcontract Execution/.test(x.innerText || ""));
      if (!b) return { ok: false, texts: [...document.querySelectorAll("button")].map((x) => (x.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 60) };
      b.click(); return { ok: true };
    });
    const b26after = await (async () => {
      const t0 = Date.now();
      let b = null;
      while (Date.now() - t0 < 40000) {
        b = await getBid(c, pid, b26.bidId);
        if ((b.valueEngineeringAlternates || []).length > 0) return b;
        await sleep(1200);
      }
      return b;
    })();
    await delay(1200);
    const wrongCarrier = b26after?.leveledTotalCost === 761500 && creditRows(b26after).some((r) => r.isAccepted && creditClashId(r.description) === CLASH_VFD);
    record("A36-TR.01", "tour coordination scene deposited the VFD credit on the ELECTRICAL bid (761,500) because the HVAC package is '23 01 00'/'HVAC' and the electrical package was active",
      sel.ok && pkgSel.ok && tourOpen.ok && runScene.ok && wrongCarrier,
      { sel, pkgSel, tourOpen, runScene, electrical: { leveled: b26after?.leveledTotalCost, rows: rows(b26after) } });

    // back to Scope Clash: card must render deducted + Reverse control
    await clickTab(page, "Scope Clash");
    await delay(1600);
    const preRev = await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const t = (document.querySelector("main") || document.body).innerText.replace(/\n/g, " ");
      return {
        credits: /Recoverable Buyout Credits\s*\$?([\d,]+)/.exec(t)?.[1] ?? null,
        chips: (t.match(/credit deducted & leveled/gi) || []).length,
        reverse: [...document.querySelectorAll("button")].filter((x) => vis(x) && /Reverse credit/.test(x.innerText || "")).length,
      };
    });
    await shot(page, "fix4-qa36-tour-before-reverse.png", { full: true });

    // real click the card's Reverse credit (passes the first 23* package)
    const rev = await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const b = [...document.querySelectorAll("button")].find((x) => vis(x) && /Reverse credit/.test(x.innerText || ""));
      if (!b) return { ok: false };
      b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect();
      return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (rev.ok) await page.mouse.click(rev.x, rev.y);
    await delay(2500);
    const toast = await page.evaluate(() => (document.querySelector('[role="status"][aria-live="polite"]') || {}).innerText || null);
    const postRev = await page.evaluate(() => {
      const t = (document.querySelector("main") || document.body).innerText.replace(/\n/g, " ");
      return {
        credits: /Recoverable Buyout Credits\s*\$?([\d,]+)/.exec(t)?.[1] ?? null,
        chips: (t.match(/credit deducted & leveled/gi) || []).length,
        stale: [...document.querySelectorAll("button")].filter((x) => /Clear stale credit record/.test(x.innerText || "")).length,
        reverse: [...document.querySelectorAll("button")].filter((x) => /Reverse credit/.test(x.innerText || "")).length,
        buys: /Redundant Double-Buys\s*\$?([\d,]+)/.exec(t)?.[1] ?? null,
      };
    });
    const b26final = await getBid(c, pid, b26.bidId);
    const inv = await creditInvariants(c, pid);
    await shot(page, "fix4-qa36-tour-after-reverse.png", { full: true });
    const reproduced = rev.ok && b26final.leveledTotalCost === 761500 && creditRows(b26final).some((r) => r.isAccepted) &&
      inv.claimsTotal === 0 && inv.actualTotal === 38500 && card(inv, CLASH_VFD).status === "detected" && !card(inv, CLASH_VFD).staleResolution;
    record("A36-TR.02", "real-click Reverse credit on the card silently phantom-clears: Electrical bid still 761,500 with the accepted marker, card flips to detected, UI credits $0 (toast claims the cost was restored)",
      reproduced,
      { toast, electrical: { leveled: b26final.leveledTotalCost, rows: rows(b26final) }, ui: postRev, backend: inv.summary, card: { st: card(inv, CLASH_VFD).status, amt: card(inv, CLASH_VFD).deductedAmount, stale: card(inv, CLASH_VFD).staleResolution ?? false } });

    writeEvidence("tour-reach", {
      projectId: pid, electricalBid: b26.bidId, results,
      pageErrors: diag.pageErrors.slice(0, 5), consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 5).map((e) => e.text.slice(0, 160)),
      summary: { pass: results.filter((r) => r.pass).length, total: results.length, reproduced },
    });
    writeLog("tour-reach", log);
    console.log(`tour-reach: ${results.filter((r) => r.pass).length}/${results.length} reproduced=${reproduced}`);
  } catch (err) {
    writeEvidence("tour-reach", { results: [...results, { id: "A36-TR.ERR", pass: false, name: "aborted", detail: String(err?.stack ?? err) }], summary: { pass: results.filter((r) => r.pass).length, total: results.length + 1 } });
    writeLog("tour-reach", [...log, String(err?.stack ?? err)]);
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    await purgeTour();
  }
}

main().catch(async (e) => {
  console.error(e);
  writeLog("tour-reach-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});