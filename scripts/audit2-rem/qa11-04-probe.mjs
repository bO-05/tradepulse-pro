import { attachDiagnostics, clickHeaderTab, delay, selectProjectByTitle, waitForAppReady } from "./qa6-lib.mjs";
import { BASE_URL, launchBrowser } from "./lib.mjs";
import { readEvidence } from "./qa11-lib.mjs";

const F = readEvidence("fixtures");
const { browser } = await launchBrowser(1440, 900);
const page = await browser.newPage();
attachDiagnostics(page);
await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await waitForAppReady(page);
await selectProjectByTitle(page, "AUDIT-QA11-MAIN");
await delay(1800);
await clickHeaderTab(page, "05: Scope Clash");
await delay(2000);
const out = await page.evaluate(() => {
  const text = document.body.innerText;
  const badges = [...document.querySelectorAll("span")].map((s) => s.innerText.trim()).filter((t) => /deducted|Deducted/i.test(t));
  const cards = [...document.querySelectorAll("div.rounded-xl")].filter((d) => /Redundant Double-Buy Detected|Credit Deducted/i.test(d.innerText));
  return {
    badges: [...new Set(badges)],
    cards: cards.map((c) => ({ statusLine: c.innerText.split("\n").slice(0, 6), tail: c.innerText.split("\n").slice(-8) })),
    netExposureLine: text.split("\n").filter((l) => /Recoverable|Redundant Double|Coordination Risk|\$48/.test(l)),
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();