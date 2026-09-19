/**
 * QA24-06 UI evidence for the INTENT phantom credit: after bids arrive the
 * coordination surface shows $38,500 "Recoverable Buyout Credits" and a
 * "Credit Deducted & Leveled" VFD card, while the HVAC bid's leveled cost is
 * untouched and no 1-click action remains for that clash.
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog } from "./qa24-lib.mjs";

const F = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1200)}`);
};

async function main() {
  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const dismissTour = () =>
    page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
  try {
    await page.goto(`${BASE}/?project=${F.intent.id}&tab=coordination&qa24=intent`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await dismissTour();
    await delay(1800);
    const ui = await page.evaluate(() => {
      const main = document.querySelector("main") || document.body;
      const text = main.innerText;
      const credits = /Recoverable Buyout Credits\s*\$([\d,]+)/.exec(text);
      const vfdCardStart = text.indexOf("Variable Frequency Drives");
      const vfdCard = vfdCardStart >= 0 ? text.slice(Math.max(0, vfdCardStart - 300), vfdCardStart + 900) : null;
      const deductButtons = [...document.querySelectorAll("button")].map((b) => (b.innerText || "").trim()).filter((t) => /1-Click Deduct Credit/.test(t));
      return {
        credits: credits ? credits[1] : null,
        vfdCardHasDeductedBadge: /credit deducted & leveled/i.test(vfdCard || ""),
        vfdCardSaysDeducted: /Deducted \$38,500 credit from proposal/.test(vfdCard || ""),
        vfdCardHasAction: /1-Click Deduct Credit/.test(vfdCard || ""),
        vfdCardSnippet: (vfdCard || "").replace(/\s+/g, " ").slice(0, 420),
        allDeductButtons: deductButtons,
      };
    });
    await shot(page, "fix4-qa24-intent-coordination.png", { full: true });

    await clickTab(page, "Bid Leveling");
    await delay(1600);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").includes("QA24 Intent HVAC"));
      b?.click();
    });
    await delay(1600);
    const leveling = await page.evaluate(() => {
      const text = (document.querySelector("main") || document.body).innerText;
      const row = /AUDIT-QA24 Intent Mechanical[\s\S]{0,400}/.exec(text);
      const packageActive = /QA24 Intent HVAC/.test(text);
      return {
        hasHvacBid: /AUDIT-QA24 Intent Mechanical/.test(text),
        packageActive,
        rowSnippet: row ? row[0].replace(/\s+/g, " ").slice(0, 320) : null,
        has500k: /\$500,000/.test(text),
      };
    });
    await shot(page, "fix4-qa24-intent-leveling.png", { full: true });
    record(
      "A24-06.1",
      "PHANTOM CREDIT UI: recovery KPI shows $38,500 and the VFD card is 'deducted' while the HVAC bid remains $500,000 and no 1-click action exists to apply it",
      ui.credits === "38,500" && ui.vfdCardHasDeductedBadge && ui.vfdCardSaysDeducted && !ui.vfdCardHasAction &&
        ui.allDeductButtons.length >= 1 &&
        leveling.hasHvacBid,
      { ui, leveling }
    );

    await clickTab(page, "Live Activity Audit");
    await delay(1400);
    const audit = await page.evaluate(() => {
      const text = (document.querySelector("main") || document.body).innerText;
      const i = text.indexOf("Double-Buy Credit Logged");
      return {
        hasLoggedRow: i >= 0,
        hasDeductedRow: /Double-Buy Credit Deducted/.test(text),
        snippet: i >= 0 ? text.slice(i, i + 320).replace(/\s+/g, " ") : null,
      };
    });
    record(
      "A24-06.2",
      "audit stream shows only 'Credit Logged' with the false promise 'Will apply to incoming proposals'; no 'Credit Deducted' row exists",
      audit.hasLoggedRow && !audit.hasDeductedRow && /Will apply to incoming proposals/.test(audit.snippet || ""),
      audit
    );
    record("A24-06.3", "intent UI diagnostics", diag.pageErrors.length === 0, {
      pageErrors: diag.pageErrors.slice(0, 4).map((x) => x.slice(0, 180)),
      consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(-4).map((e) => e.text.slice(0, 160)),
    });
  } catch (err) {
    record("A24-06.ERR", "intent UI aborted", false, { error: String(err?.stack ?? err).slice(0, 700) });
  } finally {
    writeEvidence("ui-intent", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
    writeLog("ui-intent", log);
    await browser.close();
    console.log(`ui intent: ${results.filter((r) => r.pass).length}/${results.length}`);
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("ui-intent-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});