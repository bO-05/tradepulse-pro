// QA-10 micro-probe: identify the live tour DOM controls (fresh context).
// Usage: node scripts/qa-rem/qa10-tour-dom.mjs
import { launchBrowser, waitForAppReady, delay, BASE_URL, writeLog } from "./qa1-lib.mjs";

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
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  await delay(2500);
  const dump = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    return {
      ls: window.localStorage.getItem("tradepulse.tourDismissed"),
      scene: document.body.innerText.match(/Scene \d+\/06[^\n]*/)?.[0] ?? null,
      tourButtons: btns
        .filter((b) => {
          const t = (b.textContent || "").trim();
          const title = b.getAttribute("title") || "";
          const aria = b.getAttribute("aria-label") || "";
          return /dismiss|teleprompter|tour|script|restart/i.test(`${t} ${title} ${aria}`);
        })
        .map((b) => ({
          text: (b.textContent || "").trim().slice(0, 60),
          title: b.getAttribute("title"),
          aria: b.getAttribute("aria-label"),
          cls: (b.className || "").toString().slice(0, 60),
        })),
      tourInputs: [...document.querySelectorAll("input,textarea")].length,
    };
  });
  ev(JSON.stringify(dump, null, 2));
  writeLog("remediation-qa10-tour-dom.txt", LOG);
} finally {
  await browser.close();
}