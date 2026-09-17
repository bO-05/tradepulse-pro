// QA-13 RFI badge DOM probe (item 7b evidence): visible PM name + tooltip.
import {
  launchBrowser,
  shot,
  waitForAppReady,
  delay,
  BASE_URL,
  writeLog,
} from "./qa1-lib.mjs";
import fs from "node:fs";
import path from "node:path";

const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const fixture = JSON.parse(
  fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa13-fixtures.json"), "utf8")
);
const LOG = [];
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};

const { browser } = await launchBrowser();
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem("tradepulse.tourDismissed", "1");
    } catch (e) {}
  });
  await page.goto(`${BASE_URL}/?project=${fixture.clashProjectId}&tab=qna`, { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  await delay(2500);
  const badge = await page.evaluate(() => {
    const els = [...document.querySelectorAll("span")].filter((s) => (s.textContent || "").includes("Approved for Addendum"));
    const visible = els.find((e) => e.offsetParent !== null);
    return els.map((e) => ({ text: e.textContent.trim(), title: e.getAttribute("title") }));
  });
  ev(`RFI certified badge candidates: ${JSON.stringify(badge, null, 1)}`);
  await shot(page, "remediation-qa13-item7b-rfi-badge-evidence.png");
  const logPath = writeLog("remediation-qa13-rfi-badge-log.txt", LOG);
  console.log(`Wrote ${logPath}`);
} finally {
  await browser.close();
}