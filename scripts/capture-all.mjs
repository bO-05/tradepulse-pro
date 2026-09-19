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


async function capture() {
  console.log("Launching Chrome via puppeteer-core...");
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

  async function clickTabAndCapture(tabMatch, filename) {
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

    if (clicked) {
      await new Promise((r) => setTimeout(r, 1200));
      await page.screenshot({ path: path.join(CAPTURE_DIR, filename), fullPage: false });
      console.log(`Saved ${filename}`);
    } else {
      console.warn(`Could not find button matching: ${tabMatch}`);
    }
  }

  // 1. Packages
  await page.screenshot({ path: path.join(CAPTURE_DIR, "v2_01_packages.png"), fullPage: false });
  // 2. Discovery
  await clickTabAndCapture("Discovery", "v2_02_discovery.png");
  // 3. Pre-Bid Q&A
  await clickTabAndCapture("Pre-Bid", "v2_03_prebid.png");
  // 4. Leveling
  await clickTabAndCapture("Leveling", "v2_04_leveling.png");
  // 5. Scope Clash
  await clickTabAndCapture("Scope Clash", "v2_05_clash.png");
  // 6. Contracts
  await clickTabAndCapture("Subcontracts", "v2_06_contracts.png");
  // 7. Audit
  await clickTabAndCapture("Live Activity", "v2_07_audit.png");
  // 8. Evals
  await clickTabAndCapture("Evals", "v2_08_evals.png");

  await browser.close();
  console.log("All v2 captures complete!");
}

capture().catch((e) => {
  console.error("Capture error:", e);
  process.exit(1);
});
