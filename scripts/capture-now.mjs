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


async function run() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--window-size=1440,900"],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  await page.goto(APP_URL, { waitUntil: "networkidle2", timeout: 35000 });
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(CAPTURE_DIR, "test_current_view.png"), fullPage: false });
  console.log("Successfully captured test_current_view.png");
  await browser.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
