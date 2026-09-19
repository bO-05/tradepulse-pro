import { launchBrowser, waitForAppReady, delay } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog } from "./qa18-lib.mjs";

const fx = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
page.on("pageerror", (e) => say("PAGEERROR " + e.message));
await page.goto(`${BASE}/?project=${fx.vol.id}&tab=packages&qa18=stuck`, { waitUntil: "domcontentloaded", timeout: 90000 });
await waitForAppReady(page, 60000);

await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Bid Leveling"));
  b.click();
});
await delay(2500);
const lvl = await page.evaluate(() => ({ cur: document.querySelector('button[aria-current="page"]')?.innerText, mainLen: document.querySelector("main")?.innerText.length }));
say(`after leveling: ${JSON.stringify(lvl)}`);

await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Discovery"));
  b.click();
});
await delay(4000);
const disc = await page.evaluate(() => ({
  cur: document.querySelector('button[aria-current="page"]')?.innerText,
  mainText: document.querySelector("main")?.innerText.slice(0, 2000),
  mainLen: document.querySelector("main")?.innerText.length,
  levelingMatrixPresent: document.body.innerText.includes("Real-Time Forensic Bid Leveling Matrix"),
  tradePresent: document.body.innerText.includes("Select Trade:"),
}));
say("=== AFTER DISCOVERY ===");
say(`cur=${JSON.stringify(disc.cur)} mainLen=${disc.mainLen} matrix=${disc.levelingMatrixPresent} trade=${disc.tradePresent}`);
say(disc.mainText);
writeEvidence("disc-stuck", disc);
writeLog("disc-stuck", log);
await browser.close();
console.log("done");