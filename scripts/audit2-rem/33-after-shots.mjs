import { launchBrowser, waitForAppReady, shot, delay } from "./lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1200);
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); });
    await delay(300);
    // BUG-33 after: dock with trapped focus
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("60s Judge Dock"))?.click(); });
    await delay(900);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await shot(page, "live-BUG33-dock-focus.png");
    await page.keyboard.press("Escape");
    await delay(500);
    // BUG-34 after at 1024
    await page.setViewport({ width: 1024, height: 900, deviceScaleFactor: 1 });
    await delay(600);
    await shot(page, "live-BUG34-1024.png");
    await page.setViewport({ width: 768, height: 900, deviceScaleFactor: 1 });
    await delay(600);
    await shot(page, "live-BUG34-768.png");
    console.log("done");
  } finally {
    await browser.close();
  }
};
run();