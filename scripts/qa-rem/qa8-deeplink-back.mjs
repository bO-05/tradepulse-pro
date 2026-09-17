// QA-8 (round 3) deep-link / back-button / reload-persistence probe.
// Usage: node scripts/qa-rem/qa8-deeplink-back.mjs
import {
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  delay,
  BASE_URL,
  writeLog,
  getSelectorState,
  bodyText,
} from "./qa1-lib.mjs";
import fs from "node:fs";
import path from "node:path";

const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const fixture = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa8-fixture.json"), "utf8"));

const LOG = [];
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};
const J = (o, max = 400) => {
  const s = JSON.stringify(o);
  return s.length > max ? s.slice(0, max) + "…" : s;
};

const diag = {};

async function state(page) {
  const sel = await getSelectorState(page);
  return page.evaluate(
    (selState) => {
      const stageSel = document.querySelector('select[aria-label="Navigate procurement stage"]');
      return {
        url: location.href,
        selectedProject: selState ? selState.selectedText : null,
        activeStage: stageSel ? stageSel.value : null,
        historyLength: history.length,
        hasAppSelector: Boolean(document.querySelector('select[aria-label="Select Commercial Construction Project"]')),
        bodyStart: document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 120),
      };
    },
    sel
  );
}

async function clickTab(page, label) {
  return page.evaluate((label) => {
    const header = document.querySelector("header");
    if (!header) return { ok: false };
    const btns = [...header.querySelectorAll("button")];
    const match = btns.find((b) => {
      const title = b.getAttribute("title") || "";
      if (title.includes(label)) return true;
      const spans = [...b.querySelectorAll("span")];
      return spans.length <= 3 && spans.some((s) => (s.textContent || "").trim() === label);
    });
    if (!match) return { ok: false };
    match.click();
    return { ok: true };
  }, label);
}

async function run() {
  const { browser } = await launchBrowser();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(25000);
    Object.assign(diag, attachDiagnostics(page));

    ev("=== QA-8 DEEP-LINK / BACK / RELOAD PROBE ===");
    ev(`Base URL: ${BASE_URL}`);
    ev(`UTC: ${new Date().toISOString()}`);
    ev(`QA fixture: ${fixture.qaProjectId} "${fixture.qaProjectTitle}"`);
    ev("");

    ev("[1] direct URL with fake ?project= param");
    await page.goto(`${BASE_URL}/?project=proj_fake_qa8`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(2000);
    const s1 = await state(page);
    ev(`    ${J(s1)}`);
    ev(`    URL-param honored=${s1.selectedProject && s1.selectedProject.includes("fake") ? "YES" : "NO (ignored; default/reselected project shown)"}`);
    await shot(page, "remediation-qa8-deeplink-fake-project.png");

    ev("");
    ev("[2] direct URL with real QA project id in ?project=");
    await page.goto(`${BASE_URL}/?project=${fixture.qaProjectId}`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(2000);
    const s2 = await state(page);
    ev(`    ${J(s2)}`);
    ev(`    URL-param honored=${s2.selectedProject && s2.selectedProject.includes("QA-REM-QA8") ? "YES" : "NO"}`);

    ev("");
    ev("[3] direct URL with #leveling hash");
    await page.goto(`${BASE_URL}/#leveling`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(1800);
    const s3 = await state(page);
    ev(`    ${J(s3)}`);
    ev(`    hash routed to leveling=${s3.activeStage === "leveling" ? "YES" : "NO (stays " + s3.activeStage + ")"}`);

    ev("");
    ev("[4] history behavior: tab clicks do they create history entries?");
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(1800);
    const h0 = (await state(page)).historyLength;
    await clickTab(page, "Bid Leveling");
    await delay(900);
    const st1 = await state(page);
    await clickTab(page, "Scope Clash");
    await delay(900);
    const st2 = await state(page);
    ev(`    historyLength: initial=${h0} afterLevelingTab=${st1.historyLength} afterClashTab=${st2.historyLength} activeStage=${st2.activeStage}`);
    ev(`    tab switches created history entries=${st2.historyLength > h0 ? "YES" : "NO (Back cannot return to a previous tab)"}`);

    ev("");
    ev("[5] browser Back after tab switches");
    let backErr = null;
    try {
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 8000 });
    } catch (e) {
      backErr = String(e.message).split("\n")[0];
    }
    await delay(1200);
    const s5 = await state(page).catch((e) => ({ error: String(e.message).split("\n")[0] }));
    ev(`    goBack error=${J(backErr)}`);
    ev(`    after Back: ${J(s5)}`);
    ev(`    app still mounted=${s5.hasAppSelector ? "YES" : "NO (left the app / dead end)"}`);
    await shot(page, "remediation-qa8-back-after-tabs.png");

    ev("");
    ev("[6] project switch + reload persistence");
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(1800);
    const selBefore = await getSelectorState(page);
    const qaOpt = selBefore.options.find((o) => o.text.includes("QA-REM-QA8-UX-"));
    if (qaOpt) {
      await page.evaluate((id) => {
        const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
        sel.value = id;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }, qaOpt.value);
      await delay(2200);
      const beforeReload = await state(page);
      ev(`    switched: ${J({ selected: beforeReload.selectedProject, historyLength: beforeReload.historyLength })}`);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForAppReady(page);
      await delay(2500);
      const afterReload = await state(page);
      ev(`    after reload: selected=${J(afterReload.selectedProject)} (persistence via localStorage)`);
      ev(`    reload restored selection=${afterReload.selectedProject === beforeReload.selectedProject ? "YES" : "NO"}`);
      await shot(page, "remediation-qa8-reload-persistence.png");
      const ls = await page.evaluate(() => JSON.stringify({ sel: localStorage.getItem("tradepulse.selectedProjectId") }));
      ev(`    localStorage: ${ls}`);
    } else {
      ev("    QA-REM option not found in selector");
    }

    ev("");
    ev("[7] browser Back after project switch (no reload)");
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(1800);
    const hs0 = (await state(page)).historyLength;
    await page.evaluate((id) => {
      const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      sel.value = id;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }, fixture.qaProjectId);
    await delay(2200);
    const hs1 = await state(page);
    ev(`    historyLength before=${hs0} after project switch=${hs1.historyLength} selected=${J(hs1.selectedProject)}`);
    let backErr2 = null;
    try {
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 8000 });
    } catch (e) {
      backErr2 = String(e.message).split("\n")[0];
    }
    await delay(1200);
    const s7 = await state(page).catch((e) => ({ error: String(e.message).split("\n")[0] }));
    ev(`    goBack error=${J(backErr2)}`);
    ev(`    after Back: ${J(s7)}`);

    ev("");
    const errs = diag.consoleLogs.filter((l) => l.type === "error" || l.type === "warning");
    ev(`[diag] console errors/warnings=${errs.length} pageerrors=${diag.pageErrors.length} failedReq=${diag.failedRequests.length}`);
    for (const e of errs) ev(`  [${e.type}] ${e.text}`);
    for (const p of diag.pageErrors) ev(`  pageerror ${p}`);
    for (const f of diag.failedRequests) ev(`  failedReq ${f}`);

    const dest = writeLog("remediation-qa8-deeplink-back.txt", LOG);
    console.log(`Wrote ${dest}`);
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});