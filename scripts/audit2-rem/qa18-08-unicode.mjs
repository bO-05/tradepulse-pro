import { launchBrowser, attachDiagnostics, waitForAppReady, delay, clickTab, shot } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog } from "./qa18-lib.mjs";

const fx = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const out = {};

const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
const diag = attachDiagnostics(page);
await page.goto(`${BASE}/?project=${fx.uni.id}&tab=packages&qa18=uni`, { waitUntil: "domcontentloaded", timeout: 90000 });
await waitForAppReady(page, 60000);
await delay(1000);

async function report(label) {
  const s = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      undefined: (t.match(/undefined/g) || []).length,
      nan: (t.match(/\bNaN\b/g) || []).length,
      hasArabic: t.includes("مشروع الأعمال"),
      hasHebrew: t.includes("פרויקט מיזוג"),
      hasCjk: t.includes("配管工事"),
      hasEmoji: t.includes("🚧 Fire Protection"),
      longWordShown: t.includes("W".repeat(30)),
      mojibake: /Ã.|â€|ï¿½/.test(t),
      docScrollW: document.documentElement.scrollWidth,
      vw: document.documentElement.clientWidth,
    };
  });
  say(`[${label}] ${JSON.stringify(s)}`);
  out[label] = s;
  return s;
}

await report("UNI-packages");
await shot(page, "fix4-qa18-uni-packages.png");

// compute bidi direction of visible text containers
const dirInfo = await page.evaluate(() => {
  const labels = [...document.querySelectorAll("h3")].filter((h) => /مشروع|פרויקט|配管|🚧|WWWW/.test(h.textContent || ""));
  return labels.map((h) => ({
    text: (h.textContent || "").slice(0, 30),
    direction: getComputedStyle(h).direction,
    unicodeBidi: getComputedStyle(h).unicodeBidi,
    textAlign: getComputedStyle(h).textAlign,
  }));
});
say(`dirInfo: ${JSON.stringify(dirInfo)}`);
out.dirInfo = dirInfo;

// Discovery + search with Arabic query on Arabic package
await clickTab(page, "Discovery");
await delay(1500);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("مشروع الأعمال"));
  if (b) b.click();
});
await delay(1500);
const searchSel = await page.evaluate(() => {
  const input = [...document.querySelectorAll("input")].find((i) => /search|filter/i.test(i.getAttribute("placeholder") || "") || (i.getAttribute("type") || "") === "search");
  return input ? { placeholder: input.getAttribute("placeholder"), aria: input.getAttribute("aria-label") } : null;
});
say(`search input: ${JSON.stringify(searchSel)}`);
if (searchSel) {
  const setSearch = async (val) => {
    await page.evaluate((v) => {
      const input = [...document.querySelectorAll("input")].find((i) => /search|filter/i.test(i.getAttribute("placeholder") || "") || (i.getAttribute("type") || "") === "search");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, val);
    await delay(600);
    return page.evaluate(() => {
      const t = document.body.innerText;
      return { arabic: (t.match(/شركة الكهرباء/g) || []).length, hebrew: (t.match(/חברת מיזוג/g) || []).length, cjk: (t.match(/東京配管/g) || []).length };
    });
  };
  out.searchArabic = await setSearch("مشروع");
  say(`search arabic: ${JSON.stringify(out.searchArabic)}`);
  out.searchHebrew = await setSearch("חברת");
  say(`search hebrew: ${JSON.stringify(out.searchHebrew)}`);
  out.searchLatin = await setSearch("qa18.uni");
  say(`search latin: ${JSON.stringify(out.searchLatin)}`);
}
await shot(page, "fix4-qa18-uni-discovery.png");

// Leveling + CSV with unicode names
await clickTab(page, "Bid Leveling");
await delay(1500);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("مشروع الأعمال"));
  if (b) b.click();
});
await delay(1500);
await report("UNI-leveling");
await page.evaluate(() => {
  window.__qa18Csv = null;
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    try { if (blob instanceof Blob && String(blob.type).includes("csv")) blob.text().then((t) => { window.__qa18Csv = t; }); } catch {}
    return orig(blob);
  };
});
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Export Leveling CSV"));
  if (b) b.click();
});
await page.waitForFunction(() => window.__qa18Csv != null, { timeout: 10000 }).catch(() => {});
const csv = await page.evaluate(() => window.__qa18Csv);
if (csv) {
  out.csv = {
    hasBom: csv.charCodeAt(0) === 0xfeff,
    hasArabic: csv.includes("شركة الكهرباء"),
    hasHebrew: csv.includes("פרויקט") || csv.includes("חברת"),
    rows: csv.trim().split(/\r?\n/).length - 1,
    head: csv.slice(0, 160),
  };
  say(`csv: ${JSON.stringify(out.csv)}`);
} else {
  say("csv capture failed");
}
await shot(page, "fix4-qa18-uni-leveling.png");

// long word truncation in ribbon / cards
const trunc = await page.evaluate(() => {
  const els = [...document.querySelectorAll("span, h3")].filter((e) => (e.textContent || "").includes("WWWWWWWWWW"));
  return els.slice(0, 6).map((e) => ({
    tag: e.tagName,
    cls: String(e.className).slice(0, 80),
    sw: e.scrollWidth,
    cw: e.clientWidth,
    overflowHidden: getComputedStyle(e).overflow === "hidden",
    title: e.getAttribute("title"),
    textLen: (e.textContent || "").length,
  }));
});
say(`long word: ${JSON.stringify(trunc)}`);
out.longWord = trunc;

out.pageErrors = diag.pageErrors.slice(0, 5);
writeEvidence("unicode", out);
writeLog("unicode", log);
await browser.close();
console.log("done");