import { ConvexHttpClient } from "convex/browser";
import {
  BASE_URL,
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  getSelectorState,
  bodyText,
  delay,
  clickButtonByText,
  openNewProjectModal,
  fillNewProjectForm,
  submitNewProjectForm,
  readNewProjectError,
  isNewProjectModalOpen,
  summarizeDiagnostics,
  writeLog,
  writeJson,
} from "./qa4-lib.mjs";

const log = [];
const say = (s) => { console.log(s); log.push(s); };
const CLOUD = "https://brainy-skunk-440.convex.cloud";

const { browser, executablePath } = await launchBrowser();
say(`EXECUTABLE: ${executablePath}`);
say(`VAL TARGET: ${BASE_URL}`);
const page = await browser.newPage();
const diag = attachDiagnostics(page);

const stamp = Date.now();
const badTitle = `QA-REM-QA4-VAL-BAD-${stamp}`;
const wsTitleProbe = `QA-REM-QA4-VAL-WS-${stamp}`;
let result = { val: "FAIL" };

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  const client = new ConvexHttpClient(CLOUD);
  const before = await client.query("projects:listProjects", {});
  const beforeSelector = await getSelectorState(page);
  say(`BEFORE: backendProjects=${before.length} selectorOptions=${beforeSelector.options.length}`);

  // --- Case A: budget -5 / weeks 0 ---
  const openedA = await openNewProjectModal(page);
  say(`MODAL A OPEN: ${JSON.stringify(openedA)}`);
  await fillNewProjectForm(page, { title: badTitle, budget: -5, weeks: 0 });
  await delay(250);
  const submitA = await submitNewProjectForm(page);
  await delay(900);
  const errA = await readNewProjectError(page);
  const modalAOpen = await isNewProjectModalOpen(page);
  const textA = await bodyText(page);
  const shotA = await shot(page, "remediation-qa4-val-01-budget-negative-weeks-zero.png");
  const toastCreatedA = textA.includes("created successfully");
  say(`CASE A: submit=${JSON.stringify(submitA)} errorText=${JSON.stringify(errA)} modalStillOpen=${modalAOpen} createdToast=${toastCreatedA} shot=${shotA}`);

  // --- Case B: whitespace-only title ---
  await clickButtonByText(page, "Cancel", { exact: true });
  await delay(500);
  const closedAfterCancel = !(await isNewProjectModalOpen(page));
  const openedB = await openNewProjectModal(page);
  say(`MODAL B OPEN (after cancel=${closedAfterCancel}): ${JSON.stringify(openedB)}`);
  await fillNewProjectForm(page, { title: "   ", budget: 1500000, weeks: 12 });
  await delay(250);
  const submitB = await submitNewProjectForm(page);
  await delay(900);
  const errB = await readNewProjectError(page);
  const modalBOpen = await isNewProjectModalOpen(page);
  const textB = await bodyText(page);
  const shotB = await shot(page, "remediation-qa4-val-02-whitespace-title.png");
  const toastCreatedB = textB.includes("created successfully");
  say(`CASE B: submit=${JSON.stringify(submitB)} errorText=${JSON.stringify(errB)} modalStillOpen=${modalBOpen} createdToast=${toastCreatedB} shot=${shotB}`);

  await clickButtonByText(page, "Cancel", { exact: true });
  await delay(700);

  // --- Post checks: no project created in UI or backend ---
  const afterSelector = await getSelectorState(page);
  const after = await client.query("projects:listProjects", {});
  const badFound = after.find((p) => p.title === badTitle || p.title.trim() === "" && p._creationTime > Date.now() - 120000);
  const wsFound = after.find((p) => p.title === wsTitleProbe);
  const newTitles = after.filter((p) => !before.some((b) => b._id === p._id)).map((p) => ({ title: p.title, id: p._id }));
  const selectorGrew = afterSelector.options.length !== beforeSelector.options.length;
  say(`AFTER: backendProjects=${after.length} selectorOptions=${afterSelector.options.length} selectorGrew=${selectorGrew} newTitles=${JSON.stringify(newTitles)} badFound=${Boolean(badFound)} wsFound=${Boolean(wsFound)}`);

  const diagSummary = summarizeDiagnostics(diag);
  const errorAMatch = (errA || "").includes("budget") && (errA || "").includes("positive");
  const errorBMatch = (errB || "").toLowerCase().includes("title") && (errB || "").toLowerCase().includes("required");
  const pass =
    errorAMatch &&
    errorBMatch &&
    modalAOpen &&
    modalBOpen &&
    !toastCreatedA &&
    !toastCreatedB &&
    !selectorGrew &&
    newTitles.length === 0 &&
    diagSummary.pageErrors.length === 0;
  say(`DIAGNOSTICS: ${JSON.stringify(diagSummary)}`);
  result = {
    val: pass ? "PASS" : "FAIL",
    errorA: errA,
    errorB: errB,
    modalAOpen,
    modalBOpen,
    selectorGrew,
    backendDelta: newTitles,
    diagSummary,
  };
  say(`VAL RESULT: ${result.val}`);
} catch (err) {
  say(`VAL ERROR: ${err.stack || err}`);
  result = { val: "FAIL", error: String(err), diagSummary: summarizeDiagnostics(diag) };
} finally {
  const logPath = writeLog("remediation-qa4-val-log.txt", log);
  writeJson("remediation-qa4-val-result.json", result);
  say(`LOG: ${logPath}`);
  console.log("JSON_RESULT " + JSON.stringify(result));
  await browser.close();
  process.exitCode = result.val === "PASS" ? 0 : 1;
}