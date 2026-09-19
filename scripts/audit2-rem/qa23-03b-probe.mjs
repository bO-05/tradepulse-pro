/** QA23-03b probe: register metric text after void (diagnostic only). */
import { launchBrowser, attachDiagnostics, waitForAppReady, delay } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog } from "./qa23-lib.mjs";

const F = readEvidence("01-fixtures");
const V = F.void;
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function main() {
  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.goto(`${BASE}/?project=${V.id}&tab=contracts&qa23=probe`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour"));
    b?.click();
  });
  await delay(2200);
  const header = await page.evaluate(() => {
    const main = document.querySelector("main") || document.body;
    const text = main.innerText;
    const idx = text.indexOf("Execution Status Recorded");
    const metricEls = [...document.querySelectorAll("span")].filter((s) => /^\d+\s*\/\s*\d+$/.test((s.textContent || "").trim())).map((s) => s.textContent.trim());
    return {
      snippet: idx >= 0 ? text.slice(idx, idx + 80).replace(/\n/g, "\\n") : null,
      metricEls,
      hasTriangle: text.includes("Execution Status Recorded"),
    };
  });
  say(`header: ${JSON.stringify(header)}`);
  writeEvidence("03b-probe", { header, pageErrors: diag.pageErrors.slice(0, 4) });
  writeLog("03b-probe", log);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  writeLog("03b-probe-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});