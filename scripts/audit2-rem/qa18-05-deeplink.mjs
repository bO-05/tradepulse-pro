import { launchBrowser, attachDiagnostics, waitForAppReady, delay, clickTab, shot } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog } from "./qa18-lib.mjs";

const fx = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const out = {};

async function snap(page) {
  return page.evaluate(() => {
    const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
    const cur = document.querySelector('button[aria-current="page"]');
    return {
      url: location.href,
      selector: sel && sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent.trim().slice(0, 50) : null,
      activeStage: cur ? (cur.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40) : null,
      hasMatrix: document.body.innerText.includes("Real-Time Forensic Bid Leveling Matrix"),
      hasKpi: document.body.innerText.includes("Leveled Buyout"),
    };
  });
}

async function main() {
  // ---------- A. Package selection persistence across reload ----------
  const { browser } = await launchBrowser(1440, 950);
  const pageA = await browser.newPage();
  const diagA = attachDiagnostics(pageA);
  await pageA.goto(`${BASE}/?project=${fx.vol.id}&tab=discovery&qa18=selpersist`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(pageA, 60000);
  await delay(800);
  const before = await pageA.evaluate(() => ({
    ls: localStorage.getItem("tradepulse.selectedPackageId"),
    badge: [...document.querySelectorAll("button")].map((b) => (b.textContent || "").replace(/\s+/g, " ").trim()).filter((t) => / Subs| Bids/.test(t)),
  }));
  const clickPkg = await pageA.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("AUDIT-QA18-VOL Package 10"));
    if (!b) return { ok: false };
    b.click();
    return { ok: true };
  });
  await delay(1500);
  const afterClick = await pageA.evaluate(() => ({
    ls: localStorage.getItem("tradepulse.selectedPackageId"),
    badge: [...document.querySelectorAll("button")].map((b) => (b.textContent || "").replace(/\s+/g, " ").trim()).filter((t) => / Subs| Bids/.test(t)),
  }));
  say(`A click=${JSON.stringify(clickPkg)} before=${JSON.stringify(before)} afterClick=${JSON.stringify(afterClick)}`);
  await shot(pageA, "fix4-qa18-selection-before-reload.png");

  await pageA.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(pageA, 60000);
  await delay(2500);
  const afterReload = await pageA.evaluate(() => ({
    ls: localStorage.getItem("tradepulse.selectedPackageId"),
    badge: [...document.querySelectorAll("button")].map((b) => (b.textContent || "").replace(/\s+/g, " ").trim()).filter((t) => / Subs| Bids/.test(t)),
    selectedRibbon: [...document.querySelectorAll("button[aria-pressed]")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 50)),
  }));
  say(`A afterReload=${JSON.stringify(afterReload)}`);
  out.selectionPersistence = { before, afterClick, afterReload };
  await shot(pageA, "fix4-qa18-selection-after-reload.png");
  out.pageErrorsA = diagA.pageErrors.slice(0, 3);
  await pageA.close();

  // ---------- B. Deep-link fuzz ----------
  const cases = [
    { name: "valid+extra", url: `${BASE}/?project=${fx.vol.id}&tab=leveling&x=1`, expectTab: "Bid Leveling" },
    { name: "bogus-project", url: `${BASE}/?project=bogus-qa18&tab=leveling`, expectTab: "Bid Leveling" },
    { name: "double-project", url: `${BASE}/?project=${fx.vol.id}&project=${fx.uni.id}&tab=packages`, expectTab: "CSI Scoping" },
    { name: "uppercase-tab", url: `${BASE}/?project=${fx.vol.id}&tab=LEVELING`, expectTab: "CSI Scoping" },
    { name: "html-in-tab", url: `${BASE}/?project=${fx.vol.id}&tab=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E`, expectTab: "CSI Scoping" },
    { name: "script-in-project", url: `${BASE}/?project=%3Cscript%3Ealert(1)%3C%2Fscript%3E&tab=leveling`, expectTab: "Bid Leveling" },
    { name: "trailing-space-project", url: `${BASE}/?project=${fx.vol.id}%20&tab=leveling`, expectTab: "Bid Leveling" },
    { name: "no-project", url: `${BASE}/?tab=leveling`, expectTab: "Bid Leveling" },
    { name: "double-tab", url: `${BASE}/?project=${fx.vol.id}&tab=leveling&tab=discovery`, expectTab: "Bid Leveling" },
    { name: "long-tab", url: `${BASE}/?project=${fx.vol.id}&tab=${"A".repeat(5000)}`, expectTab: "CSI Scoping" },
    { name: "fragment", url: `${BASE}/?project=${fx.vol.id}&tab=leveling#frag`, expectTab: "Bid Leveling" },
    { name: "double-x", url: `${BASE}/?project=${fx.vol.id}&x=1&x=2&tab=leveling`, expectTab: "Bid Leveling" },
  ];

  for (const tc of cases) {
    const page = await browser.newPage();
    const diag = attachDiagnostics(page);
    const dialogs = [];
    page.on("dialog", async (d) => { dialogs.push(d.message()); await d.dismiss(); });
    let navError = null;
    try {
      await page.goto(tc.url, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForFunction(
        () => document.querySelector('select[aria-label="Select Commercial Construction Project"]') !== null,
        { timeout: 30000 }
      );
      await delay(1800);
    } catch (e) {
      navError = String(e.message).split("\n")[0];
    }
    const s = navError ? { navError } : await snap(page);
    const entry = { ...s, expectTab: tc.expectTab, dialogs, pageErrors: diag.pageErrors.slice(0, 2) };
    say(`[fuzz ${tc.name}] ${JSON.stringify(entry)}`);
    out[`fuzz_${tc.name}`] = entry;
    await page.close();
  }

  // ---------- C. Back/Forward after tab mutations ----------
  const pageC = await browser.newPage();
  await pageC.goto(`${BASE}/?project=${fx.vol.id}&tab=packages&qa18=history`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(pageC, 60000);
  await clickTab(pageC, "Bid Leveling");
  await delay(1200);
  const h1 = await snap(pageC);
  await clickTab(pageC, "Scope Clash");
  await delay(1200);
  const h2 = await snap(pageC);
  await pageC.goBack();
  await delay(1500);
  const h3 = await snap(pageC);
  await pageC.goBack();
  await delay(1500);
  const h4 = await snap(pageC);
  await pageC.goForward();
  await delay(1500);
  const h5 = await snap(pageC);
  say(`C history: ${JSON.stringify({ h1, h2, h3, h4, h5 })}`);
  out.history = { h1, h2, h3, h4, h5 };
  await shot(pageC, "fix4-qa18-history.png");
  await pageC.close();

  out.pageErrors = out.pageErrors || [];
  writeEvidence("deeplink", out);
  writeLog("deeplink", log);
  await browser.close();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  writeLog("deeplink-crash", [String(e && e.stack ? e.stack : e)]);
  process.exit(1);
});