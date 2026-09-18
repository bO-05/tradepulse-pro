import { launchBrowser, waitForAppReady, delay } from "./lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1500);
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); });
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Evals & Architecture"))?.click(); });
    await delay(1800);
    const snippet = await page.evaluate(() => {
      const t = document.body.innerText;
      const i = t.indexOf("Holdout");
      return i >= 0 ? t.slice(Math.max(0, i - 400), i + 300) : "NOT FOUND; text length " + t.length;
    });
    console.log("---- around Holdout ----");
    console.log(snippet);
    const kpis = await page.evaluate(() => [...document.querySelectorAll("span")].filter((s) => /Holdout|MAPE|Recall|Conformity|Extracted/.test(s.textContent || "")).map((s) => (s.textContent || "").trim()).slice(0, 20));
    console.log("---- kpi spans ----");
    console.log(JSON.stringify(kpis, null, 1));
  } finally {
    await browser.close();
  }
};
run();