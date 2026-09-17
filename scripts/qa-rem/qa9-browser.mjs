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
const checks = {};
const results = {};

const fixtures = JSON.parse(
  fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa9-fixtures.json"), "utf8")
);
const FIXTURE_TITLE = fixtures.fixture.title;
const FIXTURE_ID = fixtures.fixture.id;
const DEMO_TITLE = fixtures.demo.title;

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
say(`QA9 BROWSER PROBE at ${new Date().toISOString()}`);
say(`target: ${BASE_URL}`);
say(`executable: ${executablePath}`);
say(`fixture: ${FIXTURE_TITLE} (${FIXTURE_ID})`);

const context =
  typeof browser.createBrowserContext === "function"
    ? await browser.createBrowserContext()
    : await browser.createIncognitoBrowserContext();
const page = await context.newPage();
const diag = attachDiagnostics(page);
const httpErrors = [];
const allResponses = [];
page.on("response", (r) => {
  const rec = { status: r.status(), method: r.request().method(), url: r.url() };
  allResponses.push(rec);
  if (rec.status >= 400) httpErrors.push(rec);
});

const clickHeaderTab = (label) =>
  page.evaluate((needle) => {
    const header = document.querySelector("header");
    if (!header) return { ok: false, reason: "header not found" };
    const btn = [...header.querySelectorAll("button")].find((b) => (b.textContent || "").includes(needle));
    if (!btn) return { ok: false, reason: "header tab button not found" };
    btn.scrollIntoView({ block: "center" });
    btn.click();
    return { ok: true, text: (btn.textContent || "").trim() };
  }, label);

const getStageValue = () =>
  page.$eval('select[aria-label="Navigate procurement stage"]', (el) => el.value).catch(() => null);

const getScopeClashNav = () =>
  page.evaluate(() => {
    const header = document.querySelector("header");
    if (!header) return null;
    const btn = [...header.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Scope Clash"));
    if (!btn) return null;
    const spans = [...btn.querySelectorAll("span")].map((s) => (s.textContent || "").trim());
    return { fullText: (btn.textContent || "").trim(), spans };
  });

const selectAndSettle = async (title, markerAnyOf) => {
  const res = await selectProjectByTitle(page, title);
  if (!res.ok) return res;
  await page.waitForFunction(
    (names) => names.some((n) => document.body.innerText.includes(n)),
    { timeout: 30000 },
    markerAnyOf
  );
  await delay(900);
  return res;
};

const clickNewProject = () =>
  page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const b = btns.find((x) => (x.textContent || "").includes("New Project"));
    if (!b) return { ok: false };
    b.click();
    return { ok: true, text: (b.textContent || "").trim() };
  });

