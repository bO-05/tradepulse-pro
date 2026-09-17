// QA-12 tour re-probe with correct selectors (expanded bar: title="Close Demo Tour").
import { launchBrowser, delay, BASE_URL, writeLog } from "./qa1-lib.mjs";
import fs from "node:fs";
import path from "node:path";

const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const LOG = [];
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};

async function tourState(page) {
  return page.evaluate(() => {
    const close = document.querySelector('button[title="Close Demo Tour"]');
    const minimize = document.querySelector('button[title="Minimize teleprompter"]');
    const expand = document.querySelector('button[title="Expand Investor Demo Teleprompter"]');
    const scene = /Scene\s*\d\/06/.test(document.body.innerText);
    const cue = /Cue:/.test(document.body.innerText);
    return {
      closeDemoTour: Boolean(close),
      minimize: Boolean(minimize),
      expandMinimized: Boolean(expand),
      sceneText: scene,
      cueText: cue,
      lsTour: localStorage.getItem("tradepulse.tourDismissed"),
    };
  });
}

async function run() {
  const { browser } = await launchBrowser();
  try {
    ev("=== QA-12 TOUR RE-PROBE (correct selectors) ===");
    ev(`UTC: ${new Date().toISOString()}`);
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.setDefaultTimeout(30000);
    const consoleErrors = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('select[aria-label="Select Commercial Construction Project"]', { timeout: 30000 });
    await delay(2500);
    const s1 = await tourState(page);
    ev(`fresh context initial: ${JSON.stringify(s1)}`);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "remediation-qa12-14-tour-expanded-fresh.png") });

    // dismiss via correct button
    const clicked = await page.evaluate(() => {
      const b = document.querySelector('button[title="Close Demo Tour"]');
      if (!b) return { ok: false, available: [...document.querySelectorAll("button")].map((x) => x.getAttribute("title")).filter(Boolean).slice(0, 30) };
      b.click();
      return { ok: true };
    });
    await delay(800);
    const s2 = await tourState(page);
    ev(`after clicking Close Demo Tour: clicked=${JSON.stringify(clicked)} state=${JSON.stringify(s2)}`);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('select[aria-label="Select Commercial Construction Project"]', { timeout: 30000 });
    await delay(2500);
    const s3 = await tourState(page);
    ev(`after reload (same context): ${JSON.stringify(s3)}`);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "remediation-qa12-15-after-tour-dismiss-reload.png") });

    // fresh context after dismissal should show tour again (isolated storage)
    const ctx2 = await browser.createBrowserContext();
    const page2 = await ctx2.newPage();
    await page2.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page2.waitForSelector('select[aria-label="Select Commercial Construction Project"]', { timeout: 30000 });
    await delay(2500);
    const s4 = await tourState(page2);
    ev(`second fresh context (isolated storage): ${JSON.stringify(s4)}`);

    ev(`console errors observed: ${consoleErrors.length}`);
    for (const e of consoleErrors) ev(`  ERROR: ${e}`);

    const out = { at: new Date().toISOString(), initial: s1, clicked, afterDismiss: s2, afterReload: s3, secondFreshContext: s4, consoleErrors };
    fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa12-tour.json"), JSON.stringify(out, null, 2), "utf8");
    writeLog("remediation-qa12-tour.txt", LOG);
    await browser.close();
    console.log("Wrote evidence.");
  } catch (e) {
    writeLog("remediation-qa12-tour.txt", LOG.concat([`FATAL: ${e?.stack || e}`]));
    await browser.close();
    process.exit(1);
  }
}

run();