import fs from "node:fs";
import path from "node:path";
import {
  BASE_URL,
  EVIDENCE_DIR,
  launchBrowser,
  shot,
  waitForAppReady,
  getSelectorState,
  selectProjectByTitle,
  delay,
} from "./qa1-lib.mjs";
import {
  makeLog,
  loadState,
  dismissDemoTour,
  clickStage,
  clickVisibleButton,
  waitFor,
} from "./qa5-lib.mjs";

const state = loadState();
const PROJECT_TITLE = state.projectTitle;
if (!PROJECT_TITLE) {
  console.error("No project title in state; run qa5-part1.mjs first.");
  process.exit(1);
}

const { say, write } = makeLog("remediation-qa5-part1b-row3-log.txt");
say(`=== QA-5 ROW 3 RETRY (AI Spec Breakdown, live labels) ===`);
say(`SITE: ${BASE_URL}`);
say(`UTC: ${new Date().toISOString()}`);
say(`PROJECT: ${PROJECT_TITLE}`);

const consoleEvents = [];
const pageErrors = [];
const failedRequests = [];
const httpErrors = [];

const { browser, executablePath } = await launchBrowser();
say(`EXECUTABLE: ${executablePath}`);
const page = await browser.newPage();
page.on("console", (m) => consoleEvents.push({ type: m.type(), text: m.text(), at: Date.now() }));
page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));
page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${r.url()} :: ${r.failure() ? r.failure().errorText : "?"}`));
page.on("response", (res) => {
  if (res.status() >= 400) httpErrors.push(`${res.request().method()} ${res.url()} -> ${res.status()}`);
});

const result = { row: 3 };
try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await dismissDemoTour(page);
  const sel = await getSelectorState(page);
  if (!(sel && sel.selectedText && sel.selectedText.includes(PROJECT_TITLE))) {
    await selectProjectByTitle(page, PROJECT_TITLE);
    await delay(1500);
  }
  await clickStage(page, "CSI Scoping");
  await delay(1500);

  const openSpec = await clickVisibleButton(page, "AI Spec Breakdown");
  say(`open modal: ${JSON.stringify(openSpec)}`);
  const modal = await waitFor(page, () => document.body.innerText.includes("AI Specification Breakdown"), 10000, 300);
  say(`modal open: ${JSON.stringify(modal)}`);

  const sampleBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].filter((x) => x.offsetParent !== null).find((x) => /sample/i.test(x.textContent || ""));
    if (!b) return { ok: false, available: [...document.querySelectorAll("button")].filter((x) => x.offsetParent !== null).map((x) => (x.textContent || "").trim()).slice(0, 40) };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true, text: (b.textContent || "").trim() };
  });
  say(`sample loader: ${JSON.stringify(sampleBtn)}`);
  const specLoaded = await waitFor(
    page,
    () => {
      const areas = [...document.querySelectorAll("textarea")].filter((t) => t.offsetParent !== null);
      const area = areas[areas.length - 1];
      return area && area.value.length > 500 ? { len: area.value.length, head: area.value.slice(0, 120) } : null;
    },
    8000,
    300
  );
  say(`spec loaded: ${JSON.stringify(specLoaded)}`);
  await shot(page, "remediation-qa5-p1b-01-row3-spec-modal.png");

  const t0 = Date.now();
  const genBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].filter((x) => x.offsetParent !== null).find((x) => /Auto-Generate/i.test(x.textContent || ""));
    if (!b) return { ok: false };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true, text: (b.textContent || "").trim() };
  });
  say(`generate clicked: ${JSON.stringify(genBtn)}`);
  const started = await waitFor(page, () => /Analyzing Specs|Creating Packages/.test(document.body.innerText), 8000, 300);
  say(`started: ${JSON.stringify(started)}`);

  let outcome = null;
  const shotAt = [30000, 60000, 120000];
  let nextShot = 0;
  let sawErrorConsole = [];
  while (Date.now() - t0 < 175000) {
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
      if (/Analyzing Specs|Creating Packages/.test(t)) return { kind: "running" };
      return { kind: "unknown" };
    });
    sawErrorConsole = consoleEvents.filter((e) => e.type === "error");
    if (stateNow.kind === "error" || stateNow.kind === "success") {
      outcome = { ...stateNow, elapsedMs: Date.now() - t0 };
      break;
    }
    if (nextShot < shotAt.length && Date.now() - t0 >= shotAt[nextShot]) {
      await shot(page, `remediation-qa5-p1b-02-row3-during-${Math.round((Date.now() - t0) / 1000)}s.png`);
      nextShot++;
    }
    await delay(3000);
  }
  say(`outcome: ${JSON.stringify(outcome || { kind: "timeout", elapsedMs: Date.now() - t0 })}`);
  await shot(page, "remediation-qa5-p1b-03-row3-result.png");

  await delay(3000);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await dismissDemoTour(page);
  const sel3 = await getSelectorState(page);
  if (!(sel3 && sel3.selectedText && sel3.selectedText.includes(PROJECT_TITLE))) {
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
  const body = await page.evaluate(() => document.body.innerText);
  say(`after reload: pkgsBadge=${pkgsBadge} csiDivisions=${JSON.stringify(csiDivisions)}`);
  await shot(page, "remediation-qa5-p1b-04-row3-after-reload.png");

  result.status = outcome && outcome.kind === "success" ? "PASS" : outcome && outcome.kind === "error" ? "FAIL" : "PARTIAL (no result within 175s)";
  result.outcome = outcome;
  result.pkgsBadgeAfterReload = pkgsBadge;
  result.csiDivisionsAfterReload = csiDivisions;
  result.bodyMentionsNoPackages = body.includes("No Trade Packages Configured");
  result.consoleErrors = sawErrorConsole.map((e) => e.text);
  result.pageErrors = pageErrors;
  result.failedRequests = failedRequests;
  result.httpErrors = httpErrors;
  result.diagnosticsTotals = { consoleEvents: consoleEvents.length, consoleErrors: consoleEvents.filter((e) => e.type === "error").length, pageErrors: pageErrors.length, failedRequests: failedRequests.length, httpErrors: httpErrors.length };
  say(`ROW 3 VERDICT: ${JSON.stringify(result)}`);
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa5-part1b-row3-result.json"), JSON.stringify(result, null, 2), "utf8");
  write();
} catch (err) {
  say(`FATAL: ${err && err.stack ? err.stack : err}`);
  result.status = "ERROR";
  result.error = String(err);
  result.consoleErrors = consoleEvents.filter((e) => e.type === "error").map((e) => e.text);
  result.pageErrors = pageErrors;
  result.failedRequests = failedRequests;
  result.httpErrors = httpErrors;
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa5-part1b-row3-result.json"), JSON.stringify(result, null, 2), "utf8");
  write();
  process.exitCode = 1;
} finally {
  await browser.close();
}