const fillByLabel = (labelText, value) =>
  page.evaluate(
    (labelNeedle, val) => {
      const labels = [...document.querySelectorAll("label")];
      const lab = labels.find((l) => (l.textContent || "").trim().startsWith(labelNeedle));
      if (!lab) return { ok: false, reason: "label not found" };
      const container = lab.parentElement;
      const el = container.querySelector("input, textarea, select");
      if (!el) return { ok: false, reason: "field not found" };
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

let fixture = null;
try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(1500);

  // ================= ITEM 1a: CLASH-LEAK on fresh 0-package project =================
  say("\n===== ITEM 1a: empty-state Scope Clash on fresh QA-REM fixture =====");
  const selFix = await selectAndSettle(FIXTURE_TITLE, [FIXTURE_TITLE, "No Trade Packages Configured"]);
  say(`select fixture -> ${JSON.stringify(selFix)}`);
  await delay(1200);
  const selState = await getSelectorState(page);
  say(`selector after select: ${JSON.stringify(selState && { value: selState.value, text: selState.selectedText })}`);

  const navEmpty = await getScopeClashNav();
  say(`Scope Clash nav (empty fixture): ${JSON.stringify(navEmpty)}`);
  const badgeText = navEmpty ? navEmpty.spans[navEmpty.spans.length - 1] : null;
  checks.emptyBadgeClear = navEmpty && /^Clear$/.test(String(badgeText)) ? "PASS" : "FAIL";
  checks.emptyBadgeNotFour = navEmpty && !(navEmpty.fullText || "").includes("4 Clashes") ? "PASS" : "FAIL";
  await shot(page, "remediation-qa9-02-header-badge-empty-fixture.png");

  const tabEmpty = await clickHeaderTab("Scope Clash");
  await delay(1200);
  const stageAfterEmpty = await getStageValue();
  const textEmpty = await bodyText(page);
  say(`click Scope Clash -> ${JSON.stringify(tabEmpty)}; stage=${stageAfterEmpty}`);
  const emptyBodyHits = {
    hasDemoTotal50500: textEmpty.includes("$50,500"),
    hasDemoTotal46500: textEmpty.includes("$46,500"),
    hasVfdClashTitle: textEmpty.includes("Variable Frequency Drives"),
    hasDisconnectClashTitle: textEmpty.includes("Rooftop Mechanical Equipment Disconnect"),
    hasScopeVoidBas: textEmpty.includes("Low-Voltage 24V BAS Control"),
    hasScopeVoidSmoke: textEmpty.includes("Duct Smoke Detector Installation"),
    hasResolved: textEmpty.includes("Resolved"),
    hasZeroAwaiting: textEmpty.includes("0 items awaiting resolution"),
    hasDoubleBuyHeading: textEmpty.includes("Redundant Scope Double-Buys"),
  };
  say(`empty clash body hits: ${JSON.stringify(emptyBodyHits)}`);
  checks.emptyNoDemoAmounts = !emptyBodyHits.hasDemoTotal50500 && !emptyBodyHits.hasDemoTotal46500 ? "PASS" : "FAIL";
  checks.emptyNoDemoCards =
    !emptyBodyHits.hasVfdClashTitle &&
    !emptyBodyHits.hasDisconnectClashTitle &&
    !emptyBodyHits.hasScopeVoidBas &&
    !emptyBodyHits.hasScopeVoidSmoke
      ? "PASS"
      : "FAIL";
  checks.emptyResolved = emptyBodyHits.hasResolved && emptyBodyHits.hasZeroAwaiting ? "PASS" : "FAIL";
  await shot(page, "remediation-qa9-02-clash-empty-fixture.png");

  // Sanity: the "0 evaluated" subtitle should reflect zero bids (honest scope line)
  const evalLine = (textEmpty.match(/Autonomous scan across CSI trade proposals \([^)]*\)/) || [null])[0];
  say(`empty fixture scan subtitle: ${evalLine}`);

  // ================= ITEM 2: KPI-3 on fresh 0-package project =================
  say("\n===== ITEM 2: KPI bar Buyout 0/0 on fresh fixture =====");
  const kpiProbe = await page.evaluate(() => {
    const strongs = [...document.querySelectorAll("strong")];
    const hit = strongs.find((s) => /Awarded/.test(s.textContent || ""));
    if (!hit) return { found: false, bodyHasAwarded: document.body.innerText.includes("Awarded") };
    const parent = hit.closest("span");
    const style = parent ? getComputedStyle(parent) : null;
    return {
      found: true,
      text: (hit.textContent || "").trim(),
      parentText: parent ? (parent.textContent || "").trim() : null,
      parentDisplay: style ? style.display : null,
      parentVisibility: style ? style.visibility : null,
      visible: style ? style.display !== "none" && style.visibility !== "hidden" : null,
      inInnerText: document.body.innerText.includes((hit.textContent || "").trim()),
    };
  });
  say(`KPI buyout probe: ${JSON.stringify(kpiProbe)}`);
  checks.kpiZeroOfZero = kpiProbe.found && kpiProbe.text === "0/0 Awarded" ? "PASS" : "FAIL";
  checks.kpiNotZeroOfThree = kpiProbe.found && !/^0\/3/.test(kpiProbe.text) ? "PASS" : "FAIL";
  await shot(page, "remediation-qa9-03-kpi-0-0-fixture.png");

  // ================= ITEM 1b: demo Scope Clash still renders =================
  say("\n===== ITEM 1b: demo project Scope Clash unaffected =====");
  const selDemo = await selectAndSettle(DEMO_TITLE, ["26 00 00 Electrical", "CSI Scoping"]);
  say(`select demo -> ${JSON.stringify(selDemo)}`);
  await delay(1200);
  const navDemo = await getScopeClashNav();
  say(`Scope Clash nav (demo): ${JSON.stringify(navDemo)}`);
  checks.demoBadgeFour = navDemo && (navDemo.fullText || "").includes("4 Clashes") ? "PASS" : "FAIL";
  const tabDemo = await clickHeaderTab("Scope Clash");
  await delay(1200);
  const stageAfterDemo = await getStageValue();
  const textDemo = await bodyText(page);
  say(`click Scope Clash (demo) -> ${JSON.stringify(tabDemo)}; stage=${stageAfterDemo}`);
  const demoHits = {
    has50500: textDemo.includes("$50,500"),
    has46500: textDemo.includes("$46,500"),
    hasVfdClashTitle: textDemo.includes("Variable Frequency Drives"),
    hasDisconnectClashTitle: textDemo.includes("Rooftop Mechanical Equipment Disconnect"),
    hasScopeVoidBas: textDemo.includes("Low-Voltage 24V BAS Control"),
    hasScopeVoidSmoke: textDemo.includes("Duct Smoke Detector Installation"),
  };
  const doubleBuyBadgeCount = (textDemo.match(/Redundant Double-Buy Detected/g) || []).length;
  say(`demo clash body hits: ${JSON.stringify(demoHits)}; doubleBuyCardBadges=${doubleBuyBadgeCount}`);
  checks.demoAmountsRender = demoHits.has50500 && demoHits.has46500 ? "PASS" : "FAIL";
  checks.demoDoubleBuyCards = demoHits.hasVfdClashTitle && demoHits.hasDisconnectClashTitle && doubleBuyBadgeCount === 2 ? "PASS" : "FAIL";
  checks.demoVoidCards = demoHits.hasScopeVoidBas && demoHits.hasScopeVoidSmoke ? "PASS" : "FAIL";
  await shot(page, "remediation-qa9-04-clash-demo.png");

  // ================= ITEM 3: STALE-ERR close/reopen =================
  say("\n===== ITEM 3: stale create-error must clear on close/reopen =====");
  const openRes = await clickNewProject();
  await delay(700);
  const modalOpen = await page.evaluate(() => document.body.innerText.includes("Create New Construction Project"));
  say(`open New Project -> ${JSON.stringify(openRes)}; modal open=${modalOpen}`);
  const fillWs = await fillByLabel("Project Title", "   ");
  say(`fill whitespace title -> ${JSON.stringify(fillWs)}`);
  await shot(page, "remediation-qa9-05a-staleerr-before-submit.png");
  const submitRes = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Commercial Project"));
    if (!btn) return { ok: false };
    btn.click();
    return { ok: true, disabled: btn.disabled };
  });
  say(`submit whitespace title -> ${JSON.stringify(submitRes)}`);
  await delay(900);
  const errorShown = await page.evaluate(() => {
    const p = [...document.querySelectorAll("p")].find((x) => (x.textContent || "").trim() === "Project title is required.");
    return p ? p.textContent.trim() : null;
  });
  say(`inline error shown after submit: ${JSON.stringify(errorShown)}`);
  checks.staleErrShownInitially = errorShown === "Project title is required." ? "PASS" : "FAIL";
  await shot(page, "remediation-qa9-05-staleerr-error-shown.png");

  const closeRes = await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="Close new project dialog"]');
    if (!b) return { ok: false };
    b.click();
    return { ok: true };
  });
  await delay(600);
  const modalClosed = await page.evaluate(() => !document.body.innerText.includes("Create New Construction Project"));
  say(`close modal -> ${JSON.stringify(closeRes)}; modal closed=${modalClosed}`);
  checks.staleErrModalClosed = modalClosed ? "PASS" : "FAIL";

  const reopenRes = await clickNewProject();
  await delay(700);
  const reopenedState = await page.evaluate(() => {
    const modalOpenNow = document.body.innerText.includes("Create New Construction Project");
    const stale = [...document.querySelectorAll("p")].find((x) => (x.textContent || "").trim() === "Project title is required.");
    const errTexts = [...document.querySelectorAll("p")]
      .map((x) => (x.textContent || "").trim())
      .filter((t) => /required|must be|positive|between/.test(t));
    const titleVal = (() => {
      const labels = [...document.querySelectorAll("label")];
      const lab = labels.find((l) => (l.textContent || "").trim().startsWith("Project Title"));
      const inp = lab ? lab.parentElement.querySelector("input") : null;
      return inp ? inp.value : null;
    })();
    return { modalOpenNow, staleErrorVisible: !!stale, errorParagraphs: errTexts, titleVal };
  });
  say(`reopened modal state: ${JSON.stringify(reopenedState)}`);
  checks.staleErrGoneOnReopen =
    reopenedState.modalOpenNow && !reopenedState.staleErrorVisible && reopenedState.errorParagraphs.length === 0 ? "PASS" : "FAIL";
  await shot(page, "remediation-qa9-06-staleerr-reopened.png");

  // close the modal again (clean state)
  await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="Close new project dialog"]');
    if (b) b.click();
  });
  await delay(400);

  // ================= ITEM 4: regression sweep on fresh fixture =================
  say("\n===== ITEM 4: 8-tab regression sweep on fresh fixture =====");
  const selFix2 = await selectAndSettle(FIXTURE_TITLE, [FIXTURE_TITLE, "No Trade Packages Configured"]);
  say(`re-select fixture -> ${JSON.stringify(selFix2)}`);
  await delay(1200);

  const sweepStart = { console: diag.consoleLogs.length, pageErrors: diag.pageErrors.length, http: httpErrors.length, failed: diag.failedRequests.length };
  const tabReports = [];
  for (const label of TABS) {
    const before = {
      console: diag.consoleLogs.length,
      pageErrors: diag.pageErrors.length,
      http: httpErrors.length,
      failed: diag.failedRequests.length,
    };
    const res = await clickHeaderTab(label);
    await delay(800);
    const stageNow = await getStageValue();
    const text = await bodyText(page);
    const newConsoleErrs = diag.consoleLogs.slice(before.console).filter((l) => l.type === "error").map((l) => l.text);
    const newPageErrs = diag.pageErrors.slice(before.pageErrors);
    const newHttpErrs = httpErrors.slice(before.http).map((r) => `${r.status} ${r.method} ${r.url}`);
    const newFailed = diag.failedRequests.slice(before.failed);
    const shotPath = await shot(page, `remediation-qa9-07-tab-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`);
    tabReports.push({ label, click: res, stage: stageNow, newConsoleErrs, newPageErrs, newHttpErrs, newFailed, shot: shotPath });
    say(`  TAB ${label}: click=${res.ok} stage=${stageNow} consoleErrs=${JSON.stringify(newConsoleErrs)} http>=400=${JSON.stringify(newHttpErrs)} failed=${JSON.stringify(newFailed)}`);
  }

  // CSI Scoping empty state CTA check (revisit tab)
  await clickHeaderTab("CSI Scoping");
  await delay(900);
  const csiText = await bodyText(page);
  const csiChecks = {
    hasEmptyPanel: csiText.includes("No Trade Packages Configured"),
    hasCreateCTA: (csiText.match(/Create Trade Package/g) || []).length >= 1,
    stage: await getStageValue(),
  };
  say(`CSI empty-state CTAs: ${JSON.stringify(csiChecks)}`);
  checks.csiActionableEmptyState = csiChecks.hasEmptyPanel && csiChecks.hasCreateCTA ? "PASS" : "FAIL";
  await shot(page, "remediation-qa9-08-csi-empty-ctas.png");

  const failedNow = diag.failedRequests.slice(sweepStart.failed);
  const httpNow = httpErrors.slice(sweepStart.http).map((r) => `${r.status} ${r.method} ${r.url}`);
  const consoleErrs = diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text);
  const pageErrsAll = diag.pageErrors.slice();

  checks.sweepZeroConsoleErrors = consoleErrs.length === 0 && pageErrsAll.length === 0 ? "PASS" : "FAIL";
  checks.sweepZeroFailedRequests = failedNow.length === 0 ? "PASS" : "FAIL";
  checks.sweepZeroHttpGE400 = httpNow.length === 0 ? "PASS" : "FAIL";

  say(`\nsweep summary: consoleErrors=${JSON.stringify(consoleErrs)}`);
  say(`sweep pageErrors=${JSON.stringify(pageErrsAll)}`);
  say(`sweep failedRequests=${JSON.stringify(failedNow)}`);
  say(`sweep http>=400=${JSON.stringify(httpNow)}`);
  say(`sweep total responses observed=${allResponses.length} (status>=400: ${httpErrors.length})`);

  const overall = Object.values(checks).every((v) => v === "PASS") ? "PASS" : "FAIL";
  say(`\nCHECKS: ${JSON.stringify(checks, null, 2)}`);
  say(`QA9 BROWSER PROBE RESULT: ${overall}`);

  writeLog("remediation-qa9-02-browser-log.txt", log);
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "remediation-qa9-browser-results.json"),
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        base: BASE_URL,
        fixture: { title: FIXTURE_TITLE, id: FIXTURE_ID },
        demo: { title: DEMO_TITLE, id: fixtures.demo.id },
        checks,
        overall,
        tabReports,
        diagnostics: summarizeDiagnostics(diag),
        httpErrors,
      },
      null,
      2
    ),
    "utf8"
  );
  process.exitCode = overall === "PASS" ? 0 : 1;
} catch (err) {
  say(`ERROR: ${err && err.stack ? err.stack : err}`);
  say(`diagnostics at failure: ${JSON.stringify(summarizeDiagnostics(diag))}`);
  say(`http>=400 at failure: ${JSON.stringify(httpErrors)}`);
  writeLog("remediation-qa9-02-browser-log.txt", log);
  process.exitCode = 1;
} finally {
  await browser.close();
}