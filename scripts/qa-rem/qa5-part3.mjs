import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
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
  saveState,
  dismissDemoTour,
  clickStage,
  clickVisibleButton,
  getToast,
  waitFor,
} from "./qa5-lib.mjs";

const state = loadState();
const PROJECT_TITLE = state.projectTitle;
const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const TARGET_CSI = "03 30 00";
const SUB_A = "QA5 Exclusion Sub";
const SUB_B = "QA5 Absurd Dollar Sub";
const DL_DIR = path.join(os.tmpdir(), "qa5-downloads");

const { say, write } = makeLog("remediation-qa5-part3-log.txt");
say(`=== QA-5 PART 3 (Rows 7-8: bids, leveling, CSV, award, execution, lock) ===`);
say(`SITE: ${BASE_URL}`);
say(`UTC START: ${new Date().toISOString()}`);
say(`PROJECT: ${PROJECT_TITLE}`);

fs.rmSync(DL_DIR, { recursive: true, force: true });
fs.mkdirSync(DL_DIR, { recursive: true });

const consoleEvents = [];
const pageErrors = [];
const failedRequests = [];
const httpErrors = [];
const results = {};
let currentRow = "row7";
const step = (row, msg, observed) => {
  say(`[${row}] ${msg}`);
  if (observed !== undefined) say(`[${row}]   observed: ${typeof observed === "string" ? observed : JSON.stringify(observed)}`);
};

