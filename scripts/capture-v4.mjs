import { createRequire } from "module";
const require = createRequire("d:/Repo/ALL HACKATHONS/Convex/Convex all gas/package.json");
const puppeteer = require("puppeteer-core");
import path from "path";
import fs from "fs";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DIRS = [
  "C:\\Users\\user\\.gemini\\antigravity\\brain\\012f13f8-dc68-4a31-8994-a9cdb96ec882",
  "C:\\Users\\user\\.gemini\\antigravity\\brain\\5aee1193-d7e9-458c-a44a-5bbb9aa83068"
];

for (const d of DIRS) {
  if (!fs.existsSync(d)) {
    try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
  }
}

async function saveScreenshots(page, baseName) {
  for (const dir of DIRS) {
    const fullPath = path.join(dir, baseName);
    await page.screenshot({ path: fullPath, fullPage: false });
  }
  console.log(`Saved ${baseName}`);
}

async function capture() {
  console.log("Launching Chrome...");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--window-size=1440,900"],
    defaultViewport: { width: 1440, height: 900 },
  });

  const page = await browser.newPage();
  const targetUrl = "http://localhost:4173";
  console.log(`Navigating to ${targetUrl}...`);
  await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 35000 });
  await new Promise((r) => setTimeout(r, 2000));

  async function clickTab(tabMatch) {
    console.log(`Clicking tab matching: "${tabMatch}"...`);
    const clicked = await page.evaluate((name) => {
      const buttons = Array.from(document.querySelectorAll("header button, nav button, div button"));
      const match = buttons.find((b) => b.textContent && b.textContent.toLowerCase().includes(name.toLowerCase()));
      if (match) {
        match.click();
        return true;
      }
      return false;
    }, tabMatch);
    await new Promise((r) => setTimeout(r, 1200));
    return clicked;
  }

  // 1. Packages
  await saveScreenshots(page, "v4_01_packages.png");

  // 2. Discovery
  await clickTab("Discovery");
  await saveScreenshots(page, "v4_02_discovery.png");

  // 3. Pre-Bid Q&A
  await clickTab("Pre-Bid");
  await saveScreenshots(page, "v4_03_prebid.png");

  // 4. Leveling Matrix (Cards View)
  await clickTab("Leveling");
  await saveScreenshots(page, "v4_04_leveling_cards.png");

  // 5. Leveling Matrix (Spread Table View)
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find(x => x.textContent && x.textContent.includes("Spread Table"));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  await saveScreenshots(page, "v4_05_leveling_table.png");

  // 6. Cross-Trade Scope Clash
  await clickTab("Scope Clash");
  await saveScreenshots(page, "v4_06_clash.png");

  // 7. Subcontracts Register
  await clickTab("Subcontracts");
  await saveScreenshots(page, "v4_07_contracts.png");

  // 8. Open AIA A401 Modal from Contracts Register
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find(x => x.textContent && x.textContent.includes("Inspect AIA A401"));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 1000));
  await saveScreenshots(page, "v4_08_executed_contract_modal.png");

  // Close modal
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find(x => x.textContent && x.textContent.includes("Close Viewer"));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 500));

  // 9. Live Activity Audit
  await clickTab("Live Activity");
  await saveScreenshots(page, "v4_09_audit.png");

  // 10. Evals & Architecture
  await clickTab("Evals");
  await saveScreenshots(page, "v4_10_evals.png");

  // 11. Judge Dock
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find(x => x.textContent && x.textContent.includes("Judge Dock"));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 1000));
  await saveScreenshots(page, "v4_11_judge_dock.png");

  await browser.close();
  console.log("All v4 captures complete!");
}

capture().catch((e) => {
  console.error("Capture error:", e);
  process.exit(1);
});
