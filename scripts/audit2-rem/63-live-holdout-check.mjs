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
    await delay(1500);
    const t = await page.evaluate(() => document.body.innerText);
    console.log("honestTitle:", t.includes("Bid Extraction & ADR-0003 Normalization Check"));
    console.log("holdoutKpi:", t.includes("Holdout — Answer Not In Prompt"));
    console.log("holdoutValue:", ((t.match(/Holdout — Answer Not In Prompt\n([\s\S]{0,140})/) || [])[1] || "").replace(/\n/g, " | "));
    console.log("openaiByok:", t.includes("Adapter ready — OPENAI_API_KEY not set"));
    console.log("runId:", (t.match(/Run ID: eval_\d+/) || [])[0] || null);
  } finally {
    await browser.close();
  }
};
run();