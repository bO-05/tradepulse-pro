/**
 * QA37-03 UI tour-fallback reproduction (live site; mirrors QA36-06).
 *
 * Fixture TOUR: Div26 "QA37 TOUR Electrical" + a Div23 package stored as
 * "23 01 00" named "HVAC" (the tour's exact-match finder and the card's
 * startsWith("23") finder disagree). Select the ELECTRICAL package, open the
 * demo tour, go to the Scope Clash scene, click its action: the tour deducts
 * the VFD credit on the active (Electrical) package. The coordination card
 * shows deducted; click "Reverse credit" (the card passes the sibling "23*"
 * HVAC package id).
 *
 * Post-FIX-NEW-77 expectation: the backend finds the carrier on the ELECTRICAL
 * bid, removes the credit, restores 800,000, leaves the card detected (not
 * stale), shows the actual $38,500 reversal in the audit, and strands nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab, selectProjectByTitle } from "./lib.mjs";
import {
  client, readEvidence, fixtureTitle, writeEvidence, writeLog, sleep,
  creditInvariants, getBid, creditRows, creditClashId, logs,
  REVERSED_AUDIT_RX, CLEARED_AUDIT_RX, CLASH_VFD,
} from "./qa37-lib.mjs";

const F = readEvidence("fixtures");
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

async function main() {
  const pid = F.tour.id;
  const b26 = F.tour.b26.bidId;

  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  try {
    await page.goto(`${BASE}/?qa37=tour`, { waitUntil: "domcontentloaded", timeout: 90000 });
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
      const b = bs.find((x) => (x.innerText || "").includes("QA37 TOUR Electrical"));
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
        b = await getBid(c, pid, b26);
        if ((b.valueEngineeringAlternates || []).length > 0) return b;
        await sleep(1200);
      }
      return b;
    })();
    await delay(1200);
    const wrongCarrier = b26after?.leveledTotalCost === 761500 && rows(b26after).some((r) => r.acc && r.id === CLASH_VFD);
    record("A37-TR.01", "precondition (same tour fallback as QA36): the coordination scene deposits the VFD credit on the ELECTRICAL bid (761,500) because HVAC is '23 01 00'/'HVAC' and Electrical is active",
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
    await shot(page, "fix4-qa37-tour-before-reverse.png", { full: true });

    // real click the card's Reverse credit (passes the sibling 23* package)
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
    const b26final = await getBid(c, pid, b26);
    const inv = await creditInvariants(c, pid);
    const allLogs = await logs(c, pid, 200);
    const revAudit = allLogs.find((l) => REVERSED_AUDIT_RX.test(l.title || "")) || null;
    const clearAudit = allLogs.find((l) => CLEARED_AUDIT_RX.test(l.title || "")) || null;
    await shot(page, "fix4-qa37-tour-after-reverse.png", { full: true });

    const vfdCard = card(inv, CLASH_VFD);
    const fixed = rev.ok &&
      b26final.leveledTotalCost === 800000 &&
      rows(b26final).length === 0 &&
      inv.summary.acceptedCredits === 0 && inv.summary.claimsTotal === 0 && inv.summary.actualTotal === 0 &&
      inv.clean &&
      vfdCard.status === "detected" && !vfdCard.staleResolution &&
      postRev.stale === 0 && postRev.reverse === 0 && postRev.chips === 0 &&
      !clearAudit &&
      Boolean(revAudit) && /38,500/.test(revAudit.title || "");
    const detail = {
      toast, electrical: { leveled: b26final?.leveledTotalCost, rows: rows(b26final) }, ui: postRev, backend: inv.summary,
      card: { st: vfdCard.status, stale: vfdCard.staleResolution ?? false },
      revAudit: revAudit && { title: revAudit.title, pkgIsCarrier: revAudit.tradePackageId === F.tour.p26 },
      clearAuditSeen: Boolean(clearAudit), clean: inv.clean,
    };
    record("A37-TR.02", "real-click Reverse credit on the card now finds the sibling-package carrier: Electrical bid restored to 800,000, credit row removed, card detected (no stale), UI consistent, audit $38,500, no phantom clear",
      fixed, detail);
    if (!fixed) {
      results.push({ id: "A37-TR.FIND", name: "tour fallback reversal still broken", pass: false, detail });
    }

    writeEvidence("tour-reach", {
      projectId: pid, electricalBid: b26, results,
      pageErrors: diag.pageErrors.slice(0, 5), consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 5).map((e) => e.text.slice(0, 160)),
      summary: { pass: results.filter((r) => r.pass).length, total: results.length, fixed },
    });
    writeLog("tour-reach", log);
    console.log(`tour-reach: ${results.filter((r) => r.pass).length}/${results.length} fixed=${fixed}`);
    if (!fixed) process.exitCode = 2;
  } catch (err) {
    writeEvidence("tour-reach", { results: [...results, { id: "A37-TR.ERR", pass: false, name: "aborted", detail: String(err?.stack ?? err) }], summary: { pass: results.filter((r) => r.pass).length, total: results.length + 1 } });
    writeLog("tour-reach", [...log, String(err?.stack ?? err)]);
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch(async (e) => {
  console.error(e);
  writeLog("tour-reach-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});