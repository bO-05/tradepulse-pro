import { launchBrowser, attachDiagnostics, waitForAppReady, delay } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog } from "./qa20-lib.mjs";

const F = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
await page.emulateTimezone("America/Los_Angeles");
await page.goto(`${BASE}/?project=${F.journey.id}&tab=contracts&qa20=probe`, { waitUntil: "domcontentloaded", timeout: 90000 });
await waitForAppReady(page, 60000);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
  b?.click();
});
await delay(1200);
const mainText = await page.evaluate(() => (document.querySelector("main") || document.body).innerText);
say(`main text (first 1400):\n${mainText.slice(0, 1400)}`);
const details = await page.evaluate(() => {
  const t = (document.querySelector("main") || document.body).innerText;
  return {
    activeSumMatch: t.match(/Active Contracted Sum[^\n]*\n[^\n]*/),
    execMatch: t.match(/Execution Status Recorded[^\n]*\n[^\n]*/),
    rawLines: t.split("\n").slice(0, 26),
  };
});
say(`details: ${JSON.stringify(details, null, 2)}`);
const click = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /Inspect Draft/i.test(x.innerText || ""));
  if (!b) return false;
  b.click();
  return true;
});
await delay(1500);
const modals = await page.evaluate(() => {
  const ds = [...document.querySelectorAll('[role="dialog"]')].map((d) => ({
    visible: d.getBoundingClientRect().width > 1,
    head: (d.innerText || "").replace(/\s+/g, " ").slice(0, 160),
    buttons: [...d.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()),
    executedBanner: /Execution recorded in TradePulse/i.test(d.innerText || ""),
    hasPre: !!d.querySelector("pre"),
  }));
  return ds;
});
say(`dialogs after Inspect Draft: ${JSON.stringify(modals, null, 2)}`);
writeEvidence("probe-ui", { mainText: mainText.slice(0, 4000), details, modals });
writeLog("probe-ui", log);
await browser.close();
console.log("probe done");