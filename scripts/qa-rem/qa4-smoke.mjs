import {
  BASE_URL,
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  getSelectorState,
  bodyText,
  summarizeDiagnostics,
  writeLog,
} from "./qa1-lib.mjs";

const log = [];
const say = (s) => { console.log(s); log.push(s); };

const { browser, executablePath } = await launchBrowser();
say(`EXECUTABLE: ${executablePath}`);
say(`BASE: ${BASE_URL}`);
const page = await browser.newPage();
const diag = attachDiagnostics(page);

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  const sel = await getSelectorState(page);
  const text = await bodyText(page);
  const p = await shot(page, "remediation-qa4-smoke-01-landing.png");
  say(`SELECTOR: ${JSON.stringify({ selected: sel.selectedText, count: sel.options.length })}`);
  say(`PROJECT OPTION SAMPLE: ${JSON.stringify(sel.options.slice(0, 25).map((o) => o.text))}`);
  say(`BODY HAS QUICKSTART: ${text.includes("Quickstart")} | has AI Spec Breakdown: ${text.includes("AI Spec Breakdown")} | has Judge Dock: ${text.includes("Judge Dock")}`);
  const buttons = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 80));
  say(`BUTTONS: ${JSON.stringify(buttons)}`);
  say(`SCREENSHOT: ${p}`);
  say(`DIAG: ${JSON.stringify(summarizeDiagnostics(diag))}`);
} catch (e) {
  say(`SMOKE ERROR: ${e.stack || e}`);
  say(`DIAG AT FAILURE: ${JSON.stringify(summarizeDiagnostics(diag))}`);
} finally {
  writeLog("remediation-qa4-smoke-log.txt", log);
  await browser.close();
}