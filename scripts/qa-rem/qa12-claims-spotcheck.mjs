// QA-12 claims spot-check on the current bundle:
//  - STALE-ERR: empty submit error appears; close + reopen shows no stale error.
//  - ?project=fake: graceful fallback to demo, no console errors.
import {
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  delay,
  BASE_URL,
  writeLog,
  getSelectorState,
} from "./qa1-lib.mjs";
import fs from "node:fs";
import path from "node:path";

const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const LOG = [];
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};
const J = (o, max = 500) => {
  const s = JSON.stringify(o);
  return s.length > max ? s.slice(0, max) + "…" : s;
};

async function openModal(page) {
  return page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim().includes("New Project"));
    if (!b) return false;
    b.click();
    return true;
  });
}
async function closeModal(page) {
  return page.evaluate(() => {
    const b = document.querySelector('button[aria-label="Close new project dialog"]');
    if (!b) return false;
    b.click();
    return true;
  });
}
async function isModalOpen(page) {
  return page.evaluate(() => Boolean(document.querySelector('[aria-labelledby="new-project-title"]')));
}
async function readFormError(page) {
  return page.evaluate(() => {
    const form = [...document.querySelectorAll("form")].find((f) => (f.textContent || "").includes("Project Title"));
    if (!form) return null;
    const p = [...form.querySelectorAll("p,div[role='alert']")].find((x) => /rose|red|error/i.test(x.className || ""));
    return p ? p.textContent.trim() : null;
  });
}
async function dispatchSubmit(page) {
  return page.evaluate(() => {
    const form = [...document.querySelectorAll("form")].find((f) => (f.textContent || "").includes("Project Title"));
    if (!form) return { ok: false };
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    return { ok: true, viaButton: false };
  });
}

async function run() {
  const { browser } = await launchBrowser();
  const summary = { at: new Date().toISOString() };
  try {
    ev("=== QA-12 CLAIMS SPOT-CHECK ===");
    ev(`UTC: ${new Date().toISOString()}`);
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.setDefaultTimeout(30000);
    const d = attachDiagnostics(page);
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(2200);

    // STALE-ERR
    const opened1 = await openModal(page);
    await page.waitForSelector('[aria-labelledby="new-project-title"]', { timeout: 10000 });
    await dispatchSubmit(page);
    await delay(1200);
    const err1 = await readFormError(page);
    await closeModal(page);
    await delay(600);
    const opened2 = await openModal(page);
    await delay(600);
    const staleErr = await readFormError(page);
    await shot(page, "remediation-qa12-20-stale-err-reopen.png");
    ev(`STALE-ERR: open1=${opened1} error1="${err1}" reopened=${opened2} staleError="${staleErr}"`);
    if (await isModalOpen(page)) await closeModal(page);
    await delay(400);
    summary.staleErr = { open1: opened1, error1: err1, reopened: opened2, staleError: staleErr };

    // ?project=fake
    const before = { console: d.consoleLogs.length, pageErrors: d.pageErrors.length, failedReq: d.failedRequests.length };
    await page.goto(`${BASE_URL}/?project=fake`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(2200);
    const sel = await getSelectorState(page);
    const body = await page.evaluate(() => {
      const m = document.querySelector("main");
      return m ? m.innerText.replace(/\s+/g, " ").slice(0, 220) : null;
    });
    const newErrors = d.consoleLogs.slice(before.console).filter((l) => l.type === "error").map((l) => l.text);
    const newPageErrors = d.pageErrors.slice(before.pageErrors);
    ev(`?project=fake: url=${page.url()} selected="${sel?.selectedText}" errors=${newErrors.length} pageErrors=${newPageErrors.length}`);
    ev(`body: ${J(body, 250)}`);
    await shot(page, "remediation-qa12-21-project-fake.png");
    summary.projectFake = { url: page.url(), selected: sel?.selectedText, body, consoleErrors: newErrors, pageErrors: newPageErrors };

    const diag = {
      consoleErrors: d.consoleLogs.filter((l) => l.type === "error").map((l) => l.text),
      consoleWarnings: d.consoleLogs.filter((l) => l.type === "warning").map((l) => l.text),
      pageErrors: d.pageErrors,
      failedRequests: d.failedRequests,
    };
    ev(`session diag: ${J(diag, 400)}`);
    summary.diag = diag;

    fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa12-claims-spotcheck.json"), JSON.stringify(summary, null, 2), "utf8");
    writeLog("remediation-qa12-claims-spotcheck.txt", LOG);
    await browser.close();
    console.log("Wrote evidence.");
  } catch (e) {
    writeLog("remediation-qa12-claims-spotcheck.txt", LOG.concat([`FATAL: ${e?.stack || e}`]));
    await browser.close();
    process.exit(1);
  }
}

run();