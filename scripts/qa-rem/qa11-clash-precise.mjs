// QA-11 focused 2b precision probe: Scope Clash DOM/text state on EMPTY 0-package fixture vs demo.
// Case-insensitive badge counts + full innerText dumps + precise $/count extraction from summary stat cards.
// Usage: node scripts/qa-rem/qa11-clash-precise.mjs
import fs from "node:fs";
import path from "node:path";
import {
  EVIDENCE_DIR,
  BASE_URL,
  launchBrowser,
  waitForAppReady,
  selectProjectByTitle,
  shot,
  writeLog,
  delay,
} from "./qa1-lib.mjs";

const fixtures = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa11-fixtures.json"), "utf8"));
const LOG = [];
const ev = (s) => { LOG.push(s); console.log(s); };
const checks = {};

async function clickTab(page, label) {
  return page.evaluate((label) => {
    const header = document.querySelector("header");
    const btns = header ? [...header.querySelectorAll("button")] : [];
    const match = btns.find((b) => (b.getAttribute("title") || "").includes(label) || [...b.querySelectorAll("span")].some((s) => (s.textContent || "").trim() === label));
    if (!match) return { ok: false };
    match.click();
    return { ok: true, text: (match.textContent || "").replace(/\s+/g, " ").trim() };
  }, label);
}

async function capture(page) {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    const text = main ? main.innerText : document.body.innerText;
    const count = (re) => (text.match(re) || []).length;
    const stat = (label) => {
      const m = text.match(new RegExp(label + "\\s*\\$([\\d,]+)\\s*(\\d+)"));
      return m ? { dollars: m[1], items: m[2] } : null;
    };
    const cardTitles = [];
    for (const el of document.querySelectorAll("main *")) {
      const t = (el.textContent || "").trim();
      if (el.children.length === 0 && /^Variable Frequency Drives/.test(t)) cardTitles.push(t.slice(0, 80));
      if (el.children.length === 0 && /^Rooftop Mechanical Equipment Disconnect/.test(t)) cardTitles.push(t.slice(0, 80));
      if (el.children.length === 0 && /^Low-Voltage 24V BAS/.test(t)) cardTitles.push(t.slice(0, 80));
      if (el.children.length === 0 && /^Duct Smoke Detector/.test(t)) cardTitles.push(t.slice(0, 80));
    }
    return {
      text,
      counts: {
        doubleBuyBadge: count(/REDUNDANT DOUBLE-BUY DETECTED/gi),
        voidBadge: count(/UNASSIGNED SCOPE VOID|SCOPE VOID DETECTED|VOID DETECTED/gi),
        vfd: count(/Variable Frequency Drives/gi),
        disconnect: count(/Rooftop Mechanical Equipment Disconnect/gi),
        basVoid: count(/Low-Voltage 24V BAS/gi),
        smokeVoid: count(/Duct Smoke Detector/gi),
        evaluated: (text.match(/\((\d+) evaluated\)/) || [])[1] ?? null,
      },
      stats: { doubleBuys: stat("Redundant Double-Buys"), scopeVoids: stat("Unassigned Scope Voids"), credits: stat("Recoverable Buyout Credits") },
      cardTitles: [...new Set(cardTitles)],
    };
  });
}

