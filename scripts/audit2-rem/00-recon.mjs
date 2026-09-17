import { launchBrowser, attachDiagnostics, waitForAppReady, getSelectorState, shot, writeJson, bodyText, BASE_URL, delay, writeLog } from "./lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const out = { url: BASE_URL, startedAt: new Date().toISOString() };
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    out.selector = await getSelectorState(page);
    out.bodyTextHead = (await bodyText(page)).slice(0, 3000);
    out.kpiBand = await page.evaluate(() => {
      const main = document.querySelector("main");
      return main ? main.innerText.slice(0, 1500) : null;
    });
    out.localStorageKeys = await page.evaluate(() => Object.keys(window.localStorage));
    out.standaloneSize = await page.evaluate(() => (window.localStorage.getItem("tradepulse_standalone_v3") || "").length);
    out.domStats = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      buttons: document.querySelectorAll("button").length,
      tabs: [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 60),
    }));
    await shot(page, "fix-recon-landing.png");
  } catch (e) {
    out.error = String(e && e.stack ? e.stack : e);
  } finally {
    out.console = diag.consoleLogs.slice(0, 50);
    out.pageErrors = diag.pageErrors;
    out.failedRequests = diag.failedRequests;
    writeJson("fix-recon-baseline.json", out);
    await browser.close();
  }
  console.log(JSON.stringify(out, null, 2));
};

run();