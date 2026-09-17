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

const fixtures = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa7-fixtures.json"), "utf8"));
const project = fixtures.project;
const pkgId = fixtures.validPackage.id;
say(`QA7 ITEM 4 (bid plausibility) at ${new Date().toISOString()}`);
say(`fixture project: ${project.title} [${project.id}]`);
say(`fixture package: QA Valid CSI Package [${pkgId}]`);

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
const listContractors = () =>
  withRetry("listContractors", () => client.query("contractors:listByPackage", { tradePackageId: pkgId }));
const listBids = () => withRetry("listBids", () => client.query("bids:listByPackage", { tradePackageId: pkgId }));
const readable = (e) => {
  if (!e) return "";
  if (e.data !== undefined) return typeof e.data === "string" ? e.data : JSON.stringify(e.data);
  return String(e.message || e);
};

const { browser } = await launchBrowser();
const context =
  typeof browser.createBrowserContext === "function"
    ? await browser.createBrowserContext()
    : await browser.createIncognitoBrowserContext();
const page = await context.newPage();
const diag = attachDiagnostics(page);

const ingestQuote = async (label, amountText, shotBefore, shotAfter) => {
  say(`--- INGEST ATTEMPT ${label} (quote base ${amountText}) ---`);
  const open = await clickButtonByText(page, "Ingest Quote / PDF");
  say(`open ingest modal -> ${JSON.stringify(open)}`);
  await delay(700);

  const modalInfo = await page.evaluate(() => {
    const h3 = [...document.querySelectorAll("h3")].find((h) => (h.textContent || "").trim() === "Direct Quote / PDF Bid Ingestion");
    const root = h3?.closest("div.fixed");
    if (!root) return { open: false };
    const sel = root.querySelector("select");
    const ta = root.querySelector("textarea");
    const newNameInput = root.querySelector('input[placeholder*="Subcontractor Company Name"]');
    return {
      open: true,
      selectValue: sel?.value,
      selectOptions: sel ? [...sel.options].map((o) => ({ value: o.value, text: o.textContent.trim() })) : [],
      newNameNeeded: Boolean(newNameInput),
    };
  });
  say(`ingest modal: ${JSON.stringify(modalInfo)}`);

  if (modalInfo.newNameNeeded) {
    await setInputValue(page, 'input[placeholder*="Subcontractor Company Name"]', "QA Plausibility Electric, LLC");
    await delay(200);
  }

  const quote = [
    "PROPOSAL AND QUOTATION",
    "Subcontractor: QA Plausibility Electric, LLC",
    `Project: QA round 3 bid plausibility fixture`,
    `Base Bid Price: ${amountText}`,
    "Scope: Complete Division 03 concrete scope including formwork, rebar, and placement.",
    "Lead time: 4 weeks.",
    "Insurance: Fully compliant ACORD 25 with $5M Umbrella.",
  ].join("\n");
  await setInputValue(page, 'textarea[placeholder*="Paste raw text or PDF transcript of vendor quote"]', quote);
  await setInputValue(page, 'input[placeholder*="Acme_Electrical_Final_Bid_Revision_2.pdf"]', `QA_${label}_quote.txt`);
  await delay(300);
  await shot(page, shotBefore);

  const click = await clickButtonByText(page, "Extract & Level Bid");
  say(`submit ${label} -> ${JSON.stringify(click)} at t0`);
  const t0 = Date.now();

  // poll: success (bid card / ranked) vs error banner vs toast
  let outcome = { kind: "timeout" };
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const h3 = [...document.querySelectorAll("h3")].find((h) => (h.textContent || "").trim() === "Direct Quote / PDF Bid Ingestion");
      const root = h3?.closest("div.fixed");
      const errDiv = root ? root.querySelector('div[role="alert"]') : null;
      const bodyText = document.body.innerText;
      return {
        modalOpen: Boolean(root),
        modalError: errDiv ? errDiv.textContent.trim() : null,
        toastFail: (bodyText.match(/Ingestion failed:[^\n]*/) || [])[0] || null,
        toastOk: bodyText.includes("Quote ingested, forensically parsed")
          ? "Quote ingested, forensically parsed, and normalized into Bid Leveling Matrix!"
          : null,
        rankOneVisible: bodyText.includes("Rank #1"),
      };
    });
    if (state.modalError) {
      outcome = { kind: "modal-error", ...state, elapsedMs: Date.now() - t0 };
      break;
    }
    if (state.toastFail) {
      outcome = { kind: "toast-fail", ...state, elapsedMs: Date.now() - t0 };
      break;
    }
    if (state.toastOk) {
      outcome = { kind: "success", ...state, elapsedMs: Date.now() - t0 };
      break;
    }
    await delay(3000);
  }
  say(`outcome ${label}: ${JSON.stringify(outcome)}`);
  await shot(page, shotAfter);
  return outcome;
};

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(1000);
  await page.select('select[aria-label="Select Commercial Construction Project"]', project.id);
  await delay(1200);
  const sel = await getSelectorState(page);
  say(`selected project: ${JSON.stringify(sel?.selectedText)}`);
  if (sel?.value !== project.id) throw new Error("fixture project not selected");

  // select QA Valid CSI Package card
  const cardClick = await page.evaluate(() => {
    const h3 = [...document.querySelectorAll("h3")].find((x) => (x.textContent || "").trim() === "QA Valid CSI Package");
    if (!h3) return { ok: false, reason: "card not found" };
    (h3.closest("div[class*='cursor-pointer']") || h3.closest("div")).click();
    return { ok: true };
  });
  say(`select package card -> ${JSON.stringify(cardClick)}`);
  await delay(800);

  // ---- Phase A: contractor via Discovery UI (if none) ----
  let contractors = await listContractors();
  say(`contractors before: ${contractors.length} (${contractors.map((c) => c.companyName).join(", ") || "none"})`);
  if (contractors.length === 0) {
    const discTab = await page.evaluate(() => {
      const header = document.querySelector("header");
      const btn = [...header.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Discovery"));
      if (!btn) return false;
      btn.click();
      return true;
    });
    say(`click Discovery tab -> ${discTab}`);
    await delay(1200);
    const addBtn = await clickButtonByText(page, "Add Contractor Manually");
    say(`click Add Contractor Manually -> ${JSON.stringify(addBtn)}`);
    await delay(600);
    await shot(page, "remediation-qa7-04-01-add-contractor-modal.png");
    await setInputValue(page, 'input[placeholder="e.g. Rosendin Electric, Inc."]', "QA Plausibility Electric, LLC");
    await setInputValue(page, 'input[placeholder="estimating@rosendin.com"]', "qa.plausibility@tradepulse-pro.test");
    await setInputValue(page, 'input[placeholder="e.g. TECL-38492"]', "QA-R3-0001");
    await setInputValue(page, 'input[placeholder="https://www.rosendin.com"]', "https://tradepulse-pro.test/qa");
    await delay(300);
    const addSubmit = await clickButtonByText(page, "Add to Directory");
    say(`submit contractor -> ${JSON.stringify(addSubmit)}`);
    await page.waitForFunction(() => document.body.innerText.includes("QA Plausibility Electric"), { timeout: 30000 });
    await delay(1200);
    await shot(page, "remediation-qa7-04-02-contractor-added.png");
    contractors = await listContractors();
  }
  say(`contractors on package: ${contractors.map((c) => `${c.companyName}[${c._id}]`).join(", ") || "none"}`);
  results.contractorPresent = contractors.length >= 1 ? "PASS" : "FAIL";

  const bidsBefore = await listBids();
  say(`bids before ingest attempts: ${bidsBefore.length}`);

  // ---- Phase B: $1 quote via UI ----
  const levelingTab = await page.evaluate(() => {
    const header = document.querySelector("header");
    const btn = [...header.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Bid Leveling"));
    if (!btn) return false;
    btn.click();
    return true;
  });
  say(`click Bid Leveling tab -> ${levelingTab}`);
  await delay(1200);
  await shot(page, "remediation-qa7-04-03-leveling-before.png");

  const one = await ingestQuote("dollar1", "$1.00", "remediation-qa7-04-04-dollar1-form.png", "remediation-qa7-04-05-dollar1-outcome.png");
  const oneMsg = one.modalError || one.toastFail || "";
  results.dollar1Rejected =
    one.kind !== "success" && oneMsg.length > 0 && !oneMsg.includes("[CONVEX") ? "PASS" : "FAIL";
  say(`$1 rejected with readable message: ${results.dollar1Rejected} -> ${JSON.stringify(oneMsg)}`);

  // close modal if still open
  const stillOpen1 = await page.evaluate(() => Boolean([...document.querySelectorAll("h3")].find((h) => h.textContent.trim() === "Direct Quote / PDF Bid Ingestion")));
  if (stillOpen1) {
    await clickButtonByText(page, "Cancel");
    await delay(600);
  }

  // ---- Phase C: $999,999,999 quote via UI ----
  const big = await ingestQuote(
    "big",
    "$999,999,999.00",
    "remediation-qa7-04-06-big-form.png",
    "remediation-qa7-04-07-big-outcome.png"
  );
  const bigMsg = big.modalError || big.toastFail || "";
  results.bigRejected = big.kind !== "success" && bigMsg.length > 0 && !bigMsg.includes("[CONVEX") ? "PASS" : "FAIL";
  say(`$999,999,999 rejected with readable message: ${results.bigRejected} -> ${JSON.stringify(bigMsg)}`);

  const stillOpen2 = await page.evaluate(() => Boolean([...document.querySelectorAll("h3")].find((h) => h.textContent.trim() === "Direct Quote / PDF Bid Ingestion")));
  if (stillOpen2) {
    await clickButtonByText(page, "Cancel");
    await delay(600);
  }

  // ---- Phase D: backend state / no ranked or awarded bid ----
  const bidsAfter = await listBids();
  const awarded = bidsAfter.filter((b) => b.isAwarded);
  say(`bids after attempts: ${bidsAfter.length} (${bidsAfter.map((b) => `${b.subcontractorName}=$${b.baseBidAmount}`).join(", ") || "none"})`);
  say(`awarded bids: ${awarded.length}`);
  results.noBidsCreated = bidsAfter.length === 0 ? "PASS" : "FAIL";
  results.nothingAwarded = awarded.length === 0 ? "PASS" : "FAIL";

  // ---- Phase E: backend probe (direct mutation) corroboration ----
  const contractorId = contractors[0]?._id;
  const probeResults = [];
  for (const amount of [1, 999999999]) {
    try {
      const res = await withRetry(`submitDirectBid($${amount})`, () =>
        client.mutation("bids:submitDirectBid", {
          tradePackageId: pkgId,
          contractorId,
          subcontractorName: "QA Plausibility Electric, LLC",
          baseBidAmount: amount,
        })
      );
      probeResults.push({ amount, accepted: true, result: res });
      say(`backend probe $${amount}: UNEXPECTED ACCEPTANCE ${JSON.stringify(res)}`);
    } catch (e) {
      const msg = readable(e);
      probeResults.push({ amount, accepted: false, message: msg, readable: Boolean(msg) && !msg.includes("[CONVEX") });
      say(`backend probe $${amount} rejected: ${JSON.stringify(msg)}`);
    }
  }
  results.backendProbeDollar1 = probeResults[0].accepted === false && probeResults[0].readable ? "PASS" : "FAIL";
  results.backendProbeBig = probeResults[1].accepted === false && probeResults[1].readable ? "PASS" : "FAIL";

  const bidsFinal = await listBids();
  results.noBidsAfterProbe = bidsFinal.length === 0 ? "PASS" : "FAIL";
  say(`bids after backend probe: ${bidsFinal.length} (${bidsFinal.map((b) => `$${b.baseBidAmount}`).join(", ") || "none"})`);

  // ---- UI final state: no rank #1, nothing awarded ----
  const uiText = await bodyText(page);
  results.noRankOneInUi = !uiText.includes("Rank #1") ? "PASS" : "FAIL";
  results.uiShowsNoProposals = uiText.includes("No Proposals Leveled in this Trade Package Yet") ? "PASS" : "FAIL";
  results.noAwardBanner = !uiText.includes("Subcontract Awarded") ? "PASS" : "FAIL";
  await shot(page, "remediation-qa7-04-08-leveling-final.png");

  const diagSummary = summarizeDiagnostics(diag);
  say(`diagnostics: ${JSON.stringify(diagSummary)}`);

  const hardChecks = [
    "contractorPresent",
    "dollar1Rejected",
    "bigRejected",
    "noBidsCreated",
    "nothingAwarded",
    "backendProbeDollar1",
    "backendProbeBig",
    "noBidsAfterProbe",
    "noRankOneInUi",
    "uiShowsNoProposals",
    "noAwardBanner",
  ];
  const overall = hardChecks.every((k) => results[k] === "PASS") ? "PASS" : "FAIL";
  say(`ITEM 4 RESULT: ${overall}`);
  say(`CHECKS: ${JSON.stringify(results)}`);
  console.log(
    "JSON_RESULT " +
      JSON.stringify({ item: 4, result: overall, checks: results, outcomes: { one, big }, probeResults, diagnostics: diagSummary })
  );
  writeLog("remediation-qa7-04-bids-log.txt", log);
  process.exitCode = overall === "PASS" ? 0 : 1;
} catch (err) {
  say(`ERROR: ${err && err.stack ? err.stack : err}`);
  const diagSummary = summarizeDiagnostics(diag);
  say(`diagnostics at failure: ${JSON.stringify(diagSummary)}`);
  console.log("JSON_RESULT " + JSON.stringify({ item: 4, result: "FAIL", error: String(err), checks: results, diagnostics: diagSummary }));
  writeLog("remediation-qa7-04-bids-log.txt", log);
  process.exitCode = 1;
} finally {
  await browser.close();
}