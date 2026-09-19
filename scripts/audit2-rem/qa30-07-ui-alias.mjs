/**
 * QA30-07 UI evidence for the /Switch/ manual-coverage alias collision:
 *  MAN project: HVAC bid carries an accepted "Switchgear package value engineering
 *  credit" $20,000 (no disconnect scope in it). The coordination tab must still show
 *  the disconnect card. Instead it renders $0 / "No remaining redundancy — an accepted
 *  alternate already covers this double-buy" and removes the 1-click deduct control.
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab, selectProjectByTitle } from "./lib.mjs";
import { client, fixtureTitle, readEvidence, writeEvidence, writeLog } from "./qa30-lib.mjs";

const c = client();
const BASE = "https://brainy-skunk-440.convex.site";
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1500)}`);
};

async function main() {
  // Put the unrelated accepted switchgear credit back on the HVAC bid.
  await c.mutation("bids:updateBidAdjustments", {
    bidId: F.man.b23.bidId,
    identifiedExclusions: [],
    valueEngineeringAlternates: [
      { description: "Cross-Trade Clash Credit: Deduct redundant Variable Frequency Drives (VFDs) for AHUs & Pumps", costDeduct: 37500, isAccepted: true },
      { description: "Switchgear package value engineering credit (manual entry)", costDeduct: 20000, isAccepted: true },
    ],
    leadTimePenalty: 0,
    coiPenalty: 0,
  });
  const b23 = (await c.query("bids:listByPackage", { tradePackageId: F.man.p23 })).find((b) => b._id === F.man.b23.bidId);
  const detect = await c.query("coordination:detectCrossTradeClashes", { projectId: F.man.id });
  const disc = detect.doubleBuys.find((x) => x.id === "clash-disconnect-02");

  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  try {
    await page.goto(`${BASE}/?project=${F.man.id}&tab=coordination&qa30=alias`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
    await delay(1000);
    await selectProjectByTitle(page, "AUDIT-QA30-MAN");
    await delay(1500);
    await clickTab(page, "Scope Clash");
    await delay(1800);
    const ui = await page.evaluate(() => {
      const t = (document.querySelector("main") || document.body).innerText.replace(/\s+/g, " ");
      const i = t.indexOf("Rooftop Mechanical Equipment Disconnect Switches");
      return {
        slice: i >= 0 ? t.slice(i, i + 900) : "",
        kpiDoubleBuys: /Redundant Double-Buys\s*\$?([\d,]+)/.exec(t)?.[1] ?? null,
        noRedundancy: /No remaining redundancy/i.test(t),
        deductButtonTexts: [...document.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()).filter((x) => /1-Click Deduct Credit/i.test(x)),
      };
    });
    await shot(page, "fix4-qa30-alias-disconnect-suppressed.png", { full: true });
    record("A30-07.1", "UI: unrelated accepted $20,000 'Switchgear ... credit' renders the disconnect double-buy as $0 with 'No remaining redundancy — an accepted alternate already covers this double-buy', drops the recoverable-exposure KPI to $0 and removes its 1-click control",
      disc?.status === "detected" && disc?.redundantAmount === 0 &&
        ui.kpiDoubleBuys === "0" && ui.noRedundancy &&
        !ui.deductButtonTexts.some((x) => /12,000/.test(x)) &&
        (b23?.valueEngineeringAlternates || []).every((v) => !/disconnect/i.test(v.description)),
      { card: { status: disc?.status, amt: disc?.redundantAmount }, kpiDoubleBuys: ui.kpiDoubleBuys, note: "VFD card was credited earlier in the credit matrix, so active exposure is the disconnect card alone", noRedundancy: ui.noRedundancy, deductButtons: ui.deductButtonTexts, certifiedScope: (b23?.valueEngineeringAlternates || []).map((v) => v.description), slice: ui.slice.slice(0, 700) });

    record("A30-07.2", "alias probe diagnostics: zero page errors / console errors",
      diag.pageErrors.length === 0 && diag.consoleLogs.filter((l) => l.type === "error").length === 0,
      { pageErrors: diag.pageErrors.slice(0, 3), consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 3).map((e) => e.text.slice(0, 140)) });

    writeEvidence("ui-alias", { projectId: F.man.id, results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
    writeLog("ui-alias", log);
    console.log(`ui-alias: ${results.filter((r) => r.pass).length}/${results.length}`);
  } catch (err) {
    writeEvidence("ui-alias", { results: [...results, { id: "A30-07.ERR", pass: false, name: "aborted", detail: String(err?.stack ?? err) }] });
    writeLog("ui-alias", [...log, String(err?.stack ?? err)]);
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("ui-alias-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});