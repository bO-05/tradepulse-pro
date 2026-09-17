import fs from "node:fs";
import path from "node:path";
import {
  BASE_URL,
  EVIDENCE_DIR,
  launchBrowser,
  waitForAppReady,
  selectProjectByTitle,
  bodyText,
  shot,
  writeLog,
  delay,
} from "./qa1-lib.mjs";

const log = [];
const say = (s) => {
  console.log(s);
  log.push(s);
};

const fixtures = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa9-fixtures.json"), "utf8"));
const FIXTURE_TITLE = fixtures.fixture.title;

const { browser } = await launchBrowser();
say(`QA9 TOUR-NARRATION TEXT CAPTURE at ${new Date().toISOString()}`);
const context = await browser.createBrowserContext();
const page = await context.newPage();

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(1300);
  await selectProjectByTitle(page, FIXTURE_TITLE);
  await delay(1600);
  const tourText = await page.evaluate(() => {
    const fixedish = [...document.querySelectorAll("div")].find((d) => {
      const t = (d.innerText || "");
      return t.includes("Scene 05/06") || t.includes("Scene 01/06");
    });
    return fixedish ? fixedish.innerText : null;
  });
  const body = await bodyText(page);
  const vfdIdx = body.indexOf("Variable Frequency Drives");
  say(`tour bar container text:\n${tourText}`);
  say(`\nbody contains "Variable Frequency Drives": ${vfdIdx >= 0}`);
  if (vfdIdx >= 0) say(`verbatim context: ...${body.slice(Math.max(0, vfdIdx - 220), vfdIdx + 260)}...`);
  const bodyHasSym = body.includes("Cross-Trade Scope Clash & Double-Buy Detection");
  say(`body has Scope Clash heading: ${bodyHasSym}`);
  await shot(page, "remediation-qa9-13-tour-narration-empty-fixture.png");
  writeLog("remediation-qa9-04-tour-narration.txt", log);
} catch (err) {
  say(`ERROR: ${err && err.stack ? err.stack : err}`);
  writeLog("remediation-qa9-04-tour-narration.txt", log);
  process.exitCode = 1;
} finally {
  await browser.close();
}