import {
  BASE_URL,
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  getSelectorState,
  selectProjectByTitle,
  bodyText,
  delay,
  waitForBodyText,
  summarizeDiagnostics,
  writeLog,
  writeJson,
} from "./qa4-lib.mjs";

const log = [];
const say = (s) => { console.log(s); log.push(s); };

const { browser, executablePath } = await launchBrowser();
say(`EXECUTABLE: ${executablePath}`);
say(`SEL TARGET: ${BASE_URL}`);
const page = await browser.newPage();
const diag = attachDiagnostics(page);

const candidates = ["QA-REM-QA4-F1-", "QA-REM-QA4-F2-"];
let result = { sel: "FAIL" };

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  const initial = await getSelectorState(page);
  say(`INITIAL: selected=${initial.selectedText} count=${initial.options.length} firstOption=${initial.options[0]?.text}`);
  const newest = initial.options[0]?.text ?? null;

  const checks = [];
  for (const prefix of candidates) {
    const opt = initial.options.find((o) => o.text.startsWith(prefix));
    if (!opt) { say(`SKIP: no option for ${prefix}`); continue; }
    const sel = await selectProjectByTitle(page, prefix);
    await waitForBodyText(page, [prefix], 15000);
    await delay(900);
    const beforeReload = await getSelectorState(page);
    const storedBefore = await page.evaluate(() => window.localStorage.getItem("tradepulse.selectedProjectId"));
    say(`SELECTED ${opt.text} -> state=${beforeReload.selectedText} localStorage=${storedBefore}`);

    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page, 45000);
    await delay(1500);
    const afterReload = await getSelectorState(page);
    const storedAfter = await page.evaluate(() => window.localStorage.getItem("tradepulse.selectedProjectId"));
    const shotPath = await shot(page, `remediation-qa4-sel-01-after-reload-${prefix.replace(/[^A-Za-z0-9]/g, "")}.png`);
    const same = (afterReload.selectedText || "").startsWith(prefix) && afterReload.value === storedAfter;
    const notNewest = afterReload.value !== initial.options[0]?.value;
    say(`AFTER RELOAD ${prefix}: selected=${afterReload.selectedText} value=${afterReload.value} localStorage=${storedAfter} sameProject=${same} notNewest=${notNewest} shot=${shotPath}`);
    checks.push({ prefix, expected: opt.text, selectedBefore: beforeReload.selectedText, selectedAfter: afterReload.selectedText, valueAfter: afterReload.value, storedAfter, same, notNewest, screenshot: shotPath });
  }

  const diagSummary = summarizeDiagnostics(diag);
  const pass = checks.length >= 1 && checks.every((c) => c.same && c.notNewest) && diagSummary.pageErrors.length === 0;
  say(`DIAGNOSTICS: ${JSON.stringify(diagSummary)}`);
  result = { sel: pass ? "PASS" : "FAIL", newestOption: newest, checks, diagSummary };
  say(`SEL RESULT: ${result.sel}`);
} catch (err) {
  say(`SEL ERROR: ${err.stack || err}`);
  result = { sel: "FAIL", error: String(err), diagSummary: summarizeDiagnostics(diag) };
} finally {
  const logPath = writeLog("remediation-qa4-sel-log.txt", log);
  writeJson("remediation-qa4-sel-result.json", result);
  say(`LOG: ${logPath}`);
  console.log("JSON_RESULT " + JSON.stringify(result));
  await browser.close();
  process.exitCode = result.sel === "PASS" ? 0 : 1;
}