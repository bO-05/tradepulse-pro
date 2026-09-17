import fs from "node:fs";
import path from "node:path";
import {
  BASE_URL,
  EVIDENCE_DIR,
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  getSelectorState,
  selectProjectByTitle,
  bodyText,
  delay,
} from "./qa1-lib.mjs";
import {
  makeLog,
  saveState,
  dismissDemoTour,
  clickStage,
  clickVisibleButton,
  setFieldByLabel,
  getToast,
  waitFor,
  readPackageCard,
} from "./qa5-lib.mjs";

const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
const PROJECT_TITLE = `QA-REM-QA5-E2E-${stamp}`;
const { say, write } = makeLog("remediation-qa5-part1-log.txt");

say(`=== QA-5 PART 1 (Rows 1-3: project, CSI package, AI breakdown) ===`);
say(`SITE: ${BASE_URL}`);
say(`UTC START: ${new Date().toISOString()}`);
say(`PROJECT TITLE: ${PROJECT_TITLE}`);

const consoleEvents = [];
const pageErrors = [];
const failedRequests = [];
const httpErrors = [];
let phase = "boot";
const rowEvents = { row1: [], row2: [], row3: [] };
let currentRow = "row1";
let lastConsole = 0;
let lastPageErr = 0;
let lastFailed = 0;
let lastHttp = 0;
const snapshotRow = () => {
  const slice = consoleEvents.slice(lastConsole).filter((e) => e.type === "error");
  const pages = pageErrors.slice(lastPageErr);
  const failed = failedRequests.slice(lastFailed);
  const http = httpErrors.slice(lastHttp);
  lastConsole = consoleEvents.length;
  lastPageErr = pageErrors.length;
  lastFailed = failedRequests.length;
  lastHttp = httpErrors.length;
  return { consoleErrors: slice, pageErrors: pages, failedRequests: failed, httpErrors: http };
};

const { browser, executablePath } = await launchBrowser();
say(`EXECUTABLE: ${executablePath}`);

