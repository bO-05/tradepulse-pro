import {
  BASE_URL,
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  getSelectorState,
  selectProjectByTitle,
  setInputValue,
  clickButtonByText,
  bodyText,
  delay,
  writeLog,
  summarizeDiagnostics,
} from "./qa1-lib.mjs";

const TITLE = `QA-REM-UI-${Date.now()}`;
const log = [];
const say = (s) => {
  console.log(s);
  log.push(s);
};

const { browser, executablePath } = await launchBrowser();
say(`EXECUTABLE: ${executablePath}`);
say(`F1 TARGET: ${BASE_URL}`);
say(`F1 PROJECT TITLE: ${TITLE}`);

const page = await browser.newPage();
const diag = attachDiagnostics(page);

const steps = [];
const record = (step, observed) => {
  steps.push({ step, observed });
  say(`STEP ${steps.length}: ${step}`);
  say(`  observed: ${typeof observed === "string" ? observed : JSON.stringify(observed)}`);
};

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  const landingShot = await shot(page, "remediation-qa1-f1-01-landing.png");
  const initialSelector = await getSelectorState(page);
  record("Open live app landing; project selector visible", {
    url: page.url(),
    selectorOptions: initialSelector ? initialSelector.options.map((o) => o.text) : null,
    selected: initialSelector ? initialSelector.selectedText : null,
    screenshot: landingShot,
  });

  const clickNew = await clickButtonByText(page, "New Project");
  record('Click "New Project" button', clickNew);
  await page.waitForSelector("#new-project-title", { timeout: 10000 });
  const modalShot = await shot(page, "remediation-qa1-f1-02-create-modal.png");
  record("Create-project modal opened", { screenshot: modalShot });

  const titleInput = 'input[placeholder="e.g. Austin Innovation Tower - Phase II"]';
  const typed = await setInputValue(page, titleInput, TITLE);
  const typedShot = await shot(page, "remediation-qa1-f1-03-form-filled.png");
  record("Fill Project Title", { inputValue: typed, screenshot: typedShot });

  const submit = await clickButtonByText(page, "Create Commercial Project");
  record('Click "Create Commercial Project"', submit);

  await page.waitForFunction(
    () => document.body.innerText.includes("created successfully in Convex"),
    { timeout: 20000 }
  );
  const afterSubmitText = await bodyText(page);
  const toastLine = (afterSubmitText.match(/Project '.*?' created successfully in Convex!/) || [])[0] || null;
  const successShot = await shot(page, "remediation-qa1-f1-04-success-toast.png");
  const selectorAfterCreate = await getSelectorState(page);
  const localStorageSelection = await page.evaluate(() =>
    window.localStorage.getItem("tradepulse.selectedProjectId")
  );
  record("Success state observed", {
    toastVerbatim: toastLine,
    selectorSelected: selectorAfterCreate ? selectorAfterCreate.selectedText : null,
    localStorageSelectedProjectId: localStorageSelection,
    optionsCount: selectorAfterCreate ? selectorAfterCreate.options.length : null,
    screenshot: successShot,
  });

  await delay(5000);
  const after5sShot = await shot(page, "remediation-qa1-f1-05-after-5s.png");
  const selectorAfter5s = await getSelectorState(page);
  record("Wait ~5s; project still present?", {
    selectorOptions: selectorAfter5s.options.map((o) => o.text),
    selected: selectorAfter5s.selectedText,
    screenshot: after5sShot,
  });

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  const reloadShot = await shot(page, "remediation-qa1-f1-06-after-full-reload.png");
  const selectorAfterReload = await getSelectorState(page);
  const foundAfterReload = selectorAfterReload.options.some((o) => o.text.includes(TITLE));
  record("Full page reload; project appears in selector?", {
    foundAfterReload,
    selected: selectorAfterReload.selectedText,
    selectorOptions: selectorAfterReload.options.map((o) => o.text),
    screenshot: reloadShot,
  });

  const selectResult = await selectProjectByTitle(page, TITLE);
  await delay(1200);
  const selectorAfterSelect = await getSelectorState(page);
  const csiText = await bodyText(page);
  const emptyStateVisible = csiText.includes("No Trade Packages Configured");
  const activeShot = await shot(page, "remediation-qa1-f1-07-selected-active-empty-state.png");
  record("Explicitly select created project; confirms active", {
    selectResult,
    selectorSelected: selectorAfterSelect ? selectorAfterSelect.selectedText : null,
    csiScopingEmptyStateVisible: emptyStateVisible,
    activeTabText: csiText.includes("CSI Scoping") ? "CSI Scoping present" : "CSI Scoping missing",
    screenshot: activeShot,
  });

  const summary = summarizeDiagnostics(diag);
  record("Console diagnostics over entire flow", summary);

  const pass =
    foundAfterReload === true &&
    selectorAfterSelect &&
    selectorAfterSelect.selectedText &&
    selectorAfterSelect.selectedText.includes(TITLE) &&
    summary.consoleErrors.length === 0 &&
    summary.pageErrors.length === 0;

  say(`F1 RESULT: ${pass ? "PASS" : "FAIL"}`);
  const logPath = writeLog("remediation-qa1-f1-log.txt", log);
  say(`LOG: ${logPath}`);
  console.log("JSON_RESULT " + JSON.stringify({ f1: pass ? "PASS" : "FAIL", title: TITLE, steps, diagnostics: summary }));
} catch (err) {
  say(`F1 ERROR: ${err && err.stack ? err.stack : err}`);
  const summary = summarizeDiagnostics(diag);
  say(`DIAGNOSTICS AT FAILURE: ${JSON.stringify(summary)}`);
  const logPath = writeLog("remediation-qa1-f1-log.txt", log);
  say(`LOG: ${logPath}`);
  console.log(
    "JSON_RESULT " + JSON.stringify({ f1: "FAIL", title: TITLE, steps, diagnostics: summary, error: String(err) })
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}