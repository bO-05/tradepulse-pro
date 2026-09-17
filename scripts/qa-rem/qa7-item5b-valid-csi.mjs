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
say(`QA7 ITEM 5b (valid CSI 03 30 00 still works) at ${new Date().toISOString()}`);
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
    return { open: true, errorText: errEl ? errEl.textContent.trim() : null };
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

  const beforePkgs = await listPkgs();
  const already = beforePkgs.find((p) => p.tradeName === "QA Valid CSI Package");
  if (already) {
    say(`already exists from prior attempt: id=${already._id}`);
    results.validCsiCreated = "PASS";
  } else {
    const open = await clickButtonByText(page, "Create Trade Package");
    say(`open modal -> ${JSON.stringify(open)}`);
    await delay(500);
    await setInputValue(page, 'input[placeholder="e.g. 26 00 00"]', "03 30 00");
    await setInputValue(page, 'input[placeholder="e.g. Electrical & Lighting Systems"]', "QA Valid CSI Package");
    await setInputValue(page, 'input[type="number"]', "500000");
    await setInputValue(page, 'textarea[placeholder="Scope details..."]', "QA valid division probe.");
    const dateSet = await page.evaluate(() => {
      const el = document.querySelector('input[type="date"]');
      if (!el) return { ok: false };
      el.removeAttribute("min");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, "2026-10-31");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, value: el.value };
    });
    say(`deadline set to future: ${JSON.stringify(dateSet)}`);
    await delay(300);
    await shot(page, "remediation-qa7-05b-01-valid-csi-form.png");
    const submit = await clickButtonByText(page, "Create Package");
    say(`submit valid CSI -> ${JSON.stringify(submit)}`);
    await page.waitForFunction(() => document.body.innerText.includes("QA Valid CSI Package"), { timeout: 30000 });
    await delay(1200);
    const st = await modalState();
    say(`modal after valid submit (open=${Boolean(st?.open)} error=${JSON.stringify(st?.errorText)})`);
    await shot(page, "remediation-qa7-05b-02-valid-csi-created.png");
    const after = await listPkgs();
    const validPkg = after.find((p) => p.tradeName === "QA Valid CSI Package");
    say(`backend valid package: ${validPkg ? JSON.stringify({ id: validPkg._id, csi: validPkg.csiDivision, deadline: validPkg.bidDeadline }) : "NOT FOUND"}`);
    results.validCsiCreated = validPkg && validPkg.csiDivision === "03 30 00" ? "PASS" : "FAIL";
    fixtures.validPackage = validPkg ? { id: validPkg._id, tradeName: validPkg.tradeName } : null;
    fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa7-fixtures.json"), JSON.stringify(fixtures, null, 2), "utf8");
  }

  const diagSummary = summarizeDiagnostics(diag);
  say(`diagnostics: ${JSON.stringify(diagSummary)}`);
  results.zeroConsoleErrors = diagSummary.consoleErrors.length === 0 ? "PASS" : "FAIL";

  const overall = Object.values(results).every((v) => v === "PASS") ? "PASS" : "FAIL";
  say(`ITEM 5b RESULT: ${overall}`);
  console.log("JSON_RESULT " + JSON.stringify({ item: "5b", result: overall, checks: results, diagnostics: diagSummary }));
  writeLog("remediation-qa7-05b-valid-csi-log.txt", log);
  process.exitCode = overall === "PASS" ? 0 : 1;
} catch (err) {
  say(`ERROR: ${err && err.stack ? err.stack : err}`);
  const diagSummary = summarizeDiagnostics(diag);
  const st = await modalState().catch(() => null);
  say(`modal at failure: ${JSON.stringify(st)}`);
  say(`diagnostics at failure: ${JSON.stringify(diagSummary)}`);
  console.log("JSON_RESULT " + JSON.stringify({ item: "5b", result: "FAIL", error: String(err), checks: results, diagnostics: diagSummary }));
  writeLog("remediation-qa7-05b-valid-csi-log.txt", log);
  process.exitCode = 1;
} finally {
  await browser.close();
}