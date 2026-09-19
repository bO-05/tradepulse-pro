import { launchBrowser, attachDiagnostics, waitForAppReady, delay, clickTab, setInputValue, shot } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog, client } from "./qa18-lib.mjs";

const fx = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const out = {};

async function clickIn(page, scopeSel, text) {
  return page.evaluate((scope, t) => {
    const root = scope ? document.querySelector(scope) : document;
    const b = [...root.querySelectorAll("button")].find((x) => (x.textContent || "").trim().includes(t));
    if (!b) return { ok: false, avail: [...root.querySelectorAll("button")].map((x) => (x.textContent || "").trim()).slice(0, 30) };
    b.click();
    return { ok: true, text: (b.textContent || "").trim().slice(0, 60) };
  }, scopeSel, text);
}

async function clickAny(page, text, scope = null) {
  return page.evaluate((t, sc) => {
    const root = sc ? document.querySelector(sc) : document;
    const b = [...root.querySelectorAll("button")].find((x) => (x.textContent || "").includes(t));
    if (!b) return { ok: false };
    b.click();
    return { ok: true, text: (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60) };
  }, text, scope);
}

async function fieldValue(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return el.value;
  }, selector);
}

async function dialogValues(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return { dialog: false };
    const out = { dialog: true };
    dialog.querySelectorAll("input, textarea, select").forEach((el, i) => {
      const key = el.getAttribute("aria-label") || `${el.tagName.toLowerCase()}#${i}`;
      if (el.tagName === "SELECT") {
        out[key] = el.options[el.selectedIndex] ? el.options[el.selectedIndex].textContent.trim() : el.value;
      } else {
        out[key] = el.value;
      }
    });
    return out;
  });
}

