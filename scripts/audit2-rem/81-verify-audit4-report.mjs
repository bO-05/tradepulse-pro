import { launchBrowser, delay } from "./lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  try {
    const fileUrl = "file:///D:/Repo/ALL%20HACKATHONS/Convex/Convex%20all%20gas/TradePulse-Pro-User-Journey-Audit-2026-09-18-0910-UTC.html";
    await page.goto(fileUrl, { waitUntil: "load", timeout: 120000 });
    await delay(800);
    const total = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < total; y += 1200) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await delay(120); }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(async () => { const imgs=[...document.querySelectorAll("figure img")]; await Promise.all(imgs.map((i)=>i.complete?null:i.decode().catch(()=>null))); }); await delay(1200);
    const info = await page.evaluate(() => ({
      title: document.title,
      sections: [...document.querySelectorAll("section")].map((s) => s.id),
      images: [...document.querySelectorAll("figure img")].length,
      brokenImages: [...document.querySelectorAll("figure img")].filter((i) => !i.complete || i.naturalWidth === 0).length,
      rows: document.querySelectorAll("tbody tr").length,
      missing: document.body.textContent.includes("Missing evidence"),
      unresolved: document.body.textContent.includes("{{"),
    }));
    console.log(JSON.stringify(info, null, 2));
  } finally {
    await browser.close();
  }
};
run();