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
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "test_current_view.png"), fullPage: false });
  console.log("Successfully captured test_current_view.png");
  await browser.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
