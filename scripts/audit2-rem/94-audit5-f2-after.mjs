import { setTimeout as delay } from "node:timers/promises";
import { launchBrowser, waitForAppReady, shot, writeJson } from "./lib.mjs";

const R = { startedAt: new Date().toISOString() };

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const closeTour = async () => {
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); });
    await delay(300);
  };
  const selectProject = async (needle) => {
    await page.evaluate((n) => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      const o = [...s.options].find((x) => x.textContent.includes(n));
      s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true }));
    }, needle);
    await delay(1600);
  };
  const kpiText = () => page.evaluate(() => {
    const main = document.querySelector("main");
    return main ? main.innerText.split("\n").slice(0, 14).join(" | ") : null;
  });
  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1200);
    await closeTour();

    // Zero-bid project (leftover GC-AUDIT, 0 bids)
    await selectProject("GC-AUDIT");
    R.zeroBids = {
      compact: await kpiText(),
      has79: await page.evaluate(() => document.body.innerText.includes("79.4%")),
      claimsSavings: await page.evaluate(() => /Savings: \d/.test(document.body.innerText)),
      claimsBestBid: await page.evaluate(() => document.body.innerText.includes("(best bid per package)")),
    };
    await shot(page, "fix4-after-F2-zero-bids-compact.png");
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Expand 6-Card KPI View"))?.click(); });
    await delay(600);
    R.zeroBids.expanded = await kpiText();
    await shot(page, "fix4-after-F2-zero-bids-expanded.png");
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Compact Mode"))?.click(); });
    await delay(400);

    // Demo project (all 3 packages have bids)
    await selectProject("The Domain Tower B");
    R.bidsProject = {
      compact: await kpiText(),
      claimsBestBid: await page.evaluate(() => document.body.innerText.includes("(best bid per package)")),
      showsVariancePercent: await page.evaluate(() => /Variance: \+?\$[\d,]+\(\d/.test(document.body.innerText.replace(/\s/g, ""))),
      claimsNotBidBased: await page.evaluate(() => document.body.innerText.includes("not bid-based")),
    };
    await shot(page, "fix4-after-F2-bids-compact.png");
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Expand 6-Card KPI View"))?.click(); });
    await delay(600);
    R.bidsProject.expanded = await kpiText();
    await shot(page, "fix4-after-F2-bids-expanded.png");
    writeJson("fix4-after-f2.json", R);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    writeJson("fix4-after-f2.json", R);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 9000));
};
run();