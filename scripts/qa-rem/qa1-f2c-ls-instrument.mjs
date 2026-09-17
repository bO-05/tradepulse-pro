import {
  BASE_URL,
  launchBrowser,
  attachDiagnostics,
  waitForAppReady,
  getSelectorState,
  selectProjectByTitle,
  delay,
  writeLog,
} from "./qa1-lib.mjs";

const TARGET = "QA-REM-UI-1789553872292";
const log = [];
const say = (s) => {
  console.log(s);
  log.push(s);
};

const { browser, executablePath } = await launchBrowser();
say(`EXECUTABLE: ${executablePath}`);
say(`F2c TARGET: ${BASE_URL}`);

const page = await browser.newPage();
const diag = attachDiagnostics(page);

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);

  await selectProjectByTitle(page, TARGET);
  await delay(2000);
  const before = await page.evaluate(() => ({
    ls: window.localStorage.getItem("tradepulse.selectedProjectId"),
    sel: document.querySelector('select[aria-label="Select Commercial Construction Project"]').selectedOptions[0]?.textContent?.trim(),
  }));
  say(`BEFORE RELOAD: ${JSON.stringify(before)}`);

  await page.evaluateOnNewDocument(() => {
    window.__lsLog = [];
    const origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      window.__lsLog.push({ at: Date.now(), op: "setItem", k, v: String(v).slice(0, 60) });
      return origSet.call(this, k, v);
    };
    const origRemove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (k) {
      window.__lsLog.push({ at: Date.now(), op: "removeItem", k });
      return origRemove.call(this, k);
    };
    window.__bootReadAt = Date.now();
    window.__bootSelectedProjectId = window.localStorage.getItem("tradepulse.selectedProjectId");
    window.__bootAllKeys = Object.keys(window.localStorage);
  });

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  const afterDom = await page.evaluate(() => ({
    url: location.href,
    bootReadAt: window.__bootReadAt,
    bootSelectedProjectId: window.__bootSelectedProjectId,
    bootAllKeys: window.__bootAllKeys,
    lsNow: window.localStorage.getItem("tradepulse.selectedProjectId"),
    log: window.__lsLog,
  }));
  say(`AFTER DOMCONTENTLOADED: ${JSON.stringify(afterDom)}`);

  await waitForAppReady(page);
  await delay(1500);
  const afterReady = await page.evaluate(() => ({
    url: location.href,
    ls: window.localStorage.getItem("tradepulse.selectedProjectId"),
    sel: document.querySelector('select[aria-label="Select Commercial Construction Project"]').selectedOptions[0]?.textContent?.trim(),
    log: window.__lsLog,
    bootReadAt: window.__bootReadAt,
    bootSelectedProjectId: window.__bootSelectedProjectId,
  }));
  say(`AFTER APP READY: ${JSON.stringify(afterReady)}`);

  const summary = { consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text) };
  say(`DIAGNOSTICS: ${JSON.stringify(summary)}`);
  const logPath = writeLog("remediation-qa1-f2c-log.txt", log);
  say(`LOG: ${logPath}`);
} catch (err) {
  say(`ERROR: ${err && err.stack ? err.stack : err}`);
  writeLog("remediation-qa1-f2c-log.txt", log);
  process.exitCode = 1;
} finally {
  await browser.close();
}