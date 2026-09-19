import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickButtonByText } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog } from "./qa16-lib.mjs";

const fx = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const out = {};

async function probe(projectId, label, tab) {
  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.setViewport({ width: 320, height: 700, deviceScaleFactor: 1 });
  await page.goto(`https://brainy-skunk-440.convex.site/?project=${projectId}&tab=packages&qa16=${label}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
    b?.click();
  });
  await delay(700);
  await clickButtonByText(page, tab);
  await delay(800);

  const info = await page.evaluate(() => {
    const de = document.documentElement;
    const vw = de.clientWidth;
    const wide = [...document.querySelectorAll("button")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > vw && getComputedStyle(el).display !== "none";
    }).slice(0, 3).map((el) => {
      const chain = [];
      let n = el;
      for (let i = 0; i < 6 && n; i++) {
        const s = getComputedStyle(n);
        chain.push({ tag: n.tagName, cls: String(n.className).slice(0, 70), ow: s.overflowX, sw: n.scrollWidth, cw: n.clientWidth, rect: Math.round(n.getBoundingClientRect().width) });
        n = n.parentElement;
      }
      return { text: (el.textContent || "").slice(0, 60), w: Math.round(el.getBoundingClientRect().width), chain };
    });
    return { vw, scrollW: de.scrollWidth, wide };
  });
  say(`[${label}/${tab}] vw=${info.vw} scrollW=${info.scrollW}`);
  out[`${label}_${tab}`] = info;
  await shot(page, `fix4-qa16-overflow-${label}-${tab.replace(/\W+/g, "")}.png`, { full: false });
  out[`${label}_${tab}_errors`] = diag.pageErrors.slice(0, 3);
  await browser.close();
}

await probe(fx.projectEdge.id, "EDGE", "Discovery");
await probe(fx.projectEdge.id, "EDGE", "Pre-Bid Q&A");
await probe(fx.projectA.id, "A", "Discovery");
writeEvidence("overflow-probe", out);
writeLog("overflow-probe", log);
console.log("done");