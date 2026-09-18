import { launchBrowser, delay } from "./lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  try {
    const fileUrl = "file:///D:/Repo/ALL%20HACKATHONS/Convex/Convex%20all%20gas/TradePulse-Pro-User-Journey-Audit-2026-09-18-0910-UTC.html";
    await page.goto(fileUrl, { waitUntil: "load", timeout: 120000 });
    const total = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < total; y += 800) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await delay(250); }
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(4000);
    const info = await page.evaluate(() => [...document.querySelectorAll("figure img")].map((i) => ({
      caption: (i.closest("figure")?.querySelector("figcaption")?.textContent || "").slice(0, 50),
      complete: i.complete,
      naturalWidth: i.naturalWidth,
      srcHead: i.src.slice(0, 30),
    })));
    console.log(JSON.stringify(info, null, 1));
  } finally {
    await browser.close();
  }
};
run();