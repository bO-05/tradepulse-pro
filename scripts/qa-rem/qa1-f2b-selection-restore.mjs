import {
  BASE_URL,
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  getSelectorState,
  selectProjectByTitle,
  delay,
  writeLog,
  summarizeDiagnostics,
} from "./qa1-lib.mjs";

const DEMO_TITLE = "The Domain Tower B";
const TARGET = "QA-REM-UI-1789553872292";
const log = [];
const say = (s) => {
  console.log(s);
  log.push(s);
};

const { browser, executablePath } = await launchBrowser();
say(`EXECUTABLE: ${executablePath}`);
say(`F2b TARGET: ${BASE_URL}`);

const page = await browser.newPage();
const diag = attachDiagnostics(page);

const state = async (label) => {
  const sel = await getSelectorState(page);
  const ls = await page.evaluate(() => ({
    projectId: window.localStorage.getItem("tradepulse.selectedProjectId"),
    packageId: window.localStorage.getItem("tradepulse.selectedPackageId"),
  }));
  const s = { label, selectedText: sel ? sel.selectedText : null, options: sel ? sel.options.map((o) => o.text) : null, localStorage: ls };
  say(`STATE ${label}: ${JSON.stringify(s)}`);
  return s;
};

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await state("initial-boot");

  await selectProjectByTitle(page, DEMO_TITLE);
  await delay(1500);
  await state("after-select-demo");

  await selectProjectByTitle(page, TARGET);
  await delay(2500);
  await state("after-select-target");
  await shot(page, "remediation-qa1-f2b-01-target-before-reload.png");

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(1500);
  await state("after-reload-1");
  await shot(page, "remediation-qa1-f2b-02-after-reload.png");

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(1500);
  await state("after-reload-2");

  await selectProjectByTitle(page, TARGET);
  await delay(1200);
  await state("re-select-target");
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(1500);
  await state("after-reload-3");

  const summary = summarizeDiagnostics(diag);
  say(`DIAGNOSTICS: ${JSON.stringify(summary)}`);
  const logPath = writeLog("remediation-qa1-f2b-log.txt", log);
  say(`LOG: ${logPath}`);
} catch (err) {
  say(`ERROR: ${err && err.stack ? err.stack : err}`);
  writeLog("remediation-qa1-f2b-log.txt", log);
  process.exitCode = 1;
} finally {
  await browser.close();
}