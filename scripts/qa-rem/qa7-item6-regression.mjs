import fs from "node:fs";
import path from "node:path";
import {
  BASE_URL,
  EVIDENCE_DIR,
  launchBrowser,
  attachDiagnostics,
  waitForAppReady,
  getSelectorState,
  selectProjectByTitle,
  clickButtonByText,
  bodyText,
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
const DEMO_TITLE = "The Domain Tower B";
const FORBIDDEN = [
  "Electrical & Lighting Systems",
  "Heating, Ventilating & Air Conditioning",
  "Plumbing & Domestic Water Systems",
];
const TABS = [
  "CSI Scoping",
  "Discovery",
  "Pre-Bid Q&A",
  "Bid Leveling",
  "Scope Clash",
  "Subcontracts",
  "Live Activity Audit",
  "Evals & Architecture",
];

const { browser, executablePath } = await launchBrowser();
say(`QA7 ITEM 6 (regression smoke) at ${new Date().toISOString()}`);
say(`target: ${BASE_URL}`);
say(`executable: ${executablePath}`);

const context =
  typeof browser.createBrowserContext === "function"
    ? await browser.createBrowserContext()
    : await browser.createIncognitoBrowserContext();
const page = await context.newPage();
const diag = attachDiagnostics(page);

const fillByLabel = (labelText, value) =>
  page.evaluate(
    (labelNeedle, val) => {
      const labels = [...document.querySelectorAll("label")];
      const lab = labels.find((l) => (l.textContent || "").trim().startsWith(labelNeedle));
      if (!lab) return { ok: false, reason: "label not found", labels: labels.map((l) => l.textContent.trim()).slice(0, 30) };
      const container = lab.parentElement;
      const el = container.querySelector("input, textarea, select");
      if (!el) return { ok: false, reason: "field not found in label container" };
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, tag: el.tagName, value: el.value };
    },
    labelText,
    value
  );

const clickHeaderTab = (label) =>
  page.evaluate((needle) => {
    const header = document.querySelector("header");
    if (!header) return { ok: false, reason: "header not found" };
    const btn = [...header.querySelectorAll("button")].find((b) => (b.textContent || "").includes(needle));
    if (!btn) return { ok: false, reason: "header tab button not found" };
    btn.click();
    return { ok: true, text: (btn.textContent || "").trim() };
  }, label);

