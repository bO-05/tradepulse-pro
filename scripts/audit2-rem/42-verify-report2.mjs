import { launchBrowser, delay } from "./lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  try {
    const fileUrl = "file:///D:/Repo/ALL%20HACKATHONS/Convex/Convex%20all%20gas/doc/tradepulse%20audit%202/TradePulse-Pro-Remediation-2026-09-17-1400-UTC.html";
    await page.goto(fileUrl, { waitUntil: "load", timeout: 120000 });
    await delay(1000);
    // open details + scroll through to trigger lazy images
    await page.evaluate(() => { document.querySelectorAll("details").forEach((d) => (d.open = true)); });
    const total = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < total; y += 1200) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await delay(150);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await delay(1500);
    const info = await page.evaluate(() => ({
      images: [...document.querySelectorAll("figure img")].length,
      brokenImages: [...document.querySelectorAll("figure img")].filter((i) => !i.complete || i.naturalWidth === 0).length,
      testOutputPresent: document.body.textContent.includes("Test Files"),
      testPassed: document.body.textContent.includes("21 passed"),
      hasMissing: document.body.textContent.includes("Missing evidence"),
    }));
    console.log(JSON.stringify(info, null, 2));
  } finally {
    await browser.close();
  }
};
run();