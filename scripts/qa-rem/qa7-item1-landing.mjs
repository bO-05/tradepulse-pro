import {
  BASE_URL,
  launchBrowser,
  attachDiagnostics,
  waitForAppReady,
  getSelectorState,
  shot,
  writeLog,
  summarizeDiagnostics,
  delay,
} from "./qa1-lib.mjs";

const log = [];
const say = (s) => {
  console.log(s);
  log.push(s);
};

const results = {};
const { browser, executablePath } = await launchBrowser();
say(`QA7 ITEM 1 (default landing + tour dismissal) at ${new Date().toISOString()}`);
say(`target: ${BASE_URL}`);
say(`executable: ${executablePath}`);

const context =
  typeof browser.createBrowserContext === "function"
    ? await browser.createBrowserContext()
    : await browser.createIncognitoBrowserContext();
const page = await context.newPage();
const diag = attachDiagnostics(page);

const tourState = () =>
  page.evaluate(() => ({
    lsDismissed: window.localStorage.getItem("tradepulse.tourDismissed"),
    closeBtnPresent: Boolean(document.querySelector('button[title="Close Demo Tour"]')),
    headerTourToggle: Boolean(
      [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Demo Tour"))
    ),
    tourTextPresent: document.body.innerText.includes("Investor Demo Tour"),
  }));

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(1500);

  const sel = await getSelectorState(page);
  say(`FRESH-CONTEXT selector: value=${sel?.value} selectedText=${JSON.stringify(sel?.selectedText)}`);
  const demoSelected = Boolean(sel?.selectedText && sel.selectedText.includes("The Domain Tower B - Commercial MEP"));
  results.defaultLanding = demoSelected ? "PASS" : "FAIL";
  say(`1a default landing = demo project: ${results.defaultLanding}`);

  const before = await tourState();
  say(`tour state BEFORE dismiss: ${JSON.stringify(before)}`);
  await shot(page, "remediation-qa7-01-fresh-landing-tour-visible.png");
  results.tourVisibleOnFresh = before.closeBtnPresent || before.tourTextPresent ? "PASS" : "FAIL";
  say(`1b tour visible on fresh landing: ${results.tourVisibleOnFresh}`);

  const clicked = await page.evaluate(() => {
    const btn = document.querySelector('button[title="Close Demo Tour"]');
    if (!btn) return false;
    btn.click();
    return true;
  });
  await delay(800);
  const afterDismiss = await tourState();
  say(`tour state AFTER dismiss (clicked=${clicked}): ${JSON.stringify(afterDismiss)}`);
  results.lsAfterDismiss = afterDismiss.lsDismissed === "1" ? "PASS" : "FAIL";
  await shot(page, "remediation-qa7-01-tour-dismissed.png");

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(1500);
  const afterReload = await tourState();
  const selAfterReload = await getSelectorState(page);
  say(`AFTER RELOAD tour state: ${JSON.stringify(afterReload)}`);
  say(
    `AFTER RELOAD selector: selectedText=${JSON.stringify(selAfterReload?.selectedText)} value=${selAfterReload?.value}`
  );
  await shot(page, "remediation-qa7-01-after-reload.png");

  results.lsPersists = afterReload.lsDismissed === "1" ? "PASS" : "FAIL";
  results.tourStaysDismissed = afterReload.closeBtnPresent ? "FAIL" : "PASS";
  results.demoStillSelectedAfterReload = Boolean(
    selAfterReload?.selectedText && selAfterReload.selectedText.includes("The Domain Tower B - Commercial MEP")
  )
    ? "PASS"
    : "FAIL";

  say(`1c localStorage tradepulse.tourDismissed=1 after reload: ${results.lsPersists}`);
  say(`1d tour bar stays dismissed after reload: ${results.tourStaysDismissed}`);
  say(`1e demo project still selected after reload: ${results.demoStillSelectedAfterReload}`);

  const diagSummary = summarizeDiagnostics(diag);
  say(`diagnostics: ${JSON.stringify(diagSummary)}`);

  const overall = Object.values(results).every((v) => v === "PASS") ? "PASS" : "FAIL";
  say(`ITEM 1 RESULT: ${overall}`);
  console.log("JSON_RESULT " + JSON.stringify({ item: 1, result: overall, checks: results, diagnostics: diagSummary }));
  writeLog("remediation-qa7-01-landing-log.txt", log);
  process.exitCode = overall === "PASS" ? 0 : 1;
} catch (err) {
  say(`ERROR: ${err && err.stack ? err.stack : err}`);
  const diagSummary = summarizeDiagnostics(diag);
  say(`diagnostics at failure: ${JSON.stringify(diagSummary)}`);
  writeLog("remediation-qa7-01-landing-log.txt", log);
  process.exitCode = 1;
} finally {
  await browser.close();
}