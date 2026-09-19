import { launchBrowser, attachDiagnostics, waitForAppReady, delay } from "./lib.mjs";
import { readEvidence } from "./qa14-lib.mjs";

const fx = readEvidence("fixtures");
const { browser } = await launchBrowser(1440, 900);
const page = await browser.newPage();
const diag = attachDiagnostics(page);
await page.evaluateOnNewDocument((pkg) => {
  window.localStorage.setItem("tradepulse.selectedProjectId", pkg.projectId);
  window.localStorage.setItem("tradepulse.selectedPackageId", pkg.packageId);
}, { projectId: fx.tzProjectId, packageId: fx.futureControlPackageId });
await page.goto(`https://brainy-skunk-440.convex.site/?project=${fx.tzProjectId}&tab=discovery&qa14=debug`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await waitForAppReady(page);
await delay(2500);
const state = await page.evaluate(() => ({
  url: location.href,
  lsProject: localStorage.getItem("tradepulse.selectedProjectId"),
  lsPackage: localStorage.getItem("tradepulse.selectedPackageId"),
  projectSelect: (() => {
    const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
    return s ? { value: s.value, text: s.options[s.selectedIndex]?.textContent?.trim() } : null;
  })(),
  editButtons: document.querySelectorAll('button[title="Edit contractor info"]').length,
  body: document.body.innerText.slice(0, 3000),
}));
console.log(JSON.stringify(state, null, 1));
console.log("console:", JSON.stringify(diag.consoleLogs.slice(-5)));
console.log("errors:", JSON.stringify(diag.pageErrors));
await browser.close();