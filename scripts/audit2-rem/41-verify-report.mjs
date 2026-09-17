import { launchBrowser, delay } from "./lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  try {
    const fileUrl = "file:///D:/Repo/ALL%20HACKATHONS/Convex/Convex%20all%20gas/doc/tradepulse%20audit%202/TradePulse-Pro-Remediation-2026-09-17-1400-UTC.html";
    await page.goto(fileUrl, { waitUntil: "load", timeout: 120000 });
    await delay(1500);
    const info = await page.evaluate(() => ({
      title: document.title,
      sections: [...document.querySelectorAll("section")].map((s) => s.id),
      images: [...document.querySelectorAll("figure img")].length,
      brokenImages: [...document.querySelectorAll("figure img")].filter((i) => !i.complete || i.naturalWidth === 0).length,
      tables: document.querySelectorAll("table").length,
      rows: document.querySelectorAll("tbody tr").length,
      height: document.body.scrollHeight,
      testOutputPresent: document.body.innerText.includes("Test Files"),
      hasMissing: document.body.innerText.includes("Missing evidence"),
    }));
    console.log(JSON.stringify(info, null, 2));
  } finally {
    await browser.close();
  }
};
run();