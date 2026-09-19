import { launchBrowser, waitForAppReady, delay, clickTab } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog } from "./qa18-lib.mjs";

const fx = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const out = {};

const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
await page.goto(`${BASE}/?project=${fx.uni.id}&tab=discovery&qa18=unisearch`, { waitUntil: "domcontentloaded", timeout: 90000 });
await waitForAppReady(page, 60000);
await delay(1000);

async function test(pkgNeedle, query, expectNeedle) {
  await page.evaluate((n) => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes(n));
    if (b) b.click();
  }, pkgNeedle);
  await delay(1200);
  await page.evaluate((v) => {
    const input = [...document.querySelectorAll("input")].find((i) => /Search contractors/.test(i.getAttribute("placeholder") || ""));
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, query);
  await delay(700);
  const r = await page.evaluate(
    (needle) => {
      const t = document.body.innerText;
      let c = 0, i = 0;
      while ((i = t.indexOf(needle, i)) !== -1) { c++; i += needle.length; }
      return { matches: c, directoryLine: (t.match(/Trade Directory \([^)]*\)/) || [null])[0] };
    },
    expectNeedle
  );
  say(`[${pkgNeedle} | "${query}"] ${JSON.stringify(r)}`);
  out[`${pkgNeedle}_${query}`] = r;
  return r;
}

await test("مشروع الأعمال الكهربائية", "الكهرباء", "شركة الكهرباء");
await test("פרויקט מיזוג אוויר", "מיזוג", "מיזוג אוויר בע״מ");
await test("配管工事プラント", "配管", "東京配管株式会社");

writeEvidence("unicode-search", out);
writeLog("unicode-search", log);
await browser.close();
console.log("done");