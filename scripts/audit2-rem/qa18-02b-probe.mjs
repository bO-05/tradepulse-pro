import { launchBrowser, attachDiagnostics, waitForAppReady, delay, clickTab } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog } from "./qa18-lib.mjs";

const fx = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
const diag = attachDiagnostics(page);
await page.goto(`${BASE}/?project=${fx.vol.id}&tab=packages&qa18=probe`, { waitUntil: "domcontentloaded", timeout: 90000 });
await waitForAppReady(page, 60000);

const state = async (tag) => {
  const s = await page.evaluate(() => {
    const ls = localStorage.getItem("tradepulse.selectedPackageId");
    const pkgButtons = [...document.querySelectorAll("button")].filter((b) => (b.textContent || "").includes("AUDIT-QA18-VOL Package")).map((b) => ({
      text: (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
      cls: String(b.className).slice(0, 120),
    }));
    const selected = [...document.querySelectorAll("select")].map((sel) => ({
      aria: sel.getAttribute("aria-label"),
      value: sel.value,
      text: sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent.trim().slice(0, 80) : null,
    }));
    const badge = [...document.querySelectorAll("button")].map((b) => (b.textContent || "").replace(/\s+/g, " ").trim()).filter((t) => / Pkgs| Subs| RFIs| Bids| Clashes| Awarded| Clear/.test(t));
    return { ls, badge, selected, pkgButtonCount: pkgButtons.length };
  });
  say(`[${tag}] ${JSON.stringify(s)}`);
  return s;
};

await state("initial-load");

await page.evaluate((pkg) => localStorage.setItem("tradepulse.selectedPackageId", pkg), fx.vol.mainPackage);
await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
await waitForAppReady(page, 60000);
await state("after-reload-with-main-stored");

await delay(3000);
await state("after-reload-3s");

const clickMain = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("AUDIT-QA18-VOL Package 10"));
  if (!b) return { ok: false };
  b.click();
  return { ok: true, text: (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60) };
});
say(`click package 10: ${JSON.stringify(clickMain)}`);
await delay(3000);
await state("after-package-click");

await clickTab(page, "Bid Leveling");
await delay(4000);
const lvl = await page.evaluate(() => ({
  ls: localStorage.getItem("tradepulse.selectedPackageId"),
  subs: (document.body.innerText.match(/AUDIT-QA18 VOL Sub/g) || []).length,
  csvDisabled: (() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Export Leveling CSV")); return b ? b.disabled : null; })(),
}));
say(`leveling: ${JSON.stringify(lvl)}`);

writeEvidence("probe-selection", { state: lvl });
writeLog("probe-selection", log);
await browser.close();
console.log("done");