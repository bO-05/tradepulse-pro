import { launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, delay } from "./lib.mjs";
import { findButton, findHandles, realClick, selectProject, projectOptionState, clickTab, dismissTour } from "./qa1-lib.mjs";

const TITLE = "AUDIT-QA1-BIDS-2026-09-18";
const R = { at: new Date().toISOString() };
const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await dismissTour(page);
    await selectProject(page, TITLE);
    await delay(3000);
    await dismissTour(page);
    R.tabClick = await clickTab(page, "04:");
    await delay(2500);
    await dismissTour(page);
    R.bodyHead = await page.evaluate(() => document.body.innerText.slice(0, 1600));
    R.buttons = (await findHandles(page, "button", () => true, null)).map((b) => b.meta.text || b.meta.title || b.meta.aria).filter(Boolean).slice(0, 60);
    R.tabState = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("04:"));
      return b ? { title: b.getAttribute("title"), cls: b.className.slice(0, 80) } : null;
    });
    await shot(page, "fix4-qa1-debug-leveling.png", { full: true });
    R.diag = { consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text.slice(0, 200)).slice(0, 5) };
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    await shot(page, "fix4-qa1-debug-leveling-error.png", { full: true }).catch(() => {});
  } finally {
    await browser.close();
    writeJson("fix4-qa1-debug-leveling.json", R);
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 9000));
};
run();