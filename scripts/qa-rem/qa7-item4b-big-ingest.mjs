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
const pkgId = fixtures.validPackage.id;
say(`QA7 ITEM 4b ($999,999,999 UI ingest, clean run) at ${new Date().toISOString()}`);
say(`fixture project: ${project.title} [${project.id}] | package ${pkgId}`);

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
const listBids = () => withRetry("listBids", () => client.query("bids:listByPackage", { tradePackageId: pkgId }));
const listContractors = () =>
  withRetry("listContractors", () => client.query("contractors:listByPackage", { tradePackageId: pkgId }));

const { browser } = await launchBrowser();
const context =
  typeof browser.createBrowserContext === "function"
    ? await browser.createBrowserContext()
    : await browser.createIncognitoBrowserContext();
const page = await context.newPage();
const diag = attachDiagnostics(page);

try {
  const bidsBefore = await listBids();
  const contractors = await listContractors();
  say(`bids before: ${bidsBefore.length}; contractors: ${contractors.map((c) => c.companyName).join(", ")}`);

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(1000);
  await page.select('select[aria-label="Select Commercial Construction Project"]', project.id);
  await delay(1200);
  const sel = await getSelectorState(page);
  if (sel?.value !== project.id) throw new Error("fixture project not selected");
  say(`selected project: ${JSON.stringify(sel?.selectedText)}`);

  const cardClick = await page.evaluate(() => {
    const h3 = [...document.querySelectorAll("h3")].find((x) => (x.textContent || "").trim() === "QA Valid CSI Package");
    if (!h3) return { ok: false };
    (h3.closest("div[class*='cursor-pointer']") || h3.closest("div")).click();
    return { ok: true };
  });
  say(`select package card -> ${JSON.stringify(cardClick)}`);
  await delay(800);

  const levelingTab = await page.evaluate(() => {
    const header = document.querySelector("header");
    const btn = [...header.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Bid Leveling"));
    if (!btn) return false;
    btn.click();
    return true;
  });
  say(`click Bid Leveling tab -> ${levelingTab}`);
  await delay(1200);

  // ensure no stale toast before starting
  const preText = await page.evaluate(() => document.body.innerText);
  const staleToast = (preText.match(/Ingestion failed:[^\n]*/) || [])[0] || null;
  say(`stale toast before submit: ${JSON.stringify(staleToast)}`);

  const open = await clickButtonByText(page, "Ingest Quote / PDF");
  say(`open ingest modal -> ${JSON.stringify(open)}`);
  await delay(700);

  const modalInfo = await page.evaluate(() => {
    const h3 = [...document.querySelectorAll("h3")].find((h) => (h.textContent || "").trim() === "Direct Quote / PDF Bid Ingestion");
    const root = h3?.closest("div.fixed");
    const sel2 = root?.querySelector("select");
    return { open: Boolean(root), selectValue: sel2?.value };
  });
  say(`ingest modal: ${JSON.stringify(modalInfo)}`);

  const quote = [
    "PROPOSAL AND QUOTATION",
    "Subcontractor: QA Plausibility Electric, LLC",
    "Project: QA round 3 bid plausibility fixture",
    "Base Bid Price: $999,999,999.00",
    "Scope: Complete Division 03 concrete scope including formwork, rebar, and placement.",
    "Lead time: 4 weeks.",
    "Insurance: Fully compliant ACORD 25 with $5M Umbrella.",
  ].join("\n");
  await setInputValue(page, 'textarea[placeholder*="Paste raw text or PDF transcript of vendor quote"]', quote);
  await setInputValue(page, 'input[placeholder*="Acme_Electrical_Final_Bid_Revision_2.pdf"]', "QA_big_quote.txt");
  await delay(300);
  await shot(page, "remediation-qa7-04b-01-big-form.png");

  const errsBefore = diag.consoleLogs.filter((l) => l.type === "error").length;
  const click = await clickButtonByText(page, "Extract & Level Bid");
  say(`submit big -> ${JSON.stringify(click)} at t0`);
  const t0 = Date.now();

  let outcome = { kind: "timeout" };
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const h3 = [...document.querySelectorAll("h3")].find((h) => (h.textContent || "").trim() === "Direct Quote / PDF Bid Ingestion");
      const root = h3?.closest("div.fixed");
      const errDiv = root ? root.querySelector('div[role="alert"]') : null;
      return {
        modalOpen: Boolean(root),
        modalError: errDiv ? errDiv.textContent.trim() : null,
        toastFail: (document.body.innerText.match(/Ingestion failed:[^\n]*/) || [])[0] || null,
        toastOk: document.body.innerText.includes("Quote ingested, forensically parsed")
          ? "Quote ingested, forensically parsed, and normalized into Bid Leveling Matrix!"
          : null,
      };
    });
    const newErrors = diag.consoleLogs.filter((l) => l.type === "error").length - errsBefore;
    if (state.modalError) {
      outcome = { kind: "modal-error", ...state, newErrors, elapsedMs: Date.now() - t0 };
      break;
    }
    if (state.toastOk) {
      outcome = { kind: "success", ...state, newErrors, elapsedMs: Date.now() - t0 };
      break;
    }
    if (state.toastFail && (state.toastFail.includes("999,999,999") || newErrors > 0)) {
      outcome = { kind: "toast-fail", ...state, newErrors, elapsedMs: Date.now() - t0 };
      break;
    }
    await delay(3000);
  }
  say(`outcome big (clean): ${JSON.stringify(outcome)}`);
  await shot(page, "remediation-qa7-04b-02-big-outcome.png");

  const msg = outcome.modalError || outcome.toastFail || "";
  results.bigRejected = outcome.kind !== "success" && msg.length > 0 && !msg.includes("[CONVEX") ? "PASS" : "FAIL";
  results.bigMessageMentionsAmount =
    msg.includes("999,999,999") || msg.includes("5x the $500,000") ? "PASS" : "FAIL";
  say(`big rejected readable: ${results.bigRejected} -> ${JSON.stringify(msg)}`);
  say(`big message mentions the big amount/ceiling: ${results.bigMessageMentionsAmount}`);

  if (outcome.modalOpen) {
    await clickButtonByText(page, "Cancel");
    await delay(600);
  }

  const bidsAfter = await listBids();
  const awarded = bidsAfter.filter((b) => b.isAwarded);
  say(`bids after big attempt: ${bidsAfter.length} (${bidsAfter.map((b) => `$${b.baseBidAmount}`).join(", ") || "none"}); awarded=${awarded.length}`);
  results.noBidsCreated = bidsAfter.length === 0 ? "PASS" : "FAIL";
  results.nothingAwarded = awarded.length === 0 ? "PASS" : "FAIL";

  const finalText = await page.evaluate(() => document.body.innerText);
  results.noRankOneInUi = !finalText.includes("Rank #1") ? "PASS" : "FAIL";
  results.uiShowsNoProposals = finalText.includes("No Proposals Leveled in this Trade Package Yet") ? "PASS" : "FAIL";
  results.noAwardBanner = !finalText.includes("Subcontract Awarded") ? "PASS" : "FAIL";
  await shot(page, "remediation-qa7-04b-03-leveling-final.png");

  const diagSummary = summarizeDiagnostics(diag);
  say(`diagnostics: ${JSON.stringify(diagSummary)}`);
  const soft = ["bigRejected", "bigMessageMentionsAmount", "noBidsCreated", "nothingAwarded", "noRankOneInUi", "uiShowsNoProposals", "noAwardBanner"];
  const overall = soft.every((k) => results[k] === "PASS") ? "PASS" : "FAIL";
  say(`ITEM 4b RESULT: ${overall}`);
  console.log("JSON_RESULT " + JSON.stringify({ item: "4b", result: overall, checks: results, outcome, diagnostics: diagSummary }));
  writeLog("remediation-qa7-04b-big-ingest-log.txt", log);
  process.exitCode = overall === "PASS" ? 0 : 1;
} catch (err) {
  say(`ERROR: ${err && err.stack ? err.stack : err}`);
  const diagSummary = summarizeDiagnostics(diag);
  say(`diagnostics at failure: ${JSON.stringify(diagSummary)}`);
  console.log("JSON_RESULT " + JSON.stringify({ item: "4b", result: "FAIL", error: String(err), checks: results, diagnostics: diagSummary }));
  writeLog("remediation-qa7-04b-big-ingest-log.txt", log);
  process.exitCode = 1;
} finally {
  await browser.close();
}