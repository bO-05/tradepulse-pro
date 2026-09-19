import { launchBrowser, attachDiagnostics, waitForAppReady, delay, clickTab, setInputValue, shot } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog } from "./qa18-lib.mjs";

const fx = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const out = {};

async function clickAny(page, text, scope = null) {
  return page.evaluate((t, sc) => {
    const root = sc ? document.querySelector(sc) : document;
    const b = [...root.querySelectorAll("button")].find((x) => (x.textContent || "").includes(t));
    if (!b) return { ok: false };
    b.click();
    return { ok: true, text: (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60) };
  }, text, scope);
}

async function clickIn(page, scopeSel, text) {
  return clickAny(page, text, scopeSel);
}

async function dialogValues(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return { dialog: false };
    const out = { dialog: true };
    dialog.querySelectorAll("input, textarea, select").forEach((el, i) => {
      const key = el.getAttribute("aria-label") || el.getAttribute("placeholder") || `${el.tagName.toLowerCase()}#${i}`;
      if (el.tagName === "SELECT") out[key] = el.options[el.selectedIndex] ? el.options[el.selectedIndex].textContent.trim() : el.value;
      else out[key] = el.value;
    });
    return out;
  });
}

async function main() {
  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.goto(`${BASE}/?project=${fx.vol.id}&tab=discovery&qa18=stale2`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);

  // ---------- C. Add Contractor modal ----------
  say("== C. Add Contractor ==");
  await delay(1000);
  const openAdd = await clickAny(page, "Add Contractor Manually");
  say(`open add: ${JSON.stringify(openAdd)}`);
  await delay(400);
  await setInputValue(page, '[placeholder="e.g. Rosendin Electric, Inc."]', "AUDIT-QA18-STALE-Contractor");
  await setInputValue(page, '[placeholder="estimating@rosendin.com"]', "stale@qa18.invalid");
  const ctrFilled = await dialogValues(page);
  await clickIn(page, '[role="dialog"]', "Cancel");
  await delay(300);
  const addClosed = await page.evaluate(() => !document.querySelector('[role="dialog"]'));
  await clickAny(page, "Add Contractor Manually");
  await delay(400);
  const ctrReopen = await dialogValues(page);
  say(`ctr filled=${JSON.stringify(ctrFilled)} closed=${addClosed} reopen=${JSON.stringify(ctrReopen)}`);
  out.addContractor = { ctrFilled, addClosed, ctrReopen };
  await shot(page, "fix4-qa18-stale-addcontractor.png");
  await page.keyboard.press("Escape");
  await delay(300);

  // ---------- D. Ingest Quote modal ----------
  say("== D. Ingest Quote ==");
  await clickTab(page, "Bid Leveling");
  await delay(1500);
  const openIng = await clickAny(page, "Ingest Quote");
  say(`open ingest: ${JSON.stringify(openIng)}`);
  await delay(500);
  const selBefore = await page.evaluate(() => {
    const sel = document.querySelector('[aria-label="Subcontractor or bidder for this proposal"]');
    if (!sel) return null;
    if (sel.options.length > 1) {
      sel.value = sel.options[1].value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent.trim() : null;
  });
  await setInputValue(page, '[aria-label="Proposal OCR text or pasted quote"]', "AUDIT-QA18-STALE-QUOTE-TEXT");
  await setInputValue(page, '[aria-label="Document or proposal filename"]', "AUDIT-QA18-STALE-FILE.pdf");
  const ingFilled = await dialogValues(page);
  await page.evaluate(() => document.querySelector('[aria-label="Close quote ingestion dialog"]').click());
  await delay(300);
  await clickAny(page, "Ingest Quote");
  await delay(500);
  const ingReopen = await dialogValues(page);
  say(`ingest target=${selBefore}`);
  say(`ing filled=${JSON.stringify(ingFilled)}`);
  say(`ing reopen=${JSON.stringify(ingReopen)}`);
  out.ingest = { selBefore, ingFilled, ingReopen };
  await shot(page, "fix4-qa18-stale-ingest-reopen.png");
  await page.evaluate(() => document.querySelector('[aria-label="Close quote ingestion dialog"]').click());
  await delay(300);

  const pkgSwitch = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("AUDIT-QA18-VOL Package 02"));
    if (!b) return { ok: false };
    b.click();
    return { ok: true };
  });
  say(`pkg switch: ${JSON.stringify(pkgSwitch)}`);
  await delay(1500);
  await clickAny(page, "Ingest Quote");
  await delay(500);
  const ingAfterPkgSwitch = await dialogValues(page);
  say(`ing after pkg switch=${JSON.stringify(ingAfterPkgSwitch)}`);
  out.ingest.afterPackageSwitch = ingAfterPkgSwitch;
  await page.evaluate(() => document.querySelector('[aria-label="Close quote ingestion dialog"]').click());

  out.pageErrors = diag.pageErrors.slice(0, 5);
  writeEvidence("stale2", out);
  writeLog("stale2", log);
  await browser.close();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  writeLog("stale2-crash", [String(e && e.stack ? e.stack : e)]);
  process.exit(1);
});