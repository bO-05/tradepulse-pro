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
import { makeLog, loadState, saveState, dismissDemoTour, clickStage, clickVisibleButton, setFieldByLabel, waitFor } from "./qa5-lib.mjs";

const state = loadState();
const PROJECT_TITLE = state.projectTitle;
const MANUAL_NAME = "QA5 Manual Concrete Co";
const { say, write } = makeLog("remediation-qa5-part2b-edit-log.txt");
say(`=== QA-5 ROW 4 EDIT RETRY ===`);
say(`PROJECT: ${PROJECT_TITLE} | UTC: ${new Date().toISOString()}`);

const consoleEvents = [];
const pageErrors = [];
const failedRequests = [];
const httpErrors = [];
const { browser } = await launchBrowser();
const page = await browser.newPage();
page.on("console", (m) => consoleEvents.push({ type: m.type(), text: m.text() }));
page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));
page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${r.url()} :: ${r.failure() ? r.failure().errorText : "?"}`));
page.on("response", (res) => {
  if (res.status() >= 400) httpErrors.push(`${res.request().method()} ${res.url()} -> ${res.status()}`);
});

const result = { row: "4-edit" };
try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await dismissDemoTour(page);
  const sel = await getSelectorState(page);
  if (!(sel && sel.selectedText && sel.selectedText.includes(PROJECT_TITLE))) {
    await selectProjectByTitle(page, PROJECT_TITLE);
    await delay(1500);
  }
  await clickStage(page, "Discovery");
  await waitFor(page, () => document.body.innerText.includes("Discovery & Directory"), 15000, 500);
  await delay(2000);

  const searchBox = await page.evaluate(() => {
    const i = [...document.querySelectorAll("input")].find((x) => (x.placeholder || "").includes("Search contractors"));
    if (!i) return { ok: false };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(i, "QA5 Manual Concrete Co");
    i.dispatchEvent(new Event("input", { bubbles: true }));
    i.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  });
  say(`search filter: ${JSON.stringify(searchBox)}`);
  await delay(1200);

  const before = await page.evaluate((name) => {
    const i = document.body.innerText.indexOf(name);
    return i >= 0 ? document.body.innerText.slice(Math.max(0, i - 200), i + 500) : null;
  }, MANUAL_NAME);
  say(`row before edit: ${JSON.stringify(before)}`);

  const editClick = await page.evaluate((name) => {
    const btns = [...document.querySelectorAll('button[title="Edit contractor info"]')].filter((b) => b.offsetParent !== null);
    const info = btns.map((b) => ({ text: b.textContent.trim(), rowHasName: (b.closest("div") || {}).innerText ? false : null }));
    const btn = btns.find((b) => {
      let el = b.parentElement;
      for (let i = 0; i < 8 && el; i++) {
        if ((el.innerText || "").includes(name)) return true;
        el = el.parentElement;
      }
      return false;
    });
    if (!btn) return { ok: false, buttonCount: btns.length, info };
    btn.scrollIntoView({ block: "center" });
    btn.click();
    return { ok: true, buttonCount: btns.length };
  }, MANUAL_NAME);
  say(`edit click: ${JSON.stringify(editClick)}`);
  const modal = await waitFor(page, () => document.body.innerText.includes("Edit Contractor Details"), 8000, 300);
  say(`edit modal open: ${JSON.stringify(modal)}`);
  const licenseField = await setFieldByLabel(page, "State License", "QA5-TECL-EDITED-0002");
  say(`license field: ${JSON.stringify(licenseField)}`);
  await shot(page, "remediation-qa5-p2b-01-row4-edit-modal.png");
  await clickVisibleButton(page, "Save Changes");
  const editedVisible = await waitFor(page, () => (document.body.innerText.includes("QA5-TECL-EDITED-0002") ? true : null), 15000, 500);
  say(`edited license visible: ${JSON.stringify(editedVisible)}`);
  const after = await page.evaluate((name) => {
    const i = document.body.innerText.indexOf(name);
    return i >= 0 ? document.body.innerText.slice(Math.max(0, i - 100), i + 400) : null;
  }, MANUAL_NAME);
  say(`row after edit: ${JSON.stringify(after)}`);
  await shot(page, "remediation-qa5-p2b-02-row4-edited.png");

  result.status = editClick.ok && modal.ok && licenseField.ok && editedVisible.ok ? "PASS" : "FAIL";
  result.editClick = editClick;
  result.modalOpen = modal.ok;
  result.licenseField = licenseField;
  result.editedLicenseVisible = editedVisible.ok;
  result.rowBefore = before;
  result.rowAfter = after;
  result.consoleErrors = consoleEvents.filter((e) => e.type === "error").map((e) => e.text);
  result.pageErrors = pageErrors;
  result.failedRequests = failedRequests;
  result.httpErrors = httpErrors;
  say(`ROW 4 EDIT VERDICT: ${JSON.stringify(result)}`);
  saveState({ part2b: result, part2bAt: new Date().toISOString() });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa5-part2b-edit-result.json"), JSON.stringify(result, null, 2), "utf8");
  write();
} catch (err) {
  say(`FATAL: ${err && err.stack ? err.stack : err}`);
  result.status = "ERROR";
  result.error = String(err);
  write();
  process.exitCode = 1;
} finally {
  await browser.close();
}