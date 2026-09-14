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

async function run() {
  console.log("Launching Chrome...");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--window-size=1440,900"],
    defaultViewport: { width: 1440, height: 900 },
  });

  const page = await browser.newPage();
  await page.goto("http://localhost:4173", { waitUntil: "networkidle2", timeout: 35000 });
  await new Promise((r) => setTimeout(r, 2000));

  // 1. Leveling Cards view
  console.log("Navigating to Leveling tab...");
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find(x => x.textContent && x.textContent.includes("Leveling"));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 1200));
  await saveScreenshots(page, "v5_04_leveling_cards.png");

  // 2. Click Award Compliant Winner
  console.log("Clicking Award Compliant Winner...");
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find(x => x.textContent && x.textContent.includes("Award Compliant Winner"));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 1500));
  await saveScreenshots(page, "v5_04_awarded_card.png");

  // 3. Inspect AIA A401 from awarded card
  console.log("Opening AIA A401 Modal...");
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find(x => x.textContent && x.textContent.includes("Inspect AIA A401"));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 1000));

  // 4. Click Sign & Execute Agreement
  console.log("Clicking Sign & Execute Agreement...");
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find(x => x.textContent && x.textContent.includes("Sign & Execute"));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 1200));
  await saveScreenshots(page, "v5_08_executed_certified_modal.png");

  await browser.close();
  console.log("Verification captures complete!");
}

run().catch(console.error);
