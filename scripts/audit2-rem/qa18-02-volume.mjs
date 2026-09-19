import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog } from "./qa18-lib.mjs";

const fx = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const out = { vol: fx.vol.id, checks: {} };

async function countNeedle(page, needle) {
  return page.evaluate((n) => {
    const text = document.body.innerText;
    let count = 0, idx = 0;
    while ((idx = text.indexOf(n, idx)) !== -1) { count++; idx += n.length; }
    return count;
  }, needle);
}

async function waitCount(page, needle, n, timeout) {
  try {
    await page.waitForFunction(
      (nd, want) => {
        const text = document.body.innerText;
        let c = 0, i = 0;
        while ((i = text.indexOf(nd, i)) !== -1) { c++; i += nd.length; }
        return c >= want;
      },
      { timeout, polling: 250 },
      needle,
      n
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message).split("\n")[0] };
  }
}

async function main() {
  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.evaluateOnNewDocument(
    (pkg, proj) => {
      try {
        localStorage.setItem("tradepulse.selectedPackageId", pkg);
        localStorage.setItem("tradepulse.tourDismissed", "1");
        localStorage.removeItem("tradepulse.selectedProjectId");
      } catch {}
    },
    fx.vol.mainPackage,
    fx.vol.id
  );

  const t0 = Date.now();
  await page.goto(`${BASE}/?project=${fx.vol.id}&tab=packages&qa18=volume`, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await waitForAppReady(page, 60000);
  await page.evaluate((pkg) => {
    localStorage.setItem("tradepulse.selectedPackageId", pkg);
    localStorage.setItem("tradepulse.tourDismissed", "1");
  }, fx.vol.mainPackage);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  const bootMs = Date.now() - t0;
  const activeSel = await page.evaluate(() => {
    const t = document.body.innerText;
    const m = t.match(/AUDIT-QA18-VOL Package (\d+)/);
    return m ? m[0] : null;
  });
  say(`boot+packages ready in ${bootMs}ms; first package text on page: ${activeSel}`);

  const pkgWait = await waitCount(page, "AUDIT-QA18-VOL Package", 15, 30000);
  const pkgCount = await countNeedle(page, "AUDIT-QA18-VOL Package");
  say(`packages DOM count=${pkgCount} wait=${JSON.stringify(pkgWait)}`);
  out.checks.packages = { bootMs, domCount: pkgCount, wait: pkgWait };

  const badges = await page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .map((b) => (b.textContent || "").replace(/\s+/g, " ").trim())
      .filter((t) => / Pkgs| Subs| RFIs| Bids| Clashes| Awarded| Clear/.test(t))
  );
  say(`stepper badges: ${JSON.stringify(badges)}`);
  out.checks.badges = badges;

  const badgeFit = await page.evaluate(() => {
    const de = document.documentElement;
    const nav = [...document.querySelectorAll("button")].filter((b) => / Pkgs| Subs| RFIs| Bids| Clashes| Awarded| Clear/.test(b.textContent || ""));
    return {
      vw: de.clientWidth,
      docScrollW: de.scrollWidth,
      bodyScrollW: document.body.scrollWidth,
      buttons: nav.map((b) => ({ text: (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40), sw: b.scrollWidth, cw: b.clientWidth })),
    };
  });
  out.checks.badgeFit = badgeFit;

  const tabs = [
    { label: "Discovery", needle: "AUDIT-QA18 VOL Sub", n: 20 },
    { label: "Pre-Bid Q&A", needle: "AUDIT-QA18", n: 1 },
    { label: "Bid Leveling", needle: "AUDIT-QA18 VOL Sub", n: 20 },
    { label: "Scope Clash", needle: null, n: 0 },
    { label: "Subcontracts", needle: null, n: 0 },
    { label: "Live Activity Audit", needle: null, n: 0 },
    { label: "Evals & Architecture", needle: null, n: 0 },
  ];

  for (const tab of tabs) {
    const clickRes = await clickTab(page, tab.label);
    const t1 = Date.now();
    let waitRes = { ok: true, skipped: true };
    if (tab.needle) waitRes = await waitCount(page, tab.needle, tab.n, 20000);
    else await delay(1500);
    const ms = Date.now() - t1;
    const count = tab.needle ? await countNeedle(page, tab.needle) : null;
    const junk = await page.evaluate(() => {
      const t = document.body.innerText;
      return { undefined: (t.match(/undefined/g) || []).length, nan: (t.match(/\bNaN\b/g) || []).length, inf: (t.match(/Infinity/g) || []).length };
    });
    const errs = await page.evaluate(() => window.__qa18Errors ? window.__qa18Errors.length : 0);
    say(`[${tab.label}] click=${JSON.stringify(clickRes.ok)} render=${ms}ms domCount=${count} wait=${waitRes.ok} junk=${JSON.stringify(junk)}`);
    out.checks[`tab_${tab.label.replace(/\W+/g, "")}`] = { click: clickRes, renderMs: ms, domCount: count, wait: waitRes, junk };
    await shot(page, `fix4-qa18-volume-${tab.label.replace(/\W+/g, "")}.png`, { full: false });
  }

  // Back to leveling for CSV check
  await clickTab(page, "Bid Leveling");
  await waitCount(page, "AUDIT-QA18 VOL Sub", 20, 20000);

  await page.evaluate(() => {
    window.__qa18Csv = null;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      try {
        if (blob instanceof Blob && String(blob.type).includes("csv")) blob.text().then((t) => { window.__qa18Csv = t; });
      } catch {}
      return orig(blob);
    };
  });
  const csvClick = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Export Leveling CSV"));
    if (!b) return { ok: false };
    b.click();
    return { ok: true, disabled: b.disabled };
  });
  await page.waitForFunction(() => window.__qa18Csv != null, { timeout: 15000 }).catch(() => {});
  const csv = await page.evaluate(() => window.__qa18Csv);
  const csvInfo = { click: csvClick, present: !!csv, len: csv ? csv.length : 0 };
  if (csv) {
    const rows = csv.trim().split(/\r?\n/);
    csvInfo.rowCount = rows.length - 1;
    csvInfo.header = rows[0].slice(0, 200);
    csvInfo.firstDataRow = rows[1] ? rows[1].slice(0, 300) : null;
    csvInfo.lastDataRow = rows[rows.length - 1].slice(0, 300);
    csvInfo.awardedMarkers = (csv.match(/AWARDED/g) || []).length;
  }
  say(`CSV: ${JSON.stringify(csvInfo)}`);
  out.checks.csv = csvInfo;

  const perf = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    return {
      domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      loadEvent: nav ? Math.round(nav.loadEventEnd) : null,
      resourceCount: performance.getEntriesByType("resource").length,
    };
  });
  out.checks.perf = perf;

  out.consoleErrors = diag.consoleLogs.filter((c) => c.type === "error").slice(0, 10);
  out.pageErrors = diag.pageErrors.slice(0, 10);
  out.failedRequests = diag.failedRequests.slice(0, 10);
  say(`pageErrors=${out.pageErrors.length} consoleErrors=${out.consoleErrors.length} failedRequests=${out.failedRequests.length}`);

  writeEvidence("volume", out);
  writeLog("volume", log);
  await browser.close();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  writeLog("volume-crash", [String(e && e.stack ? e.stack : e)]);
  process.exit(1);
});
