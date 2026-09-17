import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import {
  BASE_URL,
  EVIDENCE_DIR,
  launchBrowser,
  attachDiagnostics,
  waitForAppReady,
  getSelectorState,
  clickButtonByText,
  setInputValue,
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

const fixtures = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa7-fixtures.json"), "utf8"));
const project = fixtures.project;
say(`QA7 ITEMS 3+5 (readable backend validation errors / CSI range) at ${new Date().toISOString()}`);
say(`fixture project: ${project.title} [${project.id}]`);

const client = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
async function withRetry(label, fn, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      say(`  backend ${label} attempt ${i + 1} failed: ${String(err).slice(0, 140)}`);
      await delay(2000);
    }
  }
  throw lastErr;
}
const listPkgs = () =>
  withRetry("listPkgs", () => client.query("tradePackages:listByProject", { projectId: project.id }));

const { browser } = await launchBrowser();
const context =
  typeof browser.createBrowserContext === "function"
    ? await browser.createBrowserContext()
    : await browser.createIncognitoBrowserContext();
const page = await context.newPage();
const diag = attachDiagnostics(page);

const modalState = () =>
  page.evaluate(() => {
    const h3 = [...document.querySelectorAll("h3")].find((h) => (h.textContent || "").trim() === "Create CSI Trade Package");
    if (!h3) return null;
    const root = h3.closest("div.fixed") || h3.parentElement;
    const errEl = root.querySelector("p.text-rose-400");
    return {
      open: true,
      errorText: errEl ? errEl.textContent.trim() : null,
      fullText: root.innerText.slice(0, 600),
    };
  });

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(1000);
  await page.select('select[aria-label="Select Commercial Construction Project"]', project.id);
  await delay(1200);
  const sel = await getSelectorState(page);
  say(`selected project: ${JSON.stringify(sel?.selectedText)}`);
  if (sel?.value !== project.id) throw new Error("fixture project not selected");

  // ---------- ITEM 3/5a: CSI 99 99 99 -> readable error, package NOT created ----------
  const beforePkgs = await listPkgs();
  say(`packages before invalid attempt: ${beforePkgs.length} (${beforePkgs.map((p) => p.tradeName).join(", ")})`);

  const open1 = await clickButtonByText(page, "Create Trade Package");
  say(`open create modal -> ${JSON.stringify(open1)}`);
  await delay(500);

  const patternCheck = await page.evaluate(() => {
    const el = document.querySelector('input[placeholder="e.g. 26 00 00"]');
    return { pattern: el?.getAttribute("pattern"), value: el?.value };
  });
  say(`CSI input browser pattern: ${JSON.stringify(patternCheck)}`);

  await setInputValue(page, 'input[placeholder="e.g. 26 00 00"]', "99 99 99");
  await setInputValue(page, 'input[placeholder="e.g. Electrical & Lighting Systems"]', "QA Invalid CSI Package");
  await setInputValue(page, 'input[type="number"]', "100000");
  await setInputValue(page, 'textarea[placeholder="Scope details..."]', "QA invalid division probe.");
  await delay(300);
  const validity = await page.evaluate(() => {
    const el = document.querySelector('input[placeholder="e.g. 26 00 00"]');
    return { valid: el.checkValidity(), patternMismatch: el.validity.patternMismatch, value: el.value };
  });
  say(`browser validity for 99 99 99: ${JSON.stringify(validity)}`);

  const submit1 = await clickButtonByText(page, "Create Package");
  say(`submit invalid CSI -> ${JSON.stringify(submit1)}`);
  await delay(1500);
  const st1 = await modalState();
  say(`modal after invalid submit: ${JSON.stringify(st1)}`);
  await shot(page, "remediation-qa7-03-01-csi-99-error.png");

  const errMsg = st1?.errorText || "";
  results.invalidCsiRejectedReadable =
    errMsg.length > 0 && errMsg.includes("CSI MasterFormat divisions run 00") && !errMsg.includes("[CONVEX")
      ? "PASS"
      : "FAIL";
  say(`readable CSI error: ${results.invalidCsiRejectedReadable} -> ${JSON.stringify(errMsg)}`);

  const pkgsAfterInvalid = await listPkgs();
  const invalidCreated = pkgsAfterInvalid.some((p) => p.tradeName === "QA Invalid CSI Package");
  results.invalidCsiNotCreated = !invalidCreated ? "PASS" : "FAIL";
  say(`invalid package created? ${invalidCreated} -> ${results.invalidCsiNotCreated}`);

  // close modal
  await clickButtonByText(page, "Cancel");
  await delay(600);

  // ---------- ITEM 3 alternative: past bid deadline (min attr removed first) ----------
  const open2 = await clickButtonByText(page, "Create Trade Package");
  say(`reopen modal for past-deadline probe -> ${JSON.stringify(open2)}`);
  await delay(500);
  await setInputValue(page, 'input[placeholder="e.g. 26 00 00"]', "31 00 00");
  await setInputValue(page, 'input[placeholder="e.g. Electrical & Lighting Systems"]', "QA Past Deadline Package");
  await setInputValue(page, 'input[type="number"]', "100000");
  await setInputValue(page, 'textarea[placeholder="Scope details..."]', "QA past deadline probe.");
  const minRemoved = await page.evaluate(() => {
    const el = document.querySelector('input[type="date"]');
    if (!el) return { ok: false };
    const min = el.getAttribute("min");
    el.removeAttribute("min");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, "2026-01-01");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, removedMin: min, value: el.value, valid: el.checkValidity() };
  });
  say(`past-deadline setup: ${JSON.stringify(minRemoved)}`);
  const submit2 = await clickButtonByText(page, "Create Package");
  say(`submit past deadline -> ${JSON.stringify(submit2)}`);
  await delay(1500);
  const st2 = await modalState();
  say(`modal after past-deadline submit: ${JSON.stringify(st2)}`);
  await shot(page, "remediation-qa7-03-02-past-deadline-error.png");
  const err2 = st2?.errorText || "";
  results.pastDeadlineRejectedReadable =
    err2.length > 0 && err2.includes("past") && !err2.includes("[CONVEX") ? "PASS" : "FAIL";
  say(`readable past-deadline error: ${results.pastDeadlineRejectedReadable} -> ${JSON.stringify(err2)}`);

  const pkgsAfterPast = await listPkgs();
  results.pastDeadlineNotCreated = !pkgsAfterPast.some((p) => p.tradeName === "QA Past Deadline Package") ? "PASS" : "FAIL";
  say(`past-deadline package created? ${!results.pastDeadlineNotCreated} -> ${results.pastDeadlineNotCreated}`);

  await clickButtonByText(page, "Cancel");
  await delay(600);

  // ---------- ITEM 5b: valid CSI 03 30 00 still works ----------
  const open3 = await clickButtonByText(page, "Create Trade Package");
  say(`open modal for valid CSI -> ${JSON.stringify(open3)}`);
  await delay(500);
  await setInputValue(page, 'input[placeholder="e.g. 26 00 00"]', "03 30 00");
  await setInputValue(page, 'input[placeholder="e.g. Electrical & Lighting Systems"]', "QA Valid CSI Package");
  await setInputValue(page, 'input[type="number"]', "500000");
  await setInputValue(page, 'textarea[placeholder="Scope details..."]', "QA valid division probe.");
  await delay(300);
  await shot(page, "remediation-qa7-05-01-valid-csi-form.png");
  const submit3 = await clickButtonByText(page, "Create Package");
  say(`submit valid CSI -> ${JSON.stringify(submit3)}`);
  await page.waitForFunction(() => document.body.innerText.includes("QA Valid CSI Package"), { timeout: 30000 });
  await delay(1200);
  const st3 = await modalState();
  const pkgsAfterValid = await listPkgs();
  const validPkg = pkgsAfterValid.find((p) => p.tradeName === "QA Valid CSI Package");
  say(`valid package created: ${validPkg ? JSON.stringify({ id: validPkg._id, csi: validPkg.csiDivision }) : "NO"}; modal open=${Boolean(st3?.open)}`);
  results.validCsiCreated = validPkg && validPkg.csiDivision === "03 30 00" ? "PASS" : "FAIL";
  await shot(page, "remediation-qa7-05-02-valid-csi-created.png");

  const diagSummary = summarizeDiagnostics(diag);
  say(`diagnostics: ${JSON.stringify(diagSummary)}`);
  results.zeroConsoleErrors = diagSummary.consoleErrors.length === 0 && diagSummary.pageErrors.length === 0 ? "PASS" : "FAIL";

  const overall = Object.values(results).every((v) => v === "PASS") ? "PASS" : "FAIL";
  say(`ITEMS 3+5 RESULT: ${overall}`);
  say(`CHECKS: ${JSON.stringify(results)}`);
  console.log(
    "JSON_RESULT " +
      JSON.stringify({ items: [3, 5], result: overall, checks: results, validPackage: validPkg, diagnostics: diagSummary })
  );
  writeLog("remediation-qa7-03-05-csi-log.txt", log);

  fixtures.validPackage = validPkg ? { id: validPkg._id, tradeName: validPkg.tradeName } : null;
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa7-fixtures.json"), JSON.stringify(fixtures, null, 2), "utf8");
  process.exitCode = overall === "PASS" ? 0 : 1;
} catch (err) {
  say(`ERROR: ${err && err.stack ? err.stack : err}`);
  const diagSummary = summarizeDiagnostics(diag);
  say(`diagnostics at failure: ${JSON.stringify(diagSummary)}`);
  console.log("JSON_RESULT " + JSON.stringify({ items: [3, 5], result: "FAIL", error: String(err), checks: results, diagnostics: diagSummary }));
  writeLog("remediation-qa7-03-05-csi-log.txt", log);
  process.exitCode = 1;
} finally {
  await browser.close();
}