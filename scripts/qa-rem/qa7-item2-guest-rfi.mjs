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

const fixtures = JSON.parse(
  fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa7-fixtures.json"), "utf8")
);
const project = fixtures.project;
say(`QA7 ITEM 2 (guest RFI) at ${new Date().toISOString()}`);
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
async function listPkgs() {
  return withRetry("listPkgs", () => client.query("tradePackages:listByProject", { projectId: project.id }));
}
async function listContractors(pkgId) {
  return withRetry("listContractors", () => client.query("contractors:listByPackage", { tradePackageId: pkgId }));
}
async function listConvos(pkgId) {
  return withRetry("listConvos", () => client.query("rfq:listConversations", { tradePackageId: pkgId }));
}

const { browser } = await launchBrowser();
const context =
  typeof browser.createBrowserContext === "function"
    ? await browser.createBrowserContext()
    : await browser.createIncognitoBrowserContext();
const page = await context.newPage();
const diag = attachDiagnostics(page);

const selectProjectById = async (id) => {
  await page.select('select[aria-label="Select Commercial Construction Project"]', id);
};

let pkg = null;
try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(1000);

  await selectProjectById(project.id);
  await delay(1200);
  const sel = await getSelectorState(page);
  say(`selected project: ${JSON.stringify(sel?.selectedText)}`);
  if (sel?.value !== project.id) throw new Error(`project selection mismatch: ${sel?.value}`);

  // fresh package via UI (idempotent: reuse if a previous partial run created it)
  const before = await listPkgs();
  say(`packages before: ${before.length} (${before.map((p) => p.tradeName).join(", ") || "none"})`);
  const existing = before.find((p) => p.tradeName === "QA Guest RFI Package");
  if (existing) {
    pkg = existing;
    say(`existing fixture package reused (no creation needed): id=${pkg._id}`);
    results.packageCreated = "PASS";
  } else {
    const openBtn = await clickButtonByText(page, "Create Trade Package");
    say(`click Create Trade Package -> ${JSON.stringify(openBtn)}`);
    await delay(600);
    await shot(page, "remediation-qa7-02-00-package-modal.png");

    const fill = async (sel2, val) => setInputValue(page, sel2, val);
    await fill('input[placeholder="e.g. 26 00 00"]', "27 00 00");
    await fill('input[placeholder="e.g. Electrical & Lighting Systems"]', "QA Guest RFI Package");
    await fill('input[type="number"]', "250000");
    await fill('textarea[placeholder="Scope details..."]', "QA round 3 guest RFI fixture scope.");
    await delay(300);
    await shot(page, "remediation-qa7-02-01-package-form.png");
    const createPkg = await clickButtonByText(page, "Create Package");
    say(`click Create Package -> ${JSON.stringify(createPkg)}`);
    await page.waitForFunction(() => document.body.innerText.includes("QA Guest RFI Package"), { timeout: 30000 });
    await delay(800);

    const pkgs = await listPkgs();
    pkg = pkgs.find((p) => p.tradeName === "QA Guest RFI Package");
    say(`package created: id=${pkg?._id} csi=${pkg?.csiDivision} budget=${pkg?.budgetEstimate}`);
    results.packageCreated = pkg ? "PASS" : "FAIL";
  }

  const contractorsBefore = pkg ? await listContractors(pkg._id) : [];
  say(`contractors on fresh package BEFORE guest RFI: ${contractorsBefore.length} (${contractorsBefore.map((c) => c.companyName).join(", ") || "none"})`);
  results.zeroContractorsBefore = contractorsBefore.length === 0 ? "PASS" : "FAIL";

  // select package card (click card containing trade name)
  const cardClick = await page.evaluate(() => {
    const h3 = [...document.querySelectorAll("h3")].find((x) => (x.textContent || "").trim() === "QA Guest RFI Package");
    if (!h3) return { ok: false, reason: "card not found" };
    const card = h3.closest("div[class*='cursor-pointer']") || h3.closest("div");
    card.click();
    return { ok: true };
  });
  say(`select package card -> ${JSON.stringify(cardClick)}`);
  await delay(800);

  // Pre-Bid Q&A tab
  const qnaTab = await page.evaluate(() => {
    const header = document.querySelector("header");
    const btn = [...header.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Pre-Bid Q&A"));
    if (!btn) return false;
    btn.click();
    return true;
  });
  say(`click Pre-Bid Q&A tab -> ${qnaTab}`);
  await delay(1200);

  const formState = await page.evaluate(() => {
    const select = [...document.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.value === "guest_contractor")
    );
    const subject = document.querySelector('input[placeholder="e.g. Hoisting responsibility for switchgear"]');
    const question = document.querySelector('textarea[placeholder="Ask a technical or scope coordination question..."]');
    const submit = [...document.querySelectorAll("button")].find((b) =>
      (b.textContent || "").includes("Submit RFI for Clarification")
    );
    return {
      guestOptionPresent: Boolean(select),
      selectValue: select?.value,
      selectOptions: select ? [...select.options].map((o) => ({ value: o.value, text: o.textContent.trim() })) : [],
      subjectPresent: Boolean(subject),
      questionPresent: Boolean(question),
      submitPresent: Boolean(submit),
      submitDisabled: submit?.disabled,
    };
  });
  say(`Q&A form state: ${JSON.stringify(formState)}`);
  results.guestOptionPresent = formState.guestOptionPresent ? "PASS" : "FAIL";
  await shot(page, "remediation-qa7-02-02-before-submit.png");

  await setInputValue(
    page,
    'input[placeholder="e.g. Hoisting responsibility for switchgear"]',
    "QA-REM guest hoisting responsibility"
  );
  await setInputValue(
    page,
    'textarea[placeholder="Ask a technical or scope coordination question..."]',
    "As an inquiring subcontractor with no registered bidder record: does the Division 27 base scope include crane hoisting and rigging for rooftop communications equipment?"
  );
  await delay(300);
  await shot(page, "remediation-qa7-02-03-filled-before-submit.png");

  const tSubmit = Date.now();
  const submitted = await clickButtonByText(page, "Submit RFI for Clarification");
  say(`click Submit RFI -> ${JSON.stringify(submitted)} at t0`);

  // wait for toast / completion of the mutation call
  let sawSuccessToast = false;
  let sawFailureToast = null;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const text = await bodyText(page);
    if (text.includes("RFI submitted to TradePulse autonomous AI clarification engine")) {
      sawSuccessToast = true;
      break;
    }
    const failMatch = text.match(/RFI clarification failed:[^\n]*/);
    if (failMatch) {
      sawFailureToast = failMatch[0];
      break;
    }
    await delay(500);
  }
  say(`success toast seen=${sawSuccessToast}; failure toast=${sawFailureToast || "none"} (t+${Date.now() - tSubmit}ms)`);
  results.successToast = sawSuccessToast ? "PASS" : "FAIL";
  await shot(page, "remediation-qa7-02-04-after-submit.png");

  // poll for the RFI conversation to appear in the UI
  let appeared = false;
  let appearedAt = null;
  const appDeadline = Date.now() + 150000;
  while (Date.now() < appDeadline) {
    const text = await bodyText(page);
    if (text.includes("QA-REM guest hoisting responsibility")) {
      appeared = true;
      appearedAt = Date.now() - tSubmit;
      break;
    }
    await delay(3000);
  }
  say(`RFI conversation visible in UI: ${appeared} (t+${appearedAt ?? "n/a"}ms)`);
  results.rfiAppearsInUi = appeared ? "PASS" : "FAIL";
  if (appeared) await shot(page, "remediation-qa7-02-05-rfi-appeared.png");
  else await shot(page, "remediation-qa7-02-05-rfi-not-appeared.png");

  const convos = await listConvos(pkg._id);
  say(`backend conversations for package: ${convos.length}`);
  for (const c of convos) {
    say(
      `  - status=${c.status} subject=${JSON.stringify(c.inboundSubject)} question=${JSON.stringify((c.inboundQuestion || "").slice(0, 90))} reply=${JSON.stringify((c.autonomousReply || "").slice(0, 90))}`
    );
  }
  results.rfiPersistedBackend = convos.length >= 1 ? "PASS" : "FAIL";
  const guestContractors = await listContractors(pkg._id);
  say(`contractors after guest RFI: ${guestContractors.map((c) => `${c.companyName}(${c.rfqStatus})`).join(", ")}`);

  const diagSummary = summarizeDiagnostics(diag);
  const convexErrorEvidence = diagSummary.consoleErrors.filter((e) => e.includes("[CONVEX") || e.includes("submitCustomRfi"));
  results.noUnhandledConvexError = convexErrorEvidence.length === 0 && diagSummary.pageErrors.length === 0 ? "PASS" : "FAIL";
  say(`diagnostics: ${JSON.stringify(diagSummary)}`);
  say(`unhandled convex/rfi error evidence: ${JSON.stringify(convexErrorEvidence)}`);

  const overall = Object.values(results).every((v) => v === "PASS") ? "PASS" : "FAIL";
  say(`ITEM 2 RESULT: ${overall}`);
  say(`CHECKS: ${JSON.stringify(results)}`);
  console.log(
    "JSON_RESULT " +
      JSON.stringify({
        item: 2,
        result: overall,
        checks: results,
        package: pkg,
        conversationCount: convos.length,
        conversations: convos.map((c) => ({ status: c.status, subject: c.inboundSubject })),
        diagnostics: diagSummary,
      })
  );
  writeLog("remediation-qa7-02-guest-rfi-log.txt", log);

  // persist package id for later items
  fixtures.package = { id: pkg._id, tradeName: pkg.tradeName, csiDivision: pkg.csiDivision };
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa7-fixtures.json"), JSON.stringify(fixtures, null, 2), "utf8");
  process.exitCode = overall === "PASS" ? 0 : 1;
} catch (err) {
  say(`ERROR: ${err && err.stack ? err.stack : err}`);
  const diagSummary = summarizeDiagnostics(diag);
  say(`diagnostics at failure: ${JSON.stringify(diagSummary)}`);
  console.log("JSON_RESULT " + JSON.stringify({ item: 2, result: "FAIL", error: String(err), checks: results, diagnostics: diagSummary }));
  writeLog("remediation-qa7-02-guest-rfi-log.txt", log);
  process.exitCode = 1;
} finally {
  await browser.close();
}