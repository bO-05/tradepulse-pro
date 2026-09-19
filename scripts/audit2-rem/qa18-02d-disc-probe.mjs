import { launchBrowser, attachDiagnostics, waitForAppReady, delay, clickTab, shot } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog } from "./qa18-lib.mjs";

const fx = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
const diag = attachDiagnostics(page);
await page.goto(`${BASE}/?project=${fx.vol.id}&tab=packages&qa18=discprobe`, { waitUntil: "domcontentloaded", timeout: 90000 });
await waitForAppReady(page, 60000);

const nav = async (label) => {
  const r = await page.evaluate((l) => {
    const bs = [...document.querySelectorAll("button")];
    const match = bs.find((b) => (b.textContent || "").includes(l));
    if (!match) return { ok: false, available: bs.map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 40) };
    match.click();
    return { ok: true, text: (match.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60) };
  }, label);
  say(`click "${label}" -> ${JSON.stringify(r)}`);
  return r;
};

await nav("Bid Leveling");
await delay(2500);
await nav("Discovery");

const samples = [];
const t0 = Date.now();
for (let i = 0; i < 40; i++) {
  const s = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      ms: Date.now(),
      len: t.length,
      trade: t.includes("Select Trade:"),
      matrix: t.includes("Real-Time Forensic Bid Leveling Matrix"),
      discHeading: t.includes("Subcontractor Discovery"),
      discovering: t.includes("Discovering"),
      current: (() => {
        const b = document.querySelector('button[aria-current="page"]');
        return b ? (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40) : null;
      })(),
      hiddenRoots: (() => {
        const roots = [...document.querySelectorAll("main > div")].map((d) => ({
          cls: String(d.className).slice(0, 40),
          hidden: getComputedStyle(d).display === "none" || d.offsetParent === null,
          len: d.innerText ? d.innerText.length : 0,
        }));
        return roots.slice(0, 8);
      })(),
    };
  });
  samples.push({ elapsed: Date.now() - t0, ...s });
  if (s.trade && s.discHeading && !s.matrix) break;
  await delay(1000);
}
say(JSON.stringify(samples.slice(0, 6), null, 1));
say(`samples=${samples.length}; first trade at: ${(samples.find((s) => s.trade) || {}).elapsed ?? "never"}`);
await shot(page, "fix4-qa18-discprobe.png");
writeEvidence("disc-probe", { samples: samples.map(({ ms, ...r }) => ({ elapsed: r.elapsed, ...r })) });
writeLog("disc-probe", log);
await browser.close();
console.log("done");