const { browser, executablePath } = await launchBrowser();
say(`EXECUTABLE: ${executablePath}`);
const page = await browser.newPage();
page.on("console", (m) => consoleEvents.push({ type: m.type(), text: m.text(), at: Date.now() }));
page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));
page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${r.url()} :: ${r.failure() ? r.failure().errorText : "?"}`));
page.on("response", (res) => {
  if (res.status() >= 400) httpErrors.push(`${res.request().method()} ${res.url()} -> ${res.status()}`);
});

const client = new ConvexHttpClient(BACKEND);
let projectId = null;
let packageId = null;

async function ensureLevelingTab() {
  await clickStage(page, "Bid Leveling");
  await waitFor(page, () => document.body.innerText.includes("Real-Time Forensic Bid Leveling Matrix") || document.body.innerText.includes("Bid Leveling"), 15000, 500);
  await delay(1000);
  const header = await page.evaluate(() => {
    const m = document.body.innerText.match(/CSI (\d{2} \d{2} \d{2})/);
    return m ? m[1] : null;
  });
  if (header !== TARGET_CSI) {
    const switched = await page.evaluate((csi) => {
      const btns = [...document.querySelectorAll("button")].filter((b) => b.offsetParent !== null && (b.textContent || "").trim().startsWith(csi));
      if (!btns.length) return { ok: false };
      btns[0].click();
      return { ok: true, text: btns[0].textContent.trim() };
    }, TARGET_CSI);
    step("row7", `switch leveling trade to ${TARGET_CSI}`, switched);
    await delay(1500);
  }
  return await page.evaluate(() => {
    const m = document.body.innerText.match(/CSI (\d{2} \d{2} \d{2})/);
    return m ? m[1] : null;
  });
}

async function ingestBid({ subName, quoteText, fileName }) {
  const open = await clickVisibleButton(page, "Ingest Quote / PDF");
  step("row7", "open ingest modal", open);
  await waitFor(page, () => document.body.innerText.includes("Direct Quote / PDF Bid Ingestion"), 10000, 300);
  const sel = await page.evaluate(() => {
    const selects = [...document.querySelectorAll("select")].filter((s) => s.offsetParent !== null);
    const sel = selects[0];
    if (!sel) return { ok: false, count: 0, options: [] };
    const opt = [...sel.options].find((o) => /Enter Custom/.test(o.textContent));
    if (!opt) return { ok: false, count: selects.length, options: [...sel.options].map((o) => o.textContent.trim()) };
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(sel, opt.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: opt.value };
  });
  step("row7", "select custom contractor option", sel);
  await delay(500);
  const nameFill = await page.evaluate((name) => {
    const input = [...document.querySelectorAll("input")].find((i) => i.offsetParent !== null && (i.placeholder || "").includes("Enter Subcontractor Company Name"));
    if (!input) return { ok: false };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: input.value };
  }, subName);
  step("row7", "set custom bidder name", nameFill);
  const fileFill = await page.evaluate((fn) => {
    const input = [...document.querySelectorAll("input")].find((i) => i.offsetParent !== null && (i.placeholder || "").includes("Acme_Electrical"));
    if (!input) return { ok: false };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, fn);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: input.value };
  }, fileName);
  step("row7", "set proposal filename", fileFill);
  const textFill = await page.evaluate((txt) => {
    const areas = [...document.querySelectorAll("textarea")].filter((t) => t.offsetParent !== null);
    const area = areas[areas.length - 1];
    if (!area) return { ok: false };
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(area, txt);
    area.dispatchEvent(new Event("input", { bubbles: true }));
    area.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, length: area.value.length };
  }, quoteText);
  step("row7", "set quote text", textFill);
  await shot(page, `remediation-qa5-p3-ingest-${subName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`);

  const t0 = Date.now();
  await clickVisibleButton(page, "Extract & Level Bid");
  let outcome = null;
  while (Date.now() - t0 < 210000) {
    const now = await page.evaluate((name) => {
      const t = document.body.innerText;
      if (/Bid ingestion failed/.test(t)) {
        const m = t.match(/Bid ingestion failed:[^\n]*/);
        return { kind: "error", text: m ? m[0] : null };
      }
      const card = [...document.querySelectorAll("h3")].some((h) => (h.textContent || "").includes(name));
      if (card && !t.includes("Direct Quote / PDF Bid Ingestion")) return { kind: "success" };
      return { kind: "running" };
    }, subName);
    if (now.kind === "error") {
      outcome = { ...now, elapsedMs: Date.now() - t0 };
      break;
    }
    if (now.kind === "success") {
      outcome = { kind: "success", elapsedMs: Date.now() - t0 };
      break;
    }
    await delay(3000);
  }
  step("row7", `ingest outcome for ${subName}`, outcome || { kind: "timeout", elapsedMs: Date.now() - t0 });
  await shot(page, `remediation-qa5-p3-after-${subName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`);
  return outcome;
}

async function fetchBackendBids() {
  const projects = await client.query("projects:listProjects", {});
  const project = projects.find((p) => p.title === PROJECT_TITLE);
  if (!project) return { error: "project not found" };
  projectId = project._id;
  const packages = await client.query("tradePackages:listByProject", { projectId });
  const pkg = packages.find((p) => p.csiDivision === TARGET_CSI);
  packageId = pkg ? pkg._id : null;
  const bids = packageId ? await client.query("bids:listByPackage", { tradePackageId: packageId }) : [];
  const recomputed = bids.map((b) => {
    const exclusions = b.identifiedExclusions || [];
    const alternates = b.valueEngineeringAlternates || [];
    const activeExclusions = exclusions.reduce((s, x) => (x.isWaived ? s : s + (x.costImpact || 0)), 0);
    const acceptedAlternates = alternates.reduce((s, x) => (x.isAccepted ? s + (x.costDeduct || 0) : s), 0);
    const rec = Math.max(0, b.baseBidAmount + activeExclusions + (b.leadTimePenalty || 0) + (b.coiPenalty || 0) - acceptedAlternates);
    return {
      id: b._id,
      name: b.subcontractorName,
      base: b.baseBidAmount,
      exclusions: exclusions.map((x) => ({ d: x.description, impact: x.costImpact, waived: !!x.isWaived })),
      activeExclusions,
      alternates: alternates.map((x) => ({ d: x.description, deduct: x.costDeduct, accepted: !!x.isAccepted })),
      leadWeeks: b.longLeadEquipmentWeeks,
      leadPenalty: b.leadTimePenalty || 0,
      coi: b.coiComplianceStatus,
      coiPenalty: b.coiPenalty || 0,
      displayed: b.leveledTotalCost,
      recomputed: rec,
      match: rec === b.leveledTotalCost,
      awarded: !!b.isAwarded,
    };
  });
  return { projectId, packageId, bids: recomputed };
}

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await dismissDemoTour(page);
  const sel = await getSelectorState(page);
  if (!(sel && sel.selectedText && sel.selectedText.includes(PROJECT_TITLE))) {
    await selectProjectByTitle(page, PROJECT_TITLE);
    await delay(1500);
  }

  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL_DIR, eventsEnabled: true });

  // ================= ROW 7: two bids + leveling + CSV =================
  currentRow = "row7";
  let activeCsi = await ensureLevelingTab();
  step("row7", "active leveling package", activeCsi);

  const bid1 = await ingestBid({
    subName: SUB_A,
    fileName: "QA5_Exclusion_Bid.pdf",
    quoteText:
      "PROPOSAL AND QUOTATION\nProject: QA-REM-QA5-E2E Structural Concrete\nBase Bid Price: $250,000.00\nEXCLUSIONS:\n- Concrete pump truck and crane hoisting excluded (GC to furnish pump and rigging)\nLead time on post-tensioning steel: 8 weeks.\nInsurance: Standard statutory limits (Umbrella endorsement fee not included).",
  });
  await delay(2000);
  const bid2 = await ingestBid({
    subName: SUB_B,
    fileName: "QA5_Absurd_One_Dollar_Bid.pdf",
    quoteText:
      "PROPOSAL AND QUOTATION\nProject: QA-REM-QA5-E2E Structural Concrete\nBase Bid Price: $1.00\nSCOPE INCLUSIONS (100% COMPLETE):\n- Turnkey structural formwork, shoring, and post-tensioning INCLUDED\n- Concrete pumping, placement and hard trowel finishing INCLUDED\nLead time: 3 weeks.\nInsurance: Fully compliant ACORD 25 with $5M Umbrella.",
  });
  await delay(2500);

  const bodyBids = await page.evaluate(() => document.body.innerText);
  const bidCards = await page.evaluate(() => {
    return [...document.querySelectorAll("h3")].filter((h) => /QA5 /.test(h.textContent || "")).map((h) => {
      let el = h;
      for (let i = 0; i < 8 && el; i++) {
        el = el.parentElement;
        if (!el) break;
        if ((el.textContent || "").includes("True Leveled Cost") && (el.textContent || "").length < 4000) {
          return el.innerText.slice(0, 1200);
        }
      }
      return null;
    }).filter(Boolean);
  });
  step("row7", "bid cards visible", { count: bidCards.length, cards: bidCards });
  await shot(page, "remediation-qa5-p3-01-row7-two-bids.png");

  const backendBids = await fetchBackendBids();
  step("row7", "backend bid normalization + independent recompute", backendBids);
  await shot(page, "remediation-qa5-p3-02-row7-leveling-matrix.png");

  await clickVisibleButton(page, "Export Leveling CSV");
  let csvFile = null;
  const tCsv = Date.now();
  while (Date.now() - tCsv < 20000) {
    const files = fs.existsSync(DL_DIR) ? fs.readdirSync(DL_DIR).filter((f) => f.toLowerCase().endsWith(".csv")) : [];
    if (files.length > 0) {
      const src = path.join(DL_DIR, files[0]);
      if (fs.statSync(src).size > 100) {
        csvFile = src;
        break;
      }
    }
    await delay(500);
  }
  let csvEvidence = null;
  let csvContent = null;
  if (csvFile) {
    csvEvidence = path.join(EVIDENCE_DIR, "remediation-qa5-part3-leveling-export.csv");
    fs.copyFileSync(csvFile, csvEvidence);
    csvContent = fs.readFileSync(csvFile, "utf8");
    step("row7", "CSV export downloaded", { file: csvFile, evidence: csvEvidence, bytes: fs.statSync(csvFile).size, head: csvContent.split("\n").slice(0, 4) });
  } else {
    step("row7", "CSV export FAILED to download", { dlDir: DL_DIR, files: fs.existsSync(DL_DIR) ? fs.readdirSync(DL_DIR) : [] });
  }
  await shot(page, "remediation-qa5-p3-03-row7-csv-exported.png");

  const recomputeAllMatch = backendBids.bids ? backendBids.bids.every((b) => b.match) : false;
  const bothBids = backendBids.bids ? backendBids.bids.length >= 2 : false;
  results.row7 = {
    status: bid1 && bid1.kind === "success" && bid2 && bid2.kind === "success" && bothBids && recomputeAllMatch && csvFile ? "PASS" : "CHECK",
    bid1,
    bid2,
    backendBids,
    recomputeAllMatch,
    csvDownloaded: Boolean(csvFile),
    csvEvidence,
    csvHead: csvContent ? csvContent.split("\n").slice(0, 5) : null,
  };
  step("row7", "ROW 7 VERDICT", { status: results.row7.status, bothBids, recomputeAllMatch, csvDownloaded: Boolean(csvFile), bids: backendBids.bids });

  // ================= ROW 8: award -> A401 -> execution -> lock =================
  currentRow = "row8";
  const controlProbe = () =>
    page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")].filter((b) =>
        ["Leveling Locked", "Adjust Leveling", "Adjust"].includes((b.textContent || "").trim())
      );
      return btns.map((b) => ({ text: (b.textContent || "").trim(), disabled: b.disabled, title: b.getAttribute("title") }));
    });

  const preAwardControls = await controlProbe();
  step("row8", "adjust controls before award", preAwardControls);

  const winner = backendBids.bids ? [...backendBids.bids].sort((a, b) => a.recomputed - b.recomputed)[0] : null;
  step("row8", "lowest leveled winner (rank 1)", winner ? { name: winner.name, base: winner.base, leveled: winner.displayed } : null);

  const awardClick = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")]
      .filter((x) => x.offsetParent !== null)
      .find((x) => /Award Compliant Winner/.test(x.textContent || "") || /Award Subcontract & Generate/.test(x.textContent || ""));
    if (!b) return { ok: false };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true, text: (b.textContent || "").trim() };
  });
  step("row8", "click award", awardClick);
  const awardedWait = await waitFor(
    page,
    () => (document.body.innerText.includes("Contract Awarded • AIA A401 Generated") || /Subcontract Awarded/.test(document.body.innerText) ? true : null),
    90000,
    1000
  );
  step("row8", "award visible", awardedWait);
  await shot(page, "remediation-qa5-p3-04-row8-awarded.png");

  const agreeClick = await clickVisibleButton(page, "Inspect AIA A401");
  step("row8", "open agreement viewer", agreeClick);
  const viewerOpen = await waitFor(page, () => (document.body.innerText.includes("AIA Document A401") && document.body.innerText.includes("Subcontract Sum") ? true : null), 20000, 500);
  const agreementMeta = await page.evaluate(() => {
    const t = document.body.innerText;
    const num = t.match(/A401-[0-9-]+|AIA-A401-[0-9]+/);
    const sum = t.match(/Subcontract Sum\n\$[\d,]+/);
    return { number: num ? num[0] : null, sumLine: sum ? sum[0] : null };
  });
  step("row8", "agreement viewer metadata", agreementMeta);
  await shot(page, "remediation-qa5-p3-05-row8-agreement-viewer.png");

  const execClick = await clickVisibleButton(page, "Record External Execution");
  step("row8", "click Record External Execution", execClick);
  const confirmWait = await waitFor(page, () => (document.body.innerText.includes("Record external execution?") ? true : null), 8000, 300);
  step("row8", "confirm dialog visible", confirmWait);
  const execConfirm = await clickVisibleButton(page, "Record execution");
  step("row8", "click confirm Record execution", execConfirm);
  const executedWait = await waitFor(page, () => (document.body.innerText.includes("Execution recorded in TradePulse") ? true : null), 30000, 500);
  step("row8", "execution recorded banner", executedWait);
  await shot(page, "remediation-qa5-p3-06-row8-execution-recorded.png");
  await clickVisibleButton(page, "Close Viewer");
  await delay(1500);

  const postExecControls = await controlProbe();
  step("row8", "adjust controls after execution", postExecControls);
  const locked = postExecControls.find((c) => c.text === "Leveling Locked" || (c.text === "Adjust" && c.disabled));
  const forcedClick = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Leveling Locked");
    if (!b) return { found: false };
    b.click();
    return { found: true, disabled: b.disabled };
  });
  await delay(1200);
  const modalAfterClick = await page.evaluate(() => document.body.innerText.includes("Forensic Leveling Adjustments"));
  step("row8", "forced click on locked control", { forcedClick, adjustModalOpened: modalAfterClick });
  await shot(page, "remediation-qa5-p3-07-row8-leveling-locked.png");

  const backendAfter = await fetchBackendBids();
  const agreements = projectId ? await client.query("agreements:listAgreements", { projectId }) : [];
  step("row8", "backend agreements after execution", agreements.map((a) => ({ number: a.agreementNumber, sub: a.subcontractorName, sum: a.contractSum, status: a.status, executedAt: a.executedAt })));

  const executedAgreement = agreements.find((a) => a.status === "executed");
  results.row8 = {
    status: awardedWait.ok && viewerOpen.ok && executedWait.ok && locked && !modalAfterClick && executedAgreement ? "PASS" : "CHECK",
    awardClick,
    awarded: awardedWait.ok,
    agreementNumber: agreementMeta.number,
    agreementSumLine: agreementMeta.sumLine,
    executionRecorded: executedWait.ok,
    lockedControl: locked || null,
    adjustModalOpenedAfterForcedClick: modalAfterClick,
    backendAgreements: agreements.map((a) => ({ number: a.agreementNumber, sub: a.subcontractorName, sum: a.contractSum, status: a.status })),
    backendBidsAfter: backendAfter.bids,
  };
  step("row8", "ROW 8 VERDICT", results.row8);

  results.diagnostics = {
    consoleErrors: consoleEvents.filter((e) => e.type === "error").map((e) => e.text),
    pageErrors,
    failedRequests,
    httpErrors,
  };
  say(`DIAGNOSTICS: ${JSON.stringify({ consoleErrors: results.diagnostics.consoleErrors.length, pageErrors: pageErrors.length, failedRequests: failedRequests.length, httpErrors: httpErrors.length })}`);
  saveState({ part3: results, part3At: new Date().toISOString() });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa5-part3-events.json"), JSON.stringify({ results, consoleEvents, pageErrors, failedRequests, httpErrors }, null, 2), "utf8");
  say(`QA5_RESULT ${JSON.stringify({ row7: { status: results.row7.status, bothBids, recomputeAllMatch, csvDownloaded: Boolean(csvFile) }, row8: results.row8 })}`);
  write();
} catch (err) {
  say(`FATAL in ${currentRow}: ${err && err.stack ? err.stack : err}`);
  say(`EVENTS: ${JSON.stringify({ consoleErrors: consoleEvents.filter((e) => e.type === "error").map((e) => e.text), pageErrors, failedRequests, httpErrors })}`);
  write();
  process.exitCode = 1;
} finally {
  await browser.close();
}