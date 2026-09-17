import { launchBrowser, attachDiagnostics, waitForAppReady, getSelectorState, shot, writeLog } from "./qa1-lib.mjs";
import { setTimeout as delay } from "node:timers/promises";

const log = [];
const say = (s) => { log.push(s); console.log(s); };

const { browser } = await launchBrowser();
const page = await browser.newPage();
const diag = attachDiagnostics(page);
await page.goto("https://brainy-skunk-440.convex.site", { waitUntil: "domcontentloaded", timeout: 60000 });
await waitForAppReady(page);
await delay(1500);

const first = await getSelectorState(page);
say(`default landing project: ${JSON.stringify(first?.selectedText)}`);
const demoDefault = Boolean(first?.selectedText && first.selectedText.includes("Domain Tower"));
say(`LANDING RESULT: ${demoDefault ? "PASS (demo project is default landing)" : "FAIL"}`);

const tourVisibleBefore = await page.evaluate(() => document.body.innerText.includes("Demo Tour") || document.body.innerText.toLowerCase().includes("walkthrough"));
const toggled = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Demo Tour"));
  if (b) { b.click(); return true; }
  return false;
});
await delay(800);
const dismissedFlag = await page.evaluate(() => window.localStorage.getItem("tradepulse.tourDismissed"));
say(`tour toggle clicked=${toggled}; dismissed flag=${dismissedFlag}`);
await shot(page, "remediation-r3-01-dismissed-tour.png");
await page.reload({ waitUntil: "domcontentloaded" });
await waitForAppReady(page);
await delay(1200);
const persisted = await page.evaluate(() => window.localStorage.getItem("tradepulse.tourDismissed"));
say(`after reload tour flag=${persisted}`);
say(`TOUR RESULT: ${persisted === "1" ? "PASS (dismissal persists)" : "FAIL"}`);

const after = await getSelectorState(page);
say(`after reload selected: ${JSON.stringify(after?.selectedText)}`);
const diagSummary = {
  consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text),
  pageErrors: diag.pageErrors,
  failedRequests: diag.failedRequests,
};
say(`diagnostics: ${JSON.stringify(diagSummary)}`);
writeLog("remediation-r3-landing-log.txt", log);
await browser.close();
if (!demoDefault || persisted !== "1") process.exitCode = 1;