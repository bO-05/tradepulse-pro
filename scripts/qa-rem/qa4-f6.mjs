import { ConvexHttpClient } from "convex/browser";
import {
  BASE_URL,
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  selectProjectByTitle,
  bodyText,
  delay,
  waitForBodyText,
  clickTab,
  clickButtonByText,
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
say(`F6 TARGET: ${BASE_URL}`);
const page = await browser.newPage();
const diag = attachDiagnostics(page);

const title = `QA-REM-QA4-F6-${Date.now()}`;
say(`F6 PROJECT: ${title}`);
let result = { f6: "FAIL", title };
const HARD_LIMIT_MS = 150000;

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  const created = await createProjectViaUI(page, { title, budget: 4200000, weeks: 48 });
  say(`CREATE: ${JSON.stringify(created.waited)}`);
  await delay(700);

  const client = new ConvexHttpClient(CLOUD);
  const projects = await client.query("projects:listProjects", {});
  const proj = projects.find((p) => p.title === title);
  if (!proj) throw new Error("project not found in backend");
  result.projectId = proj._id;
  say(`BACKEND PROJECT: ${proj._id}`);

  const tab = await clickTab(page, "CSI Scoping");
  say(`PACKAGES TAB: ${JSON.stringify(tab)}`);
  await waitForBodyText(page, ["AI Spec Breakdown (Auto-Scope)"], 20000);
  await delay(500);
  const preShot = await shot(page, "remediation-qa4-f6-01-empty-project-packages-tab.png");

  const open = await clickButtonByText(page, "AI Spec Breakdown (Auto-Scope)");
  say(`SPEC MODAL OPEN: ${JSON.stringify(open)}`);
  await waitForBodyText(page, ["AI Specification Breakdown & Auto-Scoping"], 15000);
  await delay(700);
  const modalState = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll("div.fixed")];
    const dlg = dialogs.find((d) => (d.textContent || "").includes("AI Specification Breakdown & Auto-Scoping"));
    if (!dlg) return { ok: false };
    const ta = dlg.querySelector("textarea");
    const submit = [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Auto-Generate Trade Packages"));
    return { ok: true, prefilledChars: ta ? ta.value.length : 0, prefilledHead: ta ? ta.value.slice(0, 70) : null, submitDisabled: submit ? submit.disabled : null };
  });
  say(`MODAL STATE: ${JSON.stringify(modalState)}`);
  const modalShot = await shot(page, "remediation-qa4-f6-02-modal-prefilled.png");

  if (!modalState.ok || modalState.prefilledChars === 0) throw new Error("spec modal not ready/prefilled");

  const submit = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll("div.fixed")];
    const dlg = dialogs.find((d) => (d.textContent || "").includes("AI Specification Breakdown & Auto-Scoping"));
    const btn = [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Auto-Generate Trade Packages"));
    if (!btn) return { ok: false };
    btn.click();
    return { ok: true };
  });
  const t0 = Date.now();
  say(`SUBMIT: ${JSON.stringify(submit)} t0=${t0}`);

  let outcome = null;
  let outcomeMs = null;
  const pollUntil = Date.now() + 150000;
  while (Date.now() < pollUntil) {
    const text = await bodyText(page);
    if (text.includes("Successfully generated")) { outcome = "success"; outcomeMs = Date.now() - t0; break; }
    if (text.includes("Specification breakdown failed") || text.includes("could not create any valid trade packages")) { outcome = "explicit-failure"; outcomeMs = Date.now() - t0; break; }
    if (text.includes("No active project")) { outcome = "no-project"; outcomeMs = Date.now() - t0; break; }
    await delay(1000);
  }
  if (!outcome) {
    say(`NO OUTCOME WITHIN 150s; continuing observation up to +120s`);
    const extended = Date.now() + 120000;
    while (Date.now() < extended) {
      const text = await bodyText(page);
      if (text.includes("Successfully generated")) { outcome = "late-success"; outcomeMs = Date.now() - t0; break; }
      if (text.includes("Specification breakdown failed") || text.includes("could not create any valid trade packages")) { outcome = "late-failure"; outcomeMs = Date.now() - t0; break; }
      await delay(2000);
    }
  }
  const outcomeShot = await shot(page, "remediation-qa4-f6-03-outcome.png");
  const outcomeText = await bodyText(page);
  const successLine = (outcomeText.match(/Successfully generated[^\n]*/) || [])[0] ?? null;
  const errorLine = (outcomeText.match(/Specification breakdown failed[^\n]*/) || [])[0] ?? null;
  say(`OUTCOME: ${outcome} at ${outcomeMs}ms | successLine=${JSON.stringify(successLine)} | errorLine=${JSON.stringify(errorLine)} | shot=${outcomeShot}`);

  // Wait for UI package cards / modal auto-close
  await delay(3500);
  const afterCloseText = await bodyText(page);
  const pkgsBadge = (afterCloseText.match(/(\d+)\s*Pkgs/) || [])[1] ?? null;
  const packageCards = await page.evaluate(() => {
    const text = document.body.innerText;
    return ["Electrical & Lighting Systems", "HVAC Mechanical Systems", "Heating, Ventilating", "Plumbing Systems", "General Requirements"].filter((n) => text.includes(n));
  });
  say(`UI AFTER OUTCOME: pkgsBadge=${pkgsBadge} packageNamesVisible=${JSON.stringify(packageCards)}`);
  const postShot = await shot(page, "remediation-qa4-f6-04-packages-visible.png");

  // Persistence after reload
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page, 45000);
  await delay(1200);
  const sel = await selectProjectByTitle(page, title);
  const reloadWait = await waitForBodyText(page, [title, "No Trade Packages Configured"], 25000);
  await delay(1200);
  const reloadText = await bodyText(page);
  const reloadBadge = (reloadText.match(/(\d+)\s*Pkgs/) || [])[1] ?? null;
  const reloadShot = await shot(page, "remediation-qa4-f6-05-after-reload-persisted.png");
  const pkgs = await client.query("tradePackages:listByProject", { projectId: proj._id });
  say(`AFTER RELOAD: selected=${JSON.stringify(sel)} pkgsBadge=${reloadBadge} backendPackages=${pkgs.length} shot=${reloadShot}`);
  for (const p of pkgs) say(`   PKG ${p.csiDivision} | ${p.tradeName} | $${p.budgetEstimate}`);

  const diagSummary = summarizeDiagnostics(diag);
  const successWithin150 = (outcome === "success" || outcome === "late-success") && outcomeMs !== null && (outcome === "success" ? outcomeMs <= HARD_LIMIT_MS : false);
  const explicitFailureWithin150 = (outcome === "explicit-failure") && outcomeMs <= HARD_LIMIT_MS;
  const persisted = pkgs.length > 0 && reloadText.includes("Pkgs");
  const pass = (successWithin150 || explicitFailureWithin150) && (outcome === "success" ? persisted : true) && diagSummary.pageErrors.length === 0;
  // Charter: completes with generated packages OR explicit actionable failure within 150s.
  const generatedOk = successWithin150 && pkgs.length > 0;
  const passFinal = (generatedOk || explicitFailureWithin150) && diagSummary.pageErrors.length === 0;

  say(`DIAGNOSTICS: ${JSON.stringify(diagSummary)}`);
  result = {
    f6: passFinal ? "PASS" : "FAIL",
    title,
    projectId: proj._id,
    outcome,
    outcomeMs,
    within150s: outcomeMs !== null && outcomeMs <= HARD_LIMIT_MS,
    successLine,
    errorLine,
    uiPackages: pkgs.map((p) => ({ csiDivision: p.csiDivision, tradeName: p.tradeName, budget: p.budgetEstimate })),
    backendPackages: pkgs.length,
    persistedAfterReload: reloadText.includes("Pkgs") && pkgs.length > 0,
    modalState,
    diagSummary,
  };
  say(`F6 RESULT: ${result.f6} (outcome=${outcome} ms=${outcomeMs} backendPackages=${pkgs.length})`);
} catch (err) {
  say(`F6 ERROR: ${err.stack || err}`);
  result = { f6: "FAIL", title, error: String(err), diagSummary: summarizeDiagnostics(diag) };
} finally {
  const logPath = writeLog("remediation-qa4-f6-log.txt", log);
  writeJson("remediation-qa4-f6-result.json", result);
  say(`LOG: ${logPath}`);
  console.log("JSON_RESULT " + JSON.stringify(result));
  await browser.close();
  process.exitCode = result.f6 === "PASS" ? 0 : 1;
}