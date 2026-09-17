// QA-11 item 2e: guest RFI (no contractorId) on the QA-11 fixture package that has ZERO contractors.
// Verifies: guest option present, submit succeeds (toast), conversation appears in UI, persists in backend.
// Usage: node scripts/qa-rem/qa11-guest-rfi.mjs
import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import {
  EVIDENCE_DIR,
  BASE_URL,
  launchBrowser,
  attachDiagnostics,
  waitForAppReady,
  getSelectorState,
  setInputValue,
  clickButtonByText,
  bodyText,
  shot,
  writeLog,
  summarizeDiagnostics,
  delay,
} from "./qa1-lib.mjs";

const BACKEND = "https://brainy-skunk-440.convex.cloud";
const fixtures = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa11-fixtures.json"), "utf8"));
const TAG = fixtures.ui.tag;
const PID = fixtures.ui.projectId;
const PKG = fixtures.ui.packageId;
const SUBJECT = `QA-REM QA11 guest hoisting responsibility ${Date.now()}`;
const LOG = [];
const ev = (s) => { LOG.push(s); console.log(s); };
const results = {};
const client = new ConvexHttpClient(BACKEND);

const { browser } = await launchBrowser();
const context = await browser.createBrowserContext();
const page = await context.newPage();
page.setDefaultTimeout(30000);
const diag = attachDiagnostics(page);
const httpErrors = [];
page.on("response", (r) => { if (r.status() >= 400) httpErrors.push(`${r.status()} ${r.request().method()} ${r.url()}`); });

