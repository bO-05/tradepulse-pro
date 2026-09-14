import { createRequire } from "module";
const require = createRequire("d:/Repo/ALL HACKATHONS/Convex/Convex all gas/package.json");
const puppeteer = require("puppeteer-core");
import path from "path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ARTIFACT_DIR = "C:\\Users\\user\\.gemini\\antigravity\\brain\\5aee1193-d7e9-458c-a44a-5bbb9aa83068";

async function capture() {
  console.log("Launching Chrome via puppeteer-core...");
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
      await page.screenshot({ path: path.join(ARTIFACT_DIR, filename), fullPage: false });
      console.log(`Saved ${filename}`);
    } else {
      console.warn(`Could not find button matching: ${tabMatch}`);
    }
  }

  // 1. Packages
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "v2_01_packages.png"), fullPage: false });
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