const page = await browser.newPage();
page.on("console", (m) => consoleEvents.push({ type: m.type(), text: m.text(), at: Date.now() }));
page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));
page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${r.url()} :: ${r.failure() ? r.failure().errorText : "?"}`));
page.on("response", (res) => {
  if (res.status() >= 400) httpErrors.push(`${res.request().method()} ${res.url()} -> ${res.status()}`);
});

const results = {};
const record = (row, step, observed) => {
  rowEvents[row].push({ step, observed });
  say(`[${row}] STEP: ${step}`);
  say(`[${row}]   observed: ${typeof observed === "string" ? observed : JSON.stringify(observed)}`);
};

try {
  phase = "landing";
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  const dismissed = await dismissDemoTour(page);
  say(`LANDING ready; demo tour dismissed=${dismissed}`);
  await shot(page, "remediation-qa5-p1-01-landing.png");

  // ================= ROW 1: project create + reload persistence =================
  currentRow = "row1";
  const initialSelector = await getSelectorState(page);
  record("row1", "initial selector state", {
    selected: initialSelector ? initialSelector.selectedText : null,
    optionsCount: initialSelector ? initialSelector.options.length : null,
  });

  const openNew = await clickVisibleButton(page, "New Project", { exact: true });
  record("row1", "click New Project", openNew);
  const modalOpen = await waitFor(page, () => Boolean(document.querySelector("#new-project-title")), 10000, 300);
  record("row1", "create-project modal visible", modalOpen);

  const fillTitle = await setFieldByLabel(page, "Project Title", PROJECT_TITLE);
  const fillLoc = await setFieldByLabel(page, "Location", "Austin, TX");
  const fillType = await setFieldByLabel(page, "Project Type", "QA Lifecycle Verification");
  const fillGC = await setFieldByLabel(page, "General Contractor", "QA5 GC Partners, LP");
  const fillBudget = await setFieldByLabel(page, "Estimated Budget", "800000");
  const fillWeeks = await setFieldByLabel(page, "Duration (Weeks)", "24");
  const fillSpec = await setFieldByLabel(page, "Specification Summary", "QA-5 E2E lifecycle project. Div 03 concrete structural scope; MEP divisions to be scoped from spec breakdown.");
  record("row1", "form filled", { fillTitle, fillLoc, fillType, fillGC, fillBudget, fillWeeks, fillSpec });
  await shot(page, "remediation-qa5-p1-02-new-project-filled.png");

  const submitted = await clickVisibleButton(page, "Create Commercial Project");
  record("row1", "submit Create Commercial Project", submitted);
  const toastWait = await waitFor(page, () => {
    const t = document.body.innerText;
    const m = t.match(/Project '.*?' created successfully in Convex!/);
    return m ? m[0] : null;
  }, 30000, 500);
  record("row1", "success toast observed", toastWait);

  await delay(4000);
  const selAfterCreate = await getSelectorState(page);
  const lsAfterCreate = await page.evaluate(() => localStorage.getItem("tradepulse.selectedProjectId"));
  const foundAfterCreate = selAfterCreate ? selAfterCreate.options.some((o) => o.text.includes(PROJECT_TITLE)) : false;
  record("row1", "selector ~4s after create", {
    foundInOptions: foundAfterCreate,
    selected: selAfterCreate ? selAfterCreate.selectedText : null,
    localStorageProjectId: lsAfterCreate,
  });
  await shot(page, "remediation-qa5-p1-03-row1-created.png");

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await dismissDemoTour(page);
  const selAfterReload = await getSelectorState(page);
  const foundAfterReload = selAfterReload ? selAfterReload.options.some((o) => o.text.includes(PROJECT_TITLE)) : false;
  const selectedAfterReload = selAfterReload && selAfterReload.selectedText ? selAfterReload.selectedText.includes(PROJECT_TITLE) : false;
  record("row1", "after FULL RELOAD", {
    foundInOptions: foundAfterReload,
    selectedIsOurProject: selectedAfterReload,
    selected: selAfterReload ? selAfterReload.selectedText : null,
  });
  await shot(page, "remediation-qa5-p1-04-row1-after-reload.png");

  let reselected = null;
  if (!selectedAfterReload) {
    reselected = await selectProjectByTitle(page, PROJECT_TITLE);
    await delay(1500);
    record("row1", "explicitly reselected ours (selection did not survive reload)", reselected);
  }
  const lsAfterReload = await page.evaluate(() => localStorage.getItem("tradepulse.selectedProjectId"));
  results.row1 = {
    status: toastWait.ok && foundAfterReload ? (selectedAfterReload ? "PASS" : "PARTIAL (project persists, selection resets)") : "FAIL",
    toast: toastWait.value,
    foundAfterCreate,
    foundAfterReload,
    selectedAfterReload,
    localStorageProjectId: lsAfterReload,
  };
  record("row1", "ROW 1 VERDICT", results.row1);

  // ================= ROW 2: CSI package create + validation =================
  currentRow = "row2";
  await clickStage(page, "CSI Scoping");
  await waitFor(page, () => document.body.innerText.includes("Create Trade Package"), 15000, 500);
  await shot(page, "remediation-qa5-p1-05-row2-packages-tab.png");

  const openPkg = await clickVisibleButton(page, "Create Trade Package");
  record("row2", "open Create Trade Package modal", openPkg);
  await waitFor(page, () => document.body.innerText.includes("Create CSI Trade Package"), 8000, 300);

  const deadline = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const pkgFill = {
    csi: await setFieldByLabel(page, "CSI Division Number", "03 30 00"),
    name: await setFieldByLabel(page, "Trade Package Name", "QA5 Concrete Structural"),
    budget: await setFieldByLabel(page, "Budget Estimate", "450000"),
    scope: await setFieldByLabel(page, "Scope Summary", "Cast-in-place concrete foundations, elevated slabs, and structural framing including formwork, rebar, and pumping."),
    inclusions: await setFieldByLabel(page, "Mandatory Inclusions", "Structural formwork and shoring\nGrade 60 deformed rebar reinforcing\nConcrete pump truck and placement finishing"),
    deadline: await setFieldByLabel(page, "Bid Deadline", deadline),
  };
  record("row2", "package modal filled (valid)", { ...pkgFill, deadline });
  await shot(page, "remediation-qa5-p1-06-row2-package-modal.png");

  await clickVisibleButton(page, "Create Package");
  const pkgWait = await waitFor(
    page,
    () => document.body.innerText.includes("03 30 00") && !document.body.innerText.includes("Create CSI Trade Package"),
    25000,
    500
  );
  record("row2", "package created & modal closed", pkgWait);
  const cardText = await readPackageCard(page, "03 30 00");
  record("row2", "package card text after create", cardText ? cardText.slice(0, 700) : null);
  await shot(page, "remediation-qa5-p1-07-row2-package-created.png");

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await dismissDemoTour(page);
  const selNow = await getSelectorState(page);
  if (!(selNow && selNow.selectedText && selNow.selectedText.includes(PROJECT_TITLE))) {
    await selectProjectByTitle(page, PROJECT_TITLE);
    await delay(1500);
  }
  await clickStage(page, "CSI Scoping");
  const persistWait = await waitFor(page, () => document.body.innerText.includes("03 30 00"), 20000, 500);
  const cardAfterReload = persistWait.ok ? await readPackageCard(page, "03 30 00") : null;
  record("row2", "package persists after reload", { ok: persistWait.ok, card: cardAfterReload ? cardAfterReload.slice(0, 500) : null });
  await shot(page, "remediation-qa5-p1-08-row2-persist-reload.png");

  // invalid CSI
  const pkgCountBefore = await page.evaluate(() => (document.body.innerText.match(/\b(\d+) Pkgs\b/) || [])[1] || null);
  await clickVisibleButton(page, "Create Trade Package");
  await waitFor(page, () => document.body.innerText.includes("Create CSI Trade Package"), 8000, 300);
  await setFieldByLabel(page, "CSI Division Number", "3 30 00");
  await setFieldByLabel(page, "Trade Package Name", "QA5 Invalid CSI Probe");
  await setFieldByLabel(page, "Budget Estimate", "1000");
  await setFieldByLabel(page, "Scope Summary", "invalid csi probe");
  await setFieldByLabel(page, "Mandatory Inclusions", "none");
  await setFieldByLabel(page, "Bid Deadline", new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10));
  await clickVisibleButton(page, "Create Package");
  await delay(1500);
  const invalidProbe = await page.evaluate(() => {
    const input = [...document.querySelectorAll("input")].find((i) => i.placeholder === "e.g. 26 00 00");
    const modalOpen = document.body.innerText.includes("Create CSI Trade Package");
    return {
      modalOpen,
      value: input ? input.value : null,
      patternMismatch: input ? input.validity.patternMismatch : null,
      validationMessage: input ? input.validationMessage : null,
      title: input ? input.title : null,
    };
  });
  const pkgCountAfterInvalid = await page.evaluate(() => (document.body.innerText.match(/\b(\d+) Pkgs\b/) || [])[1] || null);
  record("row2", "INVALID CSI submit blocked (native constraint)", { ...invalidProbe, pkgCountBefore, pkgCountAfterInvalid });
  await shot(page, "remediation-qa5-p1-09-row2-invalid-csi.png");
  await clickVisibleButton(page, "Cancel");
  await delay(800);

  results.row2 = {
    status:
      pkgWait.ok && persistWait.ok && invalidProbe.modalOpen && invalidProbe.patternMismatch === true && pkgCountBefore === pkgCountAfterInvalid
        ? "PASS"
        : "CHECK",
    createdAndPersisted: pkgWait.ok && persistWait.ok,
    cardAfterReload: (cardAfterReload || "").slice(0, 300),
    invalidCsi: invalidProbe,
    pkgCountBefore,
    pkgCountAfterInvalid,
  };
  record("row2", "ROW 2 VERDICT", results.row2);

  // ================= ROW 3: AI spec breakdown =================
  currentRow = "row3";
  await clickStage(page, "CSI Scoping");
  await delay(1000);
  const openSpec = await clickVisibleButton(page, "AI Spec Breakdown");
  record("row3", "open AI Spec Breakdown modal", openSpec);
  await waitFor(page, () => document.body.innerText.includes("AI Specification Breakdown & Auto-Scoping"), 8000, 300);
  await clickVisibleButton(page, "Load 4-Trade MEP Sample");
  const specLoaded = await waitFor(page, () => {
    const areas = [...document.querySelectorAll("textarea")].filter((t) => t.offsetParent !== null);
    const area = areas[areas.length - 1];
    return area && area.value.length > 500 ? area.value.length : null;
  }, 8000, 300);
  record("row3", "sample spec loaded into textarea", specLoaded);
  await shot(page, "remediation-qa5-p1-10-row3-spec-modal.png");

  const t0 = Date.now();
  await clickVisibleButton(page, "Auto-Generate Trade Packages");
  const started = await waitFor(page, () => document.body.innerText.includes("Analyzing Specs & Creating Packages"), 8000, 300);
  record("row3", "generation started", { started: started.ok, at: new Date().toISOString() });

  let outcome = null;
  const shotAt = [30000, 60000, 120000];
  let nextShot = 0;
  while (Date.now() - t0 < 170000) {
    const stateNow = await page.evaluate(() => {
      const t = document.body.innerText;
      if (t.includes("Specification breakdown failed")) {
        const m = t.match(/Specification breakdown failed:[^\n]*/);
        return { kind: "error", text: m ? m[0] : null };
      }
      if (t.includes("Successfully generated")) {
        const m = t.match(/Successfully generated[^\n]*/);
        return { kind: "success", text: m ? m[0] : null };
      }
      if (t.includes("Analyzing Specs & Creating Packages")) return { kind: "running" };
      return { kind: "unknown" };
    });
    if (stateNow.kind === "error" || stateNow.kind === "success") {
      outcome = { ...stateNow, elapsedMs: Date.now() - t0 };
      break;
    }
    if (nextShot < shotAt.length && Date.now() - t0 >= shotAt[nextShot]) {
      await shot(page, `remediation-qa5-p1-11-row3-during-${Math.round((Date.now() - t0) / 1000)}s.png`);
      nextShot++;
    }
    await delay(3000);
  }
  record("row3", "AI breakdown outcome", outcome || { kind: "timeout", elapsedMs: Date.now() - t0 });
  await shot(page, "remediation-qa5-p1-12-row3-result.png");

  await delay(3000);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await dismissDemoTour(page);
  const selNow3 = await getSelectorState(page);
  if (!(selNow3 && selNow3.selectedText && selNow3.selectedText.includes(PROJECT_TITLE))) {
    await selectProjectByTitle(page, PROJECT_TITLE);
    await delay(1500);
  }
  await clickStage(page, "CSI Scoping");
  await delay(2500);
  const pkgsBadge = await page.evaluate(() => (document.body.innerText.match(/(\d+) Pkgs/) || [])[1] || null);
  const csiDivisions = await page.evaluate(() => {
    const found = new Set();
    for (const m of document.body.innerText.matchAll(/CSI\s+(\d{2} \d{2} \d{2})/g)) found.add(m[1]);
    return [...found];
  });
  record("row3", "packages visible after reload", { pkgsBadge, csiDivisions });
  await shot(page, "remediation-qa5-p1-13-row3-after-reload.png");

  results.row3 = {
    status: outcome && outcome.kind === "success" ? "PASS" : outcome && outcome.kind === "error" ? "FAIL" : "PARTIAL (timeout)",
    outcome,
    pkgsBadgeAfterReload: pkgsBadge,
    csiDivisionsAfterReload: csiDivisions,
  };
  record("row3", "ROW 3 VERDICT", results.row3);

  results.diagnostics = {
    row1: snapshotRow(),
    row2: snapshotRow(),
    row3: snapshotRow(),
  };
  say(`DIAGNOSTICS SUMMARY: ${JSON.stringify({
    row1: { consoleErrors: results.diagnostics.row1.consoleErrors.length, pageErrors: results.diagnostics.row1.pageErrors.length, failedRequests: results.diagnostics.row1.failedRequests.length, httpErrors: results.diagnostics.row1.httpErrors.length },
    row2: { consoleErrors: results.diagnostics.row2.consoleErrors.length, pageErrors: results.diagnostics.row2.pageErrors.length, failedRequests: results.diagnostics.row2.failedRequests.length, httpErrors: results.diagnostics.row2.httpErrors.length },
    row3: { consoleErrors: results.diagnostics.row3.consoleErrors.length, pageErrors: results.diagnostics.row3.pageErrors.length, failedRequests: results.diagnostics.row3.failedRequests.length, httpErrors: results.diagnostics.row3.httpErrors.length },
  })}`);

  const lsFinal = await page.evaluate(() => localStorage.getItem("tradepulse.selectedProjectId"));
  saveState({ projectTitle: PROJECT_TITLE, projectIdFromLs: lsFinal, part1: results, part1At: new Date().toISOString() });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa5-part1-events.json"), JSON.stringify({ rowEvents, results, consoleErrors: consoleEvents.filter((e) => e.type === "error"), pageErrors, failedRequests, httpErrors }, null, 2), "utf8");
  say(`QA5_RESULT ${JSON.stringify(results)}`);
  write();
} catch (err) {
  say(`FATAL in ${currentRow}: ${err && err.stack ? err.stack : err}`);
  say(`EVENTS SO FAR: ${JSON.stringify({ consoleErrors: consoleEvents.filter((e) => e.type === "error"), pageErrors, failedRequests, httpErrors })}`);
  write();
  process.exitCode = 1;
} finally {
  await browser.close();
}