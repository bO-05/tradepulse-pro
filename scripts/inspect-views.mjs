import { createRequire } from "module";
const require = createRequire("d:/Repo/ALL HACKATHONS/Convex/Convex all gas/package.json");
const puppeteer = require("puppeteer-core");
import path from "path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ARTIFACT_DIR = "C:\\Users\\user\\.gemini\\antigravity\\brain\\5aee1193-d7e9-458c-a44a-5bbb9aa83068";

async function run() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--window-size=1440,900"],
    defaultViewport: { width: 1440, height: 900 },
  });

  const page = await browser.newPage();
  await page.goto("http://localhost:4173", { waitUntil: "networkidle2", timeout: 35000 });
  await new Promise((r) => setTimeout(r, 2000));

  // 1. Leveling Spread Table View
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find(x => x.textContent && x.textContent.includes("Bid Leveling"));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find(x => x.textContent && x.textContent.includes("Spread Table View"));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "v3_01_leveling_table.png") });

  // 2. Adjust Leveling Modal
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find(x => x.textContent && x.textContent.includes("Adjust Leveling") || (x.title && x.title.includes("Adjust Scope")));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "v3_02_adjust_modal.png") });

  // 3. Close modal & Expand KPI bar
  await page.evaluate(() => {
    const closeBtn = document.querySelector("div[class*='fixed'] button[class*='text-slate']");
    if (closeBtn) closeBtn.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find(x => x.textContent && x.textContent.includes("Expand 6-Card KPI View"));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "v3_03_expanded_kpi.png") });

  // 4. Scoping Spec Breakdown Modal
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find(x => x.textContent && x.textContent.includes("CSI Scoping"));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find(x => x.textContent && x.textContent.includes("AI Spec Breakdown"));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "v3_04_spec_breakdown_modal.png") });

  console.log("Inspection screenshots saved!");
  await browser.close();
}

run().catch(console.error);