const { browser } = await launchBrowser();
const context = await browser.createBrowserContext();
const page = await context.newPage();
page.setDefaultTimeout(30000);
try {
  ev(`QA-11 2b CLASH PRECISION ${new Date().toISOString()}`);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(2500);

  await selectProjectByTitle(page, fixtures.empty.tag);
  await delay(2800);
  const tabEmpty = await clickTab(page, "Scope Clash");
  await delay(2200);
  const empty = await capture(page);
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa11-empty-scope-clash-fulltext.txt"), empty.text + "\n", "utf8");
  ev(`EMPTY tab click -> ${JSON.stringify(tabEmpty)}`);
  ev(`EMPTY counts: ${JSON.stringify(empty.counts)}`);
  ev(`EMPTY stats: ${JSON.stringify(empty.stats)}`);
  ev(`EMPTY cardTitles: ${JSON.stringify(empty.cardTitles)}`);
  ev(`EMPTY fulltext saved (${empty.text.length} chars)`);
  await shot(page, "remediation-qa11-16-empty-clash-precise.png");
  checks.emptyNoCards = empty.counts.doubleBuyBadge === 0 && empty.counts.voidBadge === 0 && empty.cardTitles.length === 0 ? "PASS" : "FAIL";
  checks.emptyZeroStats = empty.stats.doubleBuys && empty.stats.doubleBuys.dollars === "0" && empty.stats.doubleBuys.items === "0" && empty.stats.scopeVoids && empty.stats.scopeVoids.dollars === "0" && empty.stats.scopeVoids.items === "0" ? "PASS" : "FAIL";
  checks.emptyZeroEvaluated = empty.counts.evaluated === "0" ? "PASS" : "FAIL";
  checks.emptyTabBadgeClear = !/\d+\s*Clashes/i.test(tabEmpty.text || "") ? "PASS" : "FAIL";

  ev("");
  await selectProjectByTitle(page, "The Domain Tower B");
  await delay(2800);
  const tabDemo = await clickTab(page, "Scope Clash");
  await delay(2200);
  const demo = await capture(page);
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa11-demo-scope-clash-fulltext.txt"), demo.text + "\n", "utf8");
  ev(`DEMO tab click -> ${JSON.stringify(tabDemo)}`);
  ev(`DEMO counts: ${JSON.stringify(demo.counts)}`);
  ev(`DEMO stats: ${JSON.stringify(demo.stats)}`);
  ev(`DEMO cardTitles: ${JSON.stringify(demo.cardTitles)}`);
  ev(`DEMO fulltext saved (${demo.text.length} chars)`);
  await shot(page, "remediation-qa11-17-demo-clash-precise.png");
  checks.demoHasCards = demo.counts.doubleBuyBadge >= 2 && demo.counts.vfd >= 1 && demo.counts.disconnect >= 1 && demo.counts.basVoid >= 1 && demo.counts.smokeVoid >= 1 ? "PASS" : "FAIL";
  checks.demoAmounts = demo.text.includes("$50,500") && demo.text.includes("$46,500") ? "PASS" : "FAIL";
  checks.demoTabBadge = /\d+\s*Clashes/i.test(tabDemo.text || "") ? "PASS" : "FAIL";
  checks.demoEvaluated = demo.counts.evaluated === "6" ? "PASS" : "FAIL";

  const overall = Object.values(checks).every((v) => v === "PASS") ? "PASS" : "FAIL";
  ev("");
  ev(`2b PRECISION OVERALL: ${overall}`);
  ev(`CHECKS: ${JSON.stringify(checks)}`);
  console.log("JSON_RESULT " + JSON.stringify({ item: "2b-precise", result: overall, checks, empty: { counts: empty.counts, stats: empty.stats, tab: tabEmpty }, demo: { counts: demo.counts, stats: demo.stats, tab: tabDemo } }));
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa11-clash-precise.json"), JSON.stringify({ at: new Date().toISOString(), checks, empty: { counts: empty.counts, stats: empty.stats, tab: tabEmpty, cardTitles: empty.cardTitles }, demo: { counts: demo.counts, stats: demo.stats, tab: tabDemo, cardTitles: demo.cardTitles } }, null, 2), "utf8");
  writeLog("remediation-qa11-clash-precise.txt", LOG);
  process.exitCode = overall === "PASS" ? 0 : 1;
} catch (err) {
  ev(`ERROR: ${err && err.stack ? err.stack : err}`);
  writeLog("remediation-qa11-clash-precise.txt", LOG);
  process.exitCode = 1;
} finally {
  await browser.close();
}