/**
 * QA20-07 read-only: contrast ratios on register/viewer buttons and expanded
 * KPI card reconciliation (no mutations).
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog } from "./qa20-lib.mjs";

const F = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const J = F.journey;
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const out = {};

function channel(v) { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function contrast(a, b) {
  const L1 = 0.2126 * channel(a[0]) + 0.7152 * channel(a[1]) + 0.0722 * channel(a[2]);
  const L2 = 0.2126 * channel(b[0]) + 0.7152 * channel(b[1]) + 0.0722 * channel(b[2]);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
}
function parseRgb(s) { const m = String(s).match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; }

async function main() {
  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.goto(`${BASE}/?project=${J.id}&tab=contracts&qa20=contrast`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
    b?.click();
  });
  await delay(1400);

  const measure = async () => page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1;
    const names = ["Inspect Draft", "Record Execution Status", "Record External Execution", "Void execution record", "Export Leveling CSV"];
    const out = [];
    for (const n of names) {
      const b = [...document.querySelectorAll("button")].find((x) => vis(x) && (x.innerText || "").replace(/\s+/g, " ").trim() === n);
      if (!b) continue;
      const cs = getComputedStyle(b);
      out.push({ name: n, bg: cs.backgroundColor, color: cs.color, fontSize: cs.fontSize, fontWeight: cs.fontWeight });
    }
    return out;
  });
  const raw1 = await measure();
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Inspect Draft/.test(x.innerText || ""));
    b?.click();
  });
  await delay(1400);
  const raw2 = await measure();
  const raw = [...raw1, ...raw2.filter((r) => !raw1.some((x) => x.name === r.name))];
  const rows = raw.map((r) => ({ ...r, ratio: (() => { const bg = parseRgb(r.bg); const fg = parseRgb(r.color); return bg && fg ? contrast(bg, fg) : null; })() }));
  out.contrast = rows;
  say(`contrast rows: ${JSON.stringify(rows)}`);
  await shot(page, "fix4-qa20-contrast-contracts.png");
  await page.keyboard.press("Escape");
  await delay(400);

  // Expanded KPI reconciliation (read-only)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("header button")].find((x) => /Bid Leveling/.test(x.innerText || "") || (x.getAttribute("title") || "").includes("Bid Leveling"));
    b?.click();
  });
  await delay(1800);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Expand 6-Card KPI View/.test(x.innerText || ""));
    b?.click();
  });
  await delay(1000);
  const expanded = await page.evaluate(() => {
    const t = (document.querySelector("main") || document.body).innerText;
    const grab = (label, lines = 3) => {
      const i = t.indexOf(label);
      return i >= 0 ? t.slice(i, i + 160).split("\n").slice(0, lines).join(" | ") : null;
    };
    return {
      budget: grab("TOTAL BUDGET"),
      leveled: grab("LEVELED BUYOUT"),
      awards: grab("SUBCONTRACT AWARDS"),
      gaps: grab("HIDDEN GAPS EXPOSED"),
      deceptive: grab("DECEPTIVE BIDS FLAGGED"),
      full: t.slice(0, 1400),
    };
  });
  out.expanded = expanded;
  await shot(page, "fix4-qa20-kpi-expanded.png");
  const headerBadge = await page.evaluate(() => [...document.querySelectorAll("header button")].map((b) => (b.innerText || "").replace(/\s+/g, " ")).find((x) => /Awarded/.test(x)));
  out.headerBadge = headerBadge;
  say(`expanded awards="${expanded.awards}" header="${headerBadge}"`);
  out.pageErrors = diag.pageErrors.slice(0, 5);
  writeEvidence("contrast-kpi", out);
  writeLog("contrast-kpi", log);
  await browser.close();
  console.log("contrast+kpi done");
}

main().catch((e) => {
  console.error(e);
  writeLog("contrast-kpi-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});