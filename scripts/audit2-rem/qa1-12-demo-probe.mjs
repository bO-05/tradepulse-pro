import { launchBrowser, waitForAppReady, shot, writeJson, delay } from "./lib.mjs";
import { findButton, findHandles, realClick, selectProject, projectOptionState, clickTab, dismissTour } from "./qa1-lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const BASE = "https://brainy-skunk-440.convex.site/";
const R = { at: new Date().toISOString() };
const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await dismissTour(page);
    await selectProject(page, "The Domain Tower B");
    await delay(2500);
    await dismissTour(page);
    await clickTab(page, "04:");
    await delay(2200);
    await dismissTour(page);
    R.levelingText = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        awardedBanner: (t.match(/Subcontract Awarded:[^\n]*/) || [])[0] || null,
        awardButtons: (t.match(/Award Subcontract & Generate AIA A401/g) || []).length,
        awardCompliantButtons: (t.match(/Award Compliant Winner/g) || []).length,
        inspected: (t.match(/Contract Awarded • AIA A401 Generated/g) || []).length,
        rosendinRank: (t.match(/Rank #\d+[\s\S]{0,120}?Rosendin/) || [])[0] ? (t.match(/Rank #(\d+)\s+[^\n]*\n?[^\n]*Rosendin/) || [])[1] || "see shot" : null,
      };
    });
    await shot(page, "fix4-qa1-demo-leveling.png", { full: true });
    await clickTab(page, "06:");
    await delay(2000);
    R.contractsText = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        activeSum: (t.match(/ACTIVE CONTRACTED SUM\s*\$?([\d,]+)/) || [])[1] || null,
        executed: (t.match(/Execution Status Recorded/g) || []).length,
        statusBadge: (t.match(/Generated \/ Pending Execution/g) || []).length,
        recordButtons: (t.match(/Record Execution Status/g) || []).length,
      };
    });
    await shot(page, "fix4-qa1-demo-contracts.png", { full: true });
    R.consoleErrors = [];
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
  } finally {
    await browser.close();
    writeJson("fix4-qa1-demo-probe.json", R);
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 6000));
};
run();