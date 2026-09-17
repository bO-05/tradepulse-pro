import { ConvexHttpClient } from "convex/browser";
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
  createProjectViaUI,
  summarizeDiagnostics,
  writeLog,
  writeJson,
} from "./qa4-lib.mjs";

const log = [];
const say = (s) => { console.log(s); log.push(s); };
const CLOUD = "https://brainy-skunk-440.convex.cloud";

const { browser, executablePath } = await launchBrowser();
say(`EXECUTABLE: ${executablePath}`);
say(`F1 TARGET: ${BASE_URL}`);
const page = await browser.newPage();
const diag = attachDiagnostics(page);

const title = `QA-REM-QA4-F1-${Date.now()}`;
say(`F1 NEW PROJECT TITLE: ${title}`);
let result = { f1: "FAIL" };

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  const before = await getSelectorState(page);
  say(`SELECTOR BEFORE: count=${before.options.length} selected=${before.selectedText}`);

  const created = await createProjectViaUI(page, { title, budget: 3100000, weeks: 34 });
  say(`CREATE RESULT: ${JSON.stringify(created)}`);
  const p1 = await shot(page, "remediation-qa4-f1-01-created-toast.png");
  say(`SHOT AFTER CREATE: ${p1}`);

  await waitForBodyText(page, [title], 15000);
  await delay(1200);
  const afterCreate = await getSelectorState(page);
  const inSelectorBeforeReload = afterCreate.options.some((o) => o.text.includes(title));
  say(`SELECTOR AFTER CREATE: count=${afterCreate.options.length} selected=${afterCreate.selectedText} containsNew=${inSelectorBeforeReload}`);

  // Full reload
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page, 45000);
  await delay(1500);
  const afterReload = await getSelectorState(page);
  const presentAfterReload = afterReload.options.some((o) => o.text.includes(title));
  const selectedAfterReload = (afterReload.selectedText || "").includes(title);
  say(`SELECTOR AFTER RELOAD: count=${afterReload.options.length} selected=${afterReload.selectedText} containsNew=${presentAfterReload} newSelected=${selectedAfterReload}`);
  const p2 = await shot(page, "remediation-qa4-f1-02-after-full-reload.png");
  say(`SHOT AFTER RELOAD: ${p2}`);

  // Explicitly select it (must be selectable) and verify its view renders empty state
  const sel = await selectProjectByTitle(page, title);
  say(`EXPLICIT SELECT: ${JSON.stringify(sel)}`);
  const waitEmpty = await waitForBodyText(page, ["No Trade Packages Configured", title], 20000);
  await delay(1000);
  const postSelectState = await getSelectorState(page);
  const text = await bodyText(page);
  const p3 = await shot(page, "remediation-qa4-f1-03-selected-empty-state.png");
  say(`POST-SELECT: selected=${postSelectState.selectedText} emptyState=${text.includes("No Trade Packages Configured")} shot=${p3}`);

  // Backend confirmation
  const client = new ConvexHttpClient(CLOUD);
  const projects = await client.query("projects:listProjects", {});
  const match = projects.find((p) => p.title === title);
  let pkgCount = -1;
  if (match) {
    const pkgs = await client.query("tradePackages:listByProject", { projectId: match._id });
    pkgCount = pkgs.length;
  }
  say(`BACKEND: found=${Boolean(match)} id=${match?._id} packages=${pkgCount} demo=${match?.isDemoProject}`);

  const diagSummary = summarizeDiagnostics(diag);
  say(`DIAGNOSTICS: ${JSON.stringify(diagSummary)}`);

  const pass =
    created.waited.hit === "created successfully in Convex" &&
    inSelectorBeforeReload &&
    presentAfterReload &&
    sel.ok &&
    text.includes("No Trade Packages Configured") &&
    Boolean(match) &&
    match.isDemoProject === false &&
    pkgCount === 0 &&
    diagSummary.pageErrors.length === 0;
  result = { f1: pass ? "PASS" : "FAIL", title, projectId: match?._id, pid: match?._id, pkgCount, diagSummary };
  say(`F1 RESULT: ${pass ? "PASS" : "FAIL"}`);
} catch (err) {
  say(`F1 ERROR: ${err.stack || err}`);
  say(`DIAG AT FAILURE: ${JSON.stringify(summarizeDiagnostics(diag))}`);
  result = { f1: "FAIL", title, error: String(err), diagSummary: summarizeDiagnostics(diag) };
} finally {
  const logPath = writeLog("remediation-qa4-f1-log.txt", log);
  writeJson("remediation-qa4-f1-result.json", result);
  say(`LOG: ${logPath}`);
  console.log("JSON_RESULT " + JSON.stringify(result));
  await browser.close();
  process.exitCode = result.f1 === "PASS" ? 0 : 1;
}