let newProject = null;
try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(1200);

  // ---- 6a. project create via UI ----
  const title = `QA-REM-R3-${Date.now()}`;
  const opened = await clickButtonByText(page, "New Project");
  say(`click New Project -> ${JSON.stringify(opened)}`);
  await delay(600);
  const modalOpen = await page.evaluate(() => document.body.innerText.includes("Create New Construction Project"));
  say(`new project modal open: ${modalOpen}`);
  await shot(page, "remediation-qa7-06-01-new-project-modal.png");

  const fills = {
    title: await fillByLabel("Project Title", title),
    location: await fillByLabel("Location", "Austin, TX"),
    type: await fillByLabel("Project Type", "QA Regression Fixture"),
    gc: await fillByLabel("General Contractor", "QA Verification GC, LLC"),
    budget: await fillByLabel("Estimated Budget", "3000000"),
    weeks: await fillByLabel("Duration", "40"),
    spec: await fillByLabel("Specification Summary", "QA round 3 regression fixture project."),
  };
  say(`form fills: ${JSON.stringify(fills)}`);
  await shot(page, "remediation-qa7-06-02-new-project-filled.png");

  const created = await clickButtonByText(page, "Create Commercial Project");
  say(`click Create Commercial Project -> ${JSON.stringify(created)}`);
  await page.waitForFunction(() => document.body.innerText.includes("created successfully"), { timeout: 30000 });
  await delay(800);
  const selAfterCreate = await getSelectorState(page);
  const newId = selAfterCreate?.value;
  newProject = { title, id: newId, createdAt: new Date().toISOString() };
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "remediation-qa7-fixtures.json"),
    JSON.stringify({ project: newProject }, null, 2),
    "utf8"
  );
  results.projectCreated = selAfterCreate?.selectedText?.includes(title) ? "PASS" : "FAIL";
  say(`6a project created + auto-selected: ${results.projectCreated} (id=${newId}, text=${selAfterCreate?.selectedText})`);
  await shot(page, "remediation-qa7-06-03-project-created.png");

  // ---- 6b. reload persistence ----
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(1500);
  const selAfterReload = await getSelectorState(page);
  results.reloadPersists = selAfterReload?.value === newId ? "PASS" : "FAIL";
  say(`6b selected project after reload: ${JSON.stringify(selAfterReload?.selectedText)} -> ${results.reloadPersists}`);
  const lsSelected = await page.evaluate(() => window.localStorage.getItem("tradepulse.selectedProjectId"));
  say(`localStorage tradepulse.selectedProjectId=${lsSelected}`);
  await shot(page, "remediation-qa7-06-04-reload-persists.png");

  // ---- 6c. F2 demo-data flash on switch to fresh QA-REM project ----
  const samples = [];
  const sample = async (label, filename, t0) => {
    const text = await bodyText(page);
    const p = await shot(page, filename);
    const s = {
      label,
      ms: Date.now() - t0,
      forbiddenHits: FORBIDDEN.filter((f) => text.includes(f)),
      emptyStateVisible: text.includes("No Trade Packages Configured"),
      bootLoaderVisible: text.includes("Connecting to Convex reactive backend"),
      screenshot: p,
    };
    samples.push(s);
    say(
      `  SAMPLE ${label} t+${s.ms}ms forbidden=${JSON.stringify(s.forbiddenHits)} emptyState=${s.emptyStateVisible} bootLoader=${s.bootLoaderVisible} | ${p}`
    );
    return s;
  };

  const pickDemo = await selectProjectByTitle(page, DEMO_TITLE);
  say(`select demo project -> ${JSON.stringify(pickDemo)}`);
  await page.waitForFunction((names) => names.some((n) => document.body.innerText.includes(n)), { timeout: 30000 }, FORBIDDEN);
  await delay(500);
  await shot(page, "remediation-qa7-06-05-demo-packages-loaded.png");

  const t0 = Date.now();
  const switchRes = await selectProjectByTitle(page, title);
  say(`switch demo -> QA-REM at t0: ${JSON.stringify(switchRes)}`);
  await sample("switch @0ms", "remediation-qa7-06-06-switch-immediate.png", t0);
  await delay(300);
  await sample("switch @300ms", "remediation-qa7-06-07-switch-300ms.png", t0);
  await delay(400);
  await sample("switch @700ms", "remediation-qa7-06-08-switch-700ms.png", t0);
  await delay(500);
  await sample("switch @1200ms", "remediation-qa7-06-09-switch-1200ms.png", t0);
  await delay(1800);
  await sample("switch @3000ms", "remediation-qa7-06-10-switch-3000ms.png", t0);

  const anyForbidden = samples.some((s) => s.forbiddenHits.length > 0);
  results.noDemoFlashOnSwitch = anyForbidden ? "FAIL" : "PASS";
  say(`6c F2 no demo-data flash: ${results.noDemoFlashOnSwitch} (forbidden hits: ${samples.flatMap((s) => s.forbiddenHits).join(", ") || "none"})`);

  // reload burst on fresh project
  const t1 = Date.now();
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await sample("reload @0ms", "remediation-qa7-06-11-reload-immediate.png", t1);
  await delay(500);
  await sample("reload @500ms", "remediation-qa7-06-12-reload-500ms.png", t1);
  await delay(1000);
  await sample("reload @1500ms", "remediation-qa7-06-13-reload-1500ms.png", t1);
  await waitForAppReady(page);
  await delay(1200);
  await sample("reload @settled", "remediation-qa7-06-14-reload-settled.png", Date.now());
  const reloadForbidden = samples.some((s) => s.label.startsWith("reload") && s.forbiddenHits.length > 0);
  results.noDemoFlashOnReload = reloadForbidden ? "FAIL" : "PASS";
  const selAfterReload2 = await getSelectorState(page);
  results.selectionSurvivesReload = selAfterReload2?.value === newId ? "PASS" : "FAIL";
  say(
    `6c-2 reload on QA-REM: flash=${results.noDemoFlashOnReload} selection=${selAfterReload2?.selectedText} survives=${results.selectionSurvivesReload}`
  );

  // ---- 6d. tab render smoke ----
  say("TAB SMOKE: clicking every pipeline + utility tab on fresh QA-REM project");
  const tabReports = [];
  for (const label of TABS) {
    const before = diag.consoleLogs.length;
    const res = await clickHeaderTab(label);
    await delay(700);
    const text = await bodyText(page);
    const errsSince = diag.consoleLogs.slice(before).filter((l) => l.type === "error");
    tabReports.push({
      label,
      click: res,
      consoleErrorsSince: errsSince.map((e) => e.text),
      bodyHasLabel: text.includes(label.split(" ")[0]),
      shot: await shot(page, `remediation-qa7-06-tab-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`),
    });
    say(`  TAB ${label}: click=${res.ok} errorsSince=${JSON.stringify(errsSince.map((e) => e.text))}`);
  }

  const diagSummary = summarizeDiagnostics(diag);
  const tabErrors = tabReports.flatMap((t) => t.consoleErrorsSince);
  results.tabsZeroConsoleErrors = diagSummary.consoleErrors.length === 0 && diagSummary.pageErrors.length === 0 ? "PASS" : "FAIL";
  results.tabsZeroFailedRequests = diagSummary.failedRequests.length === 0 ? "PASS" : "FAIL";
  say(`6d diagnostics: ${JSON.stringify(diagSummary)}`);
  say(`6d tabErrors: ${JSON.stringify(tabErrors)}`);

  const overall = Object.values(results).every((v) => v === "PASS") ? "PASS" : "FAIL";
  say(`ITEM 6 RESULT: ${overall}`);
  say(`CHECKS: ${JSON.stringify(results)}`);
  console.log(
    "JSON_RESULT " +
      JSON.stringify({ item: 6, result: overall, checks: results, newProject, tabReports, diagnostics: diagSummary })
  );
  writeLog("remediation-qa7-06-regression-log.txt", log);
  process.exitCode = overall === "PASS" ? 0 : 1;
} catch (err) {
  say(`ERROR: ${err && err.stack ? err.stack : err}`);
  const diagSummary = summarizeDiagnostics(diag);
  say(`diagnostics at failure: ${JSON.stringify(diagSummary)}`);
  console.log("JSON_RESULT " + JSON.stringify({ item: 6, result: "FAIL", error: String(err), checks: results, newProject, diagnostics: diagSummary }));
  writeLog("remediation-qa7-06-regression-log.txt", log);
  process.exitCode = 1;
} finally {
  await browser.close();
}