async function main() {
  const c = client();
  const before = (await c.query("projects:listProjects", {})).length;

  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.goto(`${BASE}/?project=${fx.vol.id}&tab=packages&qa18=stale`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);

  // ---------- A. New Project modal ----------
  say("== A. New Project modal ==");
  await clickAny(page, "New Project");
  await delay(400);
  await setInputValue(page, '[aria-label="Project title"]', "AUDIT-QA18-STALE-ProjectTitle");
  await setInputValue(page, '[aria-label="Project location"]', "AUDIT-QA18-STALE-Location");
  await setInputValue(page, '[aria-label="Project type"]', "AUDIT-QA18-STALE-Type");
  await setInputValue(page, '[aria-label="General contractor or contracting entity"]', "AUDIT-QA18-STALE-GC");
  await setInputValue(page, '[aria-label="Estimated budget in dollars"]', "1234567");
  await setInputValue(page, '[aria-label="Target completion duration in weeks"]', "77");
  await page.evaluate(() => {
    const ta = document.querySelector('[role="dialog"] textarea');
    if (ta) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(ta, "AUDIT-QA18-STALE-Spec");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  const filled = await dialogValues(page);
  say(`filled: ${JSON.stringify(filled)}`);
  await clickIn(page, '[role="dialog"]', "Cancel");
  await delay(400);
  const closedAfterCancel = await page.evaluate(() => !document.querySelector('[role="dialog"]'));
  await clickAny(page, "New Project");
  await delay(400);
  const afterCancelReopen = await dialogValues(page);
  say(`after cancel+reopen: ${JSON.stringify(afterCancelReopen)}`);
  await shot(page, "fix4-qa18-stale-newproject.png");
  await page.keyboard.press("Escape");
  await delay(400);
  const closedAfterEsc = await page.evaluate(() => !document.querySelector('[role="dialog"]'));
  await clickAny(page, "New Project");
  await delay(400);
  const afterEscReopen = await dialogValues(page);
  say(`after escape+reopen: ${JSON.stringify(afterEscReopen)}`);
  await clickIn(page, '[role="dialog"]', "Cancel");
  await delay(300);
  out.newProject = { filled, closedAfterCancel, closedAfterEsc, afterCancelReopen, afterEscReopen };

  // Switch project while Header stays mounted -> stale values cross projects?
  const selRes = await page.evaluate((projId) => {
    const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
    if (!sel) return { ok: false };
    sel.value = projId;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }, fx.uni.id);
  say(`switch to UNI: ${JSON.stringify(selRes)}`);
  await delay(2500);
  await clickAny(page, "New Project");
  await delay(400);
  const afterProjectSwitch = await dialogValues(page);
  say(`after project switch+reopen: ${JSON.stringify(afterProjectSwitch)}`);
  await clickIn(page, '[role="dialog"]', "Cancel");
  await delay(300);
  out.newProject.afterProjectSwitch = afterProjectSwitch;

  // back to VOL
  await page.evaluate((projId) => {
    const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
    sel.value = projId;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, fx.vol.id);
  await delay(2500);

  // ---------- B. Create Trade Package modal ----------
  say("== B. Create Trade Package ==");
  await clickTab(page, "CSI Scoping");
  await delay(1200);
  await clickAny(page, "Create Trade Package");
  await delay(400);
  await setInputValue(page, '[aria-label="Trade package name"]', "AUDIT-QA18-STALE-PackageName");
  await setInputValue(page, '[aria-label="CSI division number"]', "99 99 99");
  const pkgFilled = await dialogValues(page);
  await clickIn(page, '[role="dialog"]', "Cancel");
  await delay(300);
  await clickAny(page, "Create Trade Package");
  await delay(400);
  const pkgReopen = await dialogValues(page);
  say(`pkg filled=${JSON.stringify(pkgFilled)} reopen=${JSON.stringify(pkgReopen)}`);
  out.createPackage = { pkgFilled, pkgReopen };
  await clickIn(page, '[role="dialog"]', "Cancel");
  await delay(300);

  // ---------- C. Add Contractor modal ----------
  say("== C. Add Contractor ==");
  await clickTab(page, "Discovery");
  await delay(1500);
  await clickAny(page, "Add Contractor Manually");
  await delay(400);
  await setInputValue(page, '[aria-label="Company name"]', "AUDIT-QA18-STALE-Contractor");
  await setInputValue(page, '[aria-label="Contact email"]', "stale@qa18.invalid");
  await clickIn(page, '[role="dialog"]', "Cancel");
  await delay(300);
  await clickAny(page, "Add Contractor Manually");
  await delay(400);
  const ctrReopen = await dialogValues(page);
  say(`contractor reopen=${JSON.stringify(ctrReopen)}`);
  out.addContractor = { ctrReopen };
  await page.keyboard.press("Escape");
  await delay(300);

  // ---------- D. Ingest Quote modal ----------
  say("== D. Ingest Quote ==");
  await clickTab(page, "Bid Leveling");
  await delay(1500);
  await clickAny(page, "Ingest Quote");
  await delay(500);
  await page.evaluate(() => {
    const sel = document.querySelector('[aria-label="Subcontractor or bidder for this proposal"]');
    if (sel && sel.options.length > 1) {
      sel.value = sel.options[1].value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await setInputValue(page, '[aria-label="Proposal OCR text or pasted quote"]', "AUDIT-QA18-STALE-QUOTE-TEXT");
  await setInputValue(page, '[aria-label="Document or proposal filename"]', "AUDIT-QA18-STALE-FILE.pdf");
  const ingFilled = await dialogValues(page);
  await page.evaluate(() => document.querySelector('[aria-label="Close quote ingestion dialog"]').click());
  await delay(300);
  await clickAny(page, "Ingest Quote");
  await delay(500);
  const ingReopen = await dialogValues(page);
  say(`ingest filled=${JSON.stringify(ingFilled)} reopen=${JSON.stringify(ingReopen)}`);
  out.ingest = { ingFilled, ingReopen };
  await page.evaluate(() => document.querySelector('[aria-label="Close quote ingestion dialog"]').click());
  await delay(300);

  // switch package then reopen -> should be clean because of key remount
  const pkgSwitch = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("AUDIT-QA18-VOL Package 02"));
    if (!b) return { ok: false };
    b.click();
    return { ok: true };
  });
  await delay(1500);
  await clickAny(page, "Ingest Quote");
  await delay(500);
  const ingAfterPkgSwitch = await dialogValues(page);
  say(`ingest after package switch=${JSON.stringify(ingAfterPkgSwitch)}`);
  out.ingest.afterPackageSwitch = ingAfterPkgSwitch;
  await page.evaluate(() => document.querySelector('[aria-label="Close quote ingestion dialog"]').click());

  const after = (await c.query("projects:listProjects", {})).length;
  out.projectCount = { before, after };
  out.pageErrors = diag.pageErrors.slice(0, 5);
  say(`projects before=${before} after=${after}; pageErrors=${out.pageErrors.length}`);

  writeEvidence("stale", out);
  writeLog("stale", log);
  await browser.close();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  writeLog("stale-crash", [String(e && e.stack ? e.stack : e)]);
  process.exit(1);
});