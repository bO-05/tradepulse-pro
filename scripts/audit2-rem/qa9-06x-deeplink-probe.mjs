import { launchBrowser, attachDiagnostics, waitForAppReady, delay, shot } from "./qa9-lib.mjs";
const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
const diag = attachDiagnostics(page);
const url = process.argv[2] || "https://brainy-skunk-440.convex.site/?project=jx75p9vyyz6ps7v8g21ky7yce58enx09&tab=packages";
try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await delay(7000);
  const t = await page.evaluate(() => document.body.innerText.slice(0, 700));
  console.log("BODY:", t);
  console.log("select:", await page.evaluate(() => Boolean(document.querySelector('select[aria-label="Select Commercial Construction Project"]'))));
} catch (e) {
  console.log("ERR", e.message);
}
console.log("consoleErrors", JSON.stringify(diag.consoleLogs.filter((l) => l.type === "error").slice(0, 5)));
console.log("pageErrors", JSON.stringify(diag.pageErrors.slice(0, 3)));
await shot(page, "fix4-qa9-j6-deeplink-probe.png");
await browser.close();