try {
  ev(`QA-11 ITEM 2e GUEST RFI ${new Date().toISOString()}`);
  ev(`fixture project=${TAG} [${PID}] package=[${PKG}] subject="${SUBJECT}"`);

  const contractorsBefore = await client.query("contractors:listByPackage", { tradePackageId: PKG });
  ev(`contractors BEFORE: ${contractorsBefore.length} [${contractorsBefore.map((c) => c.companyName).join(", ")}]`);
  results.zeroContractorsBefore = contractorsBefore.length === 0 ? "PASS" : "FAIL";
  const convosBefore = await client.query("rfq:listConversations", { tradePackageId: PKG });
  ev(`conversations BEFORE: ${convosBefore.length}`);
  results.zeroConvosBefore = convosBefore.length === 0 ? "PASS" : "FAIL";

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(1500);
  await page.select('select[aria-label="Select Commercial Construction Project"]', PID);
  await delay(2000);
  const sel = await getSelectorState(page);
  ev(`selected project: ${JSON.stringify(sel?.selectedText)}`);
  results.projectSelected = sel?.value === PID ? "PASS" : "FAIL";

  // select the package card
  const cardClick = await page.evaluate((tradeName) => {
    const h3 = [...document.querySelectorAll("h3")].find((x) => (x.textContent || "").trim() === tradeName);
    if (!h3) return { ok: false, reason: "card not found", h3s: [...document.querySelectorAll("h3")].map((x) => x.textContent.trim()).slice(0, 20) };
    const card = h3.closest("div[class*='cursor-pointer']") || h3.closest("div");
    card.click();
    return { ok: true };
  }, "Electrical & Lighting Systems (QA-11)");
  ev(`select package card -> ${JSON.stringify(cardClick)}`);
  results.packageCardSelected = cardClick.ok ? "PASS" : "FAIL";
  await delay(900);
  await shot(page, "remediation-qa11-18-guest-rfi-package-selected.png");

  // Pre-Bid Q&A tab
  const qnaTab = await page.evaluate(() => {
    const header = document.querySelector("header");
    const btn = [...header.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Pre-Bid Q&A"));
    if (!btn) return false;
    btn.click();
    return true;
  });
  ev(`click Pre-Bid Q&A tab -> ${qnaTab}`);
  await delay(1500);

  const formState = await page.evaluate(() => {
    const select = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "guest_contractor"));
    const subject = document.querySelector('input[placeholder="e.g. Hoisting responsibility for switchgear"]');
    const question = document.querySelector('textarea[placeholder="Ask a technical or scope coordination question..."]');
    const submit = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Submit RFI for Clarification"));
    return {
      guestOptionPresent: Boolean(select),
      selectOptions: select ? [...select.options].map((o) => ({ value: o.value, text: o.textContent.trim() })) : [],
      subjectPresent: Boolean(subject),
      questionPresent: Boolean(question),
      submitPresent: Boolean(submit),
      submitDisabled: submit?.disabled,
    };
  });
  ev(`Q&A form state: ${JSON.stringify(formState)}`);
  results.guestOptionPresent = formState.guestOptionPresent ? "PASS" : "FAIL";
  results.subjectAndQuestionPresent = formState.subjectPresent && formState.questionPresent ? "PASS" : "FAIL";

  await setInputValue(page, 'input[placeholder="e.g. Hoisting responsibility for switchgear"]', SUBJECT);
  await setInputValue(
    page,
    'textarea[placeholder="Ask a technical or scope coordination question..."]',
    "As an inquiring subcontractor with no registered bidder record: does the Division 26 base scope include crane hoisting and rigging for rooftop electrical equipment?"
  );
  await delay(300);
  await shot(page, "remediation-qa11-19-guest-rfi-filled.png");

  const tSubmit = Date.now();
  const submitted = await clickButtonByText(page, "Submit RFI for Clarification");
  ev(`click Submit RFI -> ${JSON.stringify(submitted)} at t0=${tSubmit}`);
  let sawSuccessToast = false;
  let sawFailureToast = null;
  {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const text = await bodyText(page);
      if (text.includes("RFI submitted to TradePulse autonomous AI clarification engine")) { sawSuccessToast = true; break; }
      const failMatch = text.match(/RFI clarification failed:[^\n]*/);
      if (failMatch) { sawFailureToast = failMatch[0]; break; }
      await delay(500);
    }
  }
  ev(`success toast seen=${sawSuccessToast}; failure toast=${sawFailureToast || "none"} (t+${Date.now() - tSubmit}ms)`);
  results.successToast = sawSuccessToast ? "PASS" : "FAIL";
  await shot(page, "remediation-qa11-20-guest-rfi-after-submit.png");

  let appeared = false;
  let appearedAt = null;
  {
    const appDeadline = Date.now() + 180000;
    while (Date.now() < appDeadline) {
      const text = await bodyText(page);
      if (text.includes(SUBJECT)) { appeared = true; appearedAt = Date.now() - tSubmit; break; }
      await delay(3000);
    }
  }
  ev(`RFI subject visible in UI: ${appeared} (t+${appearedAt ?? "n/a"}ms)`);
  results.rfiAppearsInUi = appeared ? "PASS" : "FAIL";
  await shot(page, appeared ? "remediation-qa11-21-guest-rfi-persisted.png" : "remediation-qa11-21-guest-rfi-not-appeared.png");

  const convos = await client.query("rfq:listConversations", { tradePackageId: PKG });
  ev(`backend conversations AFTER: ${convos.length}`);
  for (const c of convos) {
    ev(`  - status=${c.status} confidence=${c.confidence ?? "n/a"} subject=${JSON.stringify(c.inboundSubject)} replyLen=${(c.autonomousReply || "").length}`);
  }
  results.rfiPersistedBackend = convos.length >= 1 && convos.some((c) => (c.inboundSubject || "").includes("QA-REM QA11 guest hoisting")) ? "PASS" : "FAIL";
  const contractorsAfter = await client.query("contractors:listByPackage", { tradePackageId: PKG });
  ev(`contractors AFTER: ${contractorsAfter.map((c) => `${c.companyName}(${c.rfqStatus})`).join(", ") || "none"}`);

  const diagSummary = summarizeDiagnostics(diag);
  ev(`diagnostics: ${JSON.stringify(diagSummary)}`);
  ev(`http>=400: ${JSON.stringify(httpErrors)}`);
  results.noConsoleErrors = diagSummary.consoleErrors.length === 0 ? "PASS" : "FAIL";
  results.noPageErrors = diagSummary.pageErrors.length === 0 ? "PASS" : "FAIL";
  results.noFailedRequests = diagSummary.failedRequests.length === 0 ? "PASS" : "FAIL";

  const overall = Object.values(results).every((v) => v === "PASS") ? "PASS" : "FAIL";
  ev("");
  ev(`ITEM 2e OVERALL: ${overall}`);
  ev(`CHECKS: ${JSON.stringify(results)}`);
  console.log("JSON_RESULT " + JSON.stringify({ item: "2e", result: overall, checks: results, conversationCount: convos.length, conversations: convos.map((c) => ({ status: c.status, subject: c.inboundSubject, replyLen: (c.autonomousReply || "").length })), diagnostics: diagSummary, httpErrors }));

  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa11-guest-rfi.json"), JSON.stringify({
    at: new Date().toISOString(), subject: SUBJECT, checks: results,
    contractorsBefore: contractorsBefore.map((c) => c.companyName), contractorsAfter: contractorsAfter.map((c) => c.companyName),
    conversations: convos.map((c) => ({ status: c.status, subject: c.inboundSubject, replyLen: (c.autonomousReply || "").length, confidence: c.confidence })),
    appearedInUi: appeared, appearedAtMs: appearedAt, diagnostics: diagSummary, httpErrors,
  }, null, 2), "utf8");
  writeLog("remediation-qa11-guest-rfi.txt", LOG);
  process.exitCode = overall === "PASS" ? 0 : 1;
} catch (err) {
  ev(`ERROR: ${err && err.stack ? err.stack : err}`);
  const diagSummary = summarizeDiagnostics(diag);
  ev(`diagnostics at failure: ${JSON.stringify(diagSummary)}`);
  writeLog("remediation-qa11-guest-rfi.txt", LOG);
  console.log("JSON_RESULT " + JSON.stringify({ item: "2e", result: "FAIL", error: String(err), checks: results, diagnostics: diagSummary }));
  process.exitCode = 1;
} finally {
  await browser.close();
}