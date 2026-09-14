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

  // 1. Click 60s Judge Dock
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find(x => x.textContent && x.textContent.includes("Judge Dock"));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "v2_09_judge_dock.png") });

  // Reload and inspect Subcontracts modal
  await page.goto("http://localhost:4173", { waitUntil: "networkidle2", timeout: 35000 });
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find(x => x.textContent && x.textContent.includes("Subcontracts"));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find(x => x.textContent && x.textContent.includes("Inspect AIA A401"));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "v2_10_subcontract_inspect.png") });

  // Test Ingest Quote modal on Leveling tab
  await page.goto("http://localhost:4173", { waitUntil: "networkidle2", timeout: 35000 });
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find(x => x.textContent && x.textContent.includes("Leveling"));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find(x => x.textContent && x.textContent.includes("Ingest Quote / PDF"));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "v2_11_ingest_quote.png") });

  await browser.close();
  console.log("Modal captures complete!");
}

run().catch(console.error);
