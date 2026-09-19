import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
const REPO_ROOT = process.env.QA_REPO_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO_ROOT, "package.json"));

// Portable screenshot capture: requires the app at APP_URL (default vite preview)
// and Chrome/Edge on PATH candidates. Override with APP_URL, CAPTURE_DIR, QA_CHROME_PATH.
const APP_URL = process.env.APP_URL || "http://localhost:4173";
const CAPTURE_DIR = process.env.CAPTURE_DIR || path.join(REPO_ROOT, "evidence", "captures");
const CHROME_CANDIDATES = [
  process.env.QA_CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const CHROME_PATH = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
if (!CHROME_PATH) {
  throw new Error("No Chrome/Edge executable found. Set QA_CHROME_PATH to a browser binary.");
}
fs.mkdirSync(CAPTURE_DIR, { recursive: true });

const puppeteer = require("puppeteer-core");

const DIRS = [CAPTURE_DIR];

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
  const targetUrl = APP_URL;
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
