import { client, launchBrowser, attachDiagnostics, waitForAppReady, delay, selectProjectByTitle, shot, writeEvidence, FIXTURE_TAG } from "./qa9-lib.mjs";
const c = client();
const PROJECT = `${FIXTURE_TAG}-J6-RECOVERY`;
const proj = (await c.query("projects:listProjects", {})).find((p) => p.title === PROJECT);
const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
const diag = attachDiagnostics(page);
const out = {};
try {
  await page.goto(`https://brainy-skunk-440.convex.site/?project=${proj._id}&tab=qna`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('select[aria-label="Target trade package for this RFI"]', { timeout: 30000 });
  await delay(1200);
  out.qnaDeepLink = { hasSelect: true, heading: (await page.evaluate(() => document.body.innerText)).split("\n").filter((l) => /Pre-Bid|RFI/.test(l)).slice(0, 3) };
  await page.keyboard.press("Digit4");
  await delay(1400);
  await page.goBack({ waitUntil: "domcontentloaded" });
  await delay(1500);
  out.afterBack = { url: page.url().split("?")[1], hasSelect: await page.evaluate(() => Boolean(document.querySelector('select[aria-label="Target trade package for this RFI"]'))) };
  await page.keyboard.press("Digit6");
  await delay(1400);
  out.contracts = { url: page.url().split("?")[1], hasSearchInput: await page.evaluate(() => Boolean(document.querySelector('input[placeholder*="Search by agreement"]'))), text: (await page.evaluate(() => document.body.innerText)).split("\n").filter((l) => /contract|agreement|subcontract/i.test(l)).slice(0, 5) };
  // fresh-profile first-load deep-link check (new incognito browser context)
  const ctx = await browser.createBrowserContext();
  const p2 = await ctx.newPage();
  await p2.goto(`https://brainy-skunk-440.convex.site/?project=${proj._id}&tab=leveling`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p2.waitForSelector('select[aria-label="Select Commercial Construction Project"]', { timeout: 45000 });
  await delay(10000);
  out.freshDeepLink = await p2.evaluate(() => {
    const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
    return { selected: sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].textContent.trim() : null, url: window.location.search };
  });
  await shot(p2, "fix4-qa9-j6b-fresh-deeplink.png");
  await ctx.close();
} catch (e) {
  out.crash = String(e.message);
}
writeEvidence("j6b-recovery", out);
await browser.close();
console.log(JSON.stringify(out, null, 1));