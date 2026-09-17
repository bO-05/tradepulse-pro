// QA-10 tour first-visit + dismissal persistence (report LANDING claim) — correct control title.
// Usage: node scripts/qa-rem/qa10-tour-persist.mjs
import { launchBrowser, waitForAppReady, delay, BASE_URL, writeLog, getSelectorState } from "./qa1-lib.mjs";

const LOG = [];
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};

const { browser } = await launchBrowser();
try {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(25000);
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  await delay(2500);

  const first = await page.evaluate(() => ({
    ls: window.localStorage.getItem("tradepulse.tourDismissed"),
    scene: document.body.innerText.match(/Scene \d+\/06[^\n]*/)?.[0] ?? null,
    hasClose: Boolean(document.querySelector('button[title="Close Demo Tour"]')),
    hasMinimize: Boolean(document.querySelector('button[title="Minimize teleprompter"]')),
  }));
  const sel = await getSelectorState(page);
  ev(`first visit: ls=${first.ls} scene="${first.scene}" hasClose=${first.hasClose} hasMinimize=${first.hasMinimize}`);
  ev(`first visit selector: "${sel?.selectedText}"`);
  ev(`first visit verdict: tourOpen=${Boolean(first.scene)} demoLanding=${Boolean(sel?.selectedText?.includes("The Domain Tower B"))}`);

  await page.evaluate(() => document.querySelector('button[title="Close Demo Tour"]').click());
  await delay(800);
  const afterClose = await page.evaluate(() => ({
    ls: window.localStorage.getItem("tradepulse.tourDismissed"),
    scene: document.body.innerText.match(/Scene \d+\/06[^\n]*/)?.[0] ?? null,
  }));
  ev(`after dismiss: ls=${afterClose.ls} scene=${afterClose.scene}`);

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  await delay(2500);
  const afterReload = await page.evaluate(() => ({
    ls: window.localStorage.getItem("tradepulse.tourDismissed"),
    scene: document.body.innerText.match(/Scene \d+\/06[^\n]*/)?.[0] ?? null,
  }));
  ev(`after reload : ls=${afterReload.ls} scene=${afterReload.scene}`);
  ev(`persistence verdict: dismissed=${afterClose.ls === "1" && afterClose.scene === null} staysDismissedAfterReload=${afterReload.scene === null}`);

  const dest = writeLog("remediation-qa10-tour-persist.txt", LOG);
  console.log(`Wrote ${dest}`);
  console.log(`console errors: ${errs.length}`);
} finally {
  await browser.close();
}