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
  setFieldByLabel,
  waitFor,
} from "./qa5-lib.mjs";

const state = loadState();
const PROJECT_TITLE = state.projectTitle;
const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const NEW_CSI = "03 31 00";
const SUB_A = "QA5 Exclusion Sub";
const SUB_B = "QA5 Dollar Sub";
const DL_DIR = path.join(os.tmpdir(), "qa5-downloads-b");

const { say, write } = makeLog("remediation-qa5-part3b-log.txt");
say(`=== QA-5 PART 3B (Row 7 clean run: 2 structured bids on a fresh package) ===`);
say(`SITE: ${BASE_URL}`);
say(`UTC START: ${new Date().toISOString()}`);
say(`PROJECT: ${PROJECT_TITLE} | NEW PACKAGE CSI: ${NEW_CSI}`);

fs.rmSync(DL_DIR, { recursive: true, force: true });
fs.mkdirSync(DL_DIR, { recursive: true });

const consoleEvents = [];
const pageErrors = [];
const failedRequests = [];
const httpErrors = [];
const results = {};
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

async function resolvePackageId() {
  const projects = await client.query("projects:listProjects", {});
  const project = projects.find((p) => p.title === PROJECT_TITLE);
  if (!project) return null;
  projectId = project._id;
  const packages = await client.query("tradePackages:listByProject", { projectId });
  const pkg = packages.find((p) => p.csiDivision === NEW_CSI);
  packageId = pkg ? pkg._id : null;
  return packageId;
}

async function backendBids() {
  if (!packageId) return [];
  return client.query("bids:listByPackage", { tradePackageId: packageId });
}

async function ingestBid({ subName, quoteText, fileName }) {
  step("row7b", `--- ingest begin: ${subName} ---`);
  const open = await clickVisibleButton(page, "Ingest Quote / PDF");
  step("row7b", "open ingest modal", open);
  const modalOpen = await waitFor(
    page,
    () => {
      const d = [...document.querySelectorAll("div")].find(
        (x) => typeof x.className === "string" && x.className.includes("fixed inset-0") && (x.innerText || "").includes("Direct Quote / PDF Bid Ingestion")
      );
      return d ? true : null;
    },
    10000,
    300
  );
  step("row7b", "modal visible", modalOpen);

  const setup = await page.evaluate(
    ({ name, fn, txt }) => {
      const dialog = [...document.querySelectorAll("div")].find(
        (x) => typeof x.className === "string" && x.className.includes("fixed inset-0") && (x.innerText || "").includes("Direct Quote / PDF Bid Ingestion")
      );
      if (!dialog) return { ok: false, reason: "dialog not found" };
      const setV = (el, v) => {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
        setter.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const select = dialog.querySelector("select");
      let selectAction = null;
      if (select) {
        const opt = [...select.options].find((o) => /Enter Custom/.test(o.textContent));
        if (opt) {
          setV(select, opt.value);
          selectAction = { chose: opt.textContent.trim() };
        }
      }
      const nameInput = [...dialog.querySelectorAll("input")].find((i) => (i.placeholder || "").includes("Enter Subcontractor Company Name"));
      if (!nameInput) return { ok: false, reason: "name input not rendered", selectAction };
      setV(nameInput, name);
      const fileInput = [...dialog.querySelectorAll("input")].find((i) => (i.placeholder || "").includes("Acme_Electrical"));
      if (fileInput) setV(fileInput, fn);
      const area = [...dialog.querySelectorAll("textarea")][0];
      if (!area) return { ok: false, reason: "textarea missing" };
      setV(area, txt);
      return { ok: true, selectAction, name: nameInput.value, file: fileInput ? fileInput.value : null, textLen: area.value.length };
    },
    { name: subName, fn: fileName, txt: quoteText }
  );
  step("row7b", "modal fields set", setup);
  await shot(page, `remediation-qa5-p3b-ingest-${subName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`);

  const before = (await backendBids()).length;
  const t0 = Date.now();
  const submit = await page.evaluate(() => {
    const dialog = [...document.querySelectorAll("div")].find(
      (x) => typeof x.className === "string" && x.className.includes("fixed inset-0") && (x.innerText || "").includes("Direct Quote / PDF Bid Ingestion")
    );
    if (!dialog) return { ok: false };
    const b = [...dialog.querySelectorAll("button")].find((x) => /Extract & Level Bid|Extracting & Normalizing/.test(x.textContent || ""));
    if (!b) return { ok: false, buttons: [...dialog.querySelectorAll("button")].map((x) => x.textContent.trim()) };
    b.click();
    return { ok: true, text: (b.textContent || "").trim() };
  });
  step("row7b", "submit clicked", submit);

  let outcome = null;
  while (Date.now() - t0 < 230000) {
    const now = await page.evaluate(() => {
      const t = document.body.innerText;
      if (/Bid ingestion failed/.test(t)) {
        const m = t.match(/Bid ingestion failed:[^\n]*/);
        return { kind: "error", text: m ? m[0] : null };
      }
      const stillModal = /Direct Quote \/ PDF Bid Ingestion/.test(t);
      return { kind: stillModal ? "running" : "closed" };
    });
    const bidsNow = await backendBids();
    if (bidsNow.length > before) {
      outcome = { kind: "success", elapsedMs: Date.now() - t0, bidsCount: bidsNow.length, viaBackend: true };
      break;
    }
    if (now.kind === "error") {
      outcome = { ...now, elapsedMs: Date.now() - t0 };
      break;
    }
    await delay(4000);
  }
  step("row7b", `ingest outcome for ${subName}`, outcome || { kind: "timeout", elapsedMs: Date.now() - t0 });
  await shot(page, `remediation-qa5-p3b-after-${subName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`);
  return outcome;
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

  // 1. Create the fresh package via UI
  await clickStage(page, "CSI Scoping");
  await waitFor(page, () => document.body.innerText.includes("Create Trade Package"), 15000, 500);
  await clickVisibleButton(page, "Create Trade Package");
  await waitFor(page, () => document.body.innerText.includes("Create CSI Trade Package"), 8000, 300);
  const deadline = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10);
  const fills = {
    csi: await setFieldByLabel(page, "CSI Division Number", NEW_CSI),
    name: await setFieldByLabel(page, "Trade Package Name", "QA5 Cast-In-Place Concrete"),
    budget: await setFieldByLabel(page, "Budget Estimate", "500000"),
    scope: await setFieldByLabel(page, "Scope Summary", "Structural concrete package for clean two-bid leveling verification."),
    inclusions: await setFieldByLabel(page, "Mandatory Inclusions", "Structural formwork\nGrade 60 rebar\nConcrete pumping and placement"),
    deadline: await setFieldByLabel(page, "Bid Deadline", deadline),
  };
  step("row7b", "new package form filled", fills);
  await clickVisibleButton(page, "Create Package");
  const created = await waitFor(page, () => (document.body.innerText.includes("Div 03 31 00") ? true : null), 25000, 500);
  step("row7b", "new package created", created);
  await shot(page, "remediation-qa5-p3b-01-new-package.png");

  const pkgId = await resolvePackageId();
  step("row7b", "resolved backend package id", { projectId, packageId: pkgId });
  if (!pkgId) throw new Error("New package not found in backend");

  // 2. Go to leveling and switch to new package
  await clickStage(page, "Bid Leveling");
  await delay(1500);
  const switched = await page.evaluate((csi) => {
    const btns = [...document.querySelectorAll("button")].filter((b) => b.offsetParent !== null && (b.textContent || "").trim().startsWith(csi));
    if (!btns.length) return { ok: false };
    btns[0].click();
    return { ok: true, text: btns[0].textContent.trim() };
  }, NEW_CSI);
  step("row7b", `switch leveling trade to ${NEW_CSI}`, switched);
  await delay(1500);
  await clickVisibleButton(page, "Card View");
  await shot(page, "remediation-qa5-p3b-02-empty-matrix.png");

  // 3. Ingest two bids with distinct identities
  const bid1 = await ingestBid({
    subName: SUB_A,
    fileName: "QA5_Exclusion_Bid.pdf",
    quoteText:
      "PROPOSAL AND QUOTATION\nSubcontractor: QA5 Exclusion Sub\nProject: QA-REM-QA5-E2E Cast-In-Place Concrete\nBase Bid Price: $250,000.00\nEXCLUSIONS:\n- Concrete pump truck and crane hoisting excluded (GC to furnish pump and rigging)\nLead time on post-tensioning steel: 8 weeks.\nInsurance: Standard statutory limits (Umbrella endorsement fee not included).",
  });
  await delay(2000);
  const bid2 = await ingestBid({
    subName: SUB_B,
    fileName: "QA5_One_Dollar_Bid.pdf",
    quoteText:
      "PROPOSAL AND QUOTATION\nSubcontractor: QA5 Dollar Sub\nProject: QA-REM-QA5-E2E Cast-In-Place Concrete\nBase Bid Price: $1.00\nSCOPE INCLUSIONS (100% COMPLETE):\n- Turnkey structural formwork, shoring, and post-tensioning INCLUDED\n- Concrete pumping, placement and hard trowel finishing INCLUDED\nLead time: 3 weeks.\nInsurance: Fully compliant ACORD 25 with $5M Umbrella.",
  });
  await delay(2500);

  const cards = await page.evaluate(() => {
    return [...document.querySelectorAll("h3")]
      .filter((h) => /QA5 /.test(h.textContent || ""))
      .map((h) => {
        let el = h;
        for (let i = 0; i < 8 && el; i++) {
          el = el.parentElement;
          if (!el) break;
          if ((el.textContent || "").includes("True Leveled Cost") && (el.textContent || "").length < 4500) return el.innerText.slice(0, 1500);
        }
        return null;
      })
      .filter(Boolean);
  });
  step("row7b", "two bid cards visible", { count: cards.length, cards });
  await shot(page, "remediation-qa5-p3b-03-two-bids.png");

  const bids = await backendBids();
  const recomputed = bids.map((b) => {
    const exclusions = b.identifiedExclusions || [];
    const alternates = b.valueEngineeringAlternates || [];
    const activeExclusions = exclusions.reduce((s, x) => (x.isWaived ? s : s + (x.costImpact || 0)), 0);
    const acceptedAlternates = alternates.reduce((s, x) => (x.isAccepted ? s + (x.costDeduct || 0) : s), 0);
    const rec = Math.max(0, b.baseBidAmount + activeExclusions + (b.leadTimePenalty || 0) + (b.coiPenalty || 0) - acceptedAlternates);
    return {
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
      contractorId: b.contractorId,
    };
  });
  step("row7b", "backend bids + independent recompute", recomputed);
  await shot(page, "remediation-qa5-p3b-04-leveling-numbers.png");

  // 4. CSV export
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL_DIR, eventsEnabled: true });
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
    csvEvidence = path.join(EVIDENCE_DIR, "remediation-qa5-part3b-leveling-export.csv");
    fs.copyFileSync(csvFile, csvEvidence);
    csvContent = fs.readFileSync(csvFile, "utf8");
    step("row7b", "CSV downloaded", { bytes: fs.statSync(csvFile).size, lines: csvContent.split("\n").length, head: csvContent.split("\n").slice(0, 4) });
  } else {
    step("row7b", "CSV download FAILED", { dlDir: fs.existsSync(DL_DIR) ? fs.readdirSync(DL_DIR) : [] });
  }
  await shot(page, "remediation-qa5-p3b-05-csv.png");

  const distinctContractors = new Set(bids.map((b) => b.contractorId)).size === bids.length && bids.length >= 2;
  const allMatch = recomputed.length >= 2 && recomputed.every((b) => b.match);
  const csvHasBoth = csvContent ? recomputed.every((b) => csvContent.includes(b.name)) : false;
  results.row7 = {
    status: bid1 && bid1.kind === "success" && bid2 && bid2.kind === "success" && bids.length >= 2 && distinctContractors && allMatch && csvFile && csvHasBoth ? "PASS" : "CHECK",
    bid1,
    bid2,
    bids: recomputed,
    distinctContractors,
    allMatch,
    csvDownloaded: Boolean(csvFile),
    csvEvidence,
    csvHasBoth,
  };
  step("row7", "ROW 7 VERDICT", { status: results.row7.status, bidsCount: bids.length, distinctContractors, allMatch, csvDownloaded: Boolean(csvFile), csvHasBoth });

  // 5. Award rank-1 and execute
  const winner = [...recomputed].sort((a, b) => a.recomputed - b.recomputed)[0];
  step("row8", "rank-1 winner", winner);
  const awardClick = await page.evaluate((name) => {
    const h3 = [...document.querySelectorAll("h3")].find((h) => (h.textContent || "").includes(name));
    if (!h3) return { ok: false, reason: "winner card not found" };
    let card = h3;
    for (let i = 0; i < 8 && card; i++) {
      card = card.parentElement;
      if (!card) break;
      const btn = [...card.querySelectorAll("button")].find((b) => /Award Compliant Winner|Award Subcontract & Generate/.test(b.textContent || ""));
      if (btn) {
        btn.scrollIntoView({ block: "center" });
        btn.click();
        return { ok: true, text: btn.textContent.trim() };
      }
    }
    return { ok: false, reason: "award button not found in winner card" };
  }, winner.name);
  step("row8", "click award on winner card", awardClick);
  let awardedWait = { ok: false };
  try {
    await page.waitForFunction(
      (name) => {
        const card = [...document.querySelectorAll("h3")].find((h) => (h.textContent || "").includes(name));
        if (!card) return false;
        let el = card;
        for (let i = 0; i < 8 && el; i++) {
          el = el.parentElement;
          if (!el) break;
          if ((el.innerText || "").includes("Contract Awarded • AIA A401 Generated")) return true;
        }
        return false;
      },
      { timeout: 90000, polling: 1000 },
      winner.name
    );
    awardedWait = { ok: true };
  } catch (e) {
    awardedWait = { ok: false, error: String(e && e.message ? e.message : e) };
  }
  step("row8", "awarded state visible", awardedWait);
  await shot(page, "remediation-qa5-p3b-06-awarded.png");

  const agreeClick = await page.evaluate((name) => {
    const h3 = [...document.querySelectorAll("h3")].find((h) => (h.textContent || "").includes(name));
    if (!h3) return { ok: false };
    let card = h3;
    for (let i = 0; i < 8 && card; i++) {
      card = card.parentElement;
      if (!card) break;
      const btn = [...card.querySelectorAll("button")].find((b) => /Inspect AIA A401/.test(b.textContent || ""));
      if (btn) {
        btn.click();
        return { ok: true };
      }
    }
    return { ok: false };
  }, winner.name);
  step("row8", "open agreement viewer", agreeClick);
  const viewerOpen = await waitFor(page, () => (document.body.innerText.includes("AIA Document A401") && document.body.innerText.includes("Subcontract Sum") ? true : null), 20000, 500);
  const meta = await page.evaluate(() => {
    const t = document.body.innerText;
    const num = t.match(/A401-[0-9-]+|AIA-A401-[0-9]+/);
    const sum = t.match(/SUBCONTRACT SUM\n([^\n]*)/i);
    const ret = t.match(/RETAINAGE\n([^\n]*)/i);
    const ld = t.match(/LIQUIDATED DAMAGES\n([^\n]*)/i);
    return { number: num ? num[0] : null, sum: sum ? sum[1] : null, retainage: ret ? ret[1] : null, liquidation: ld ? ld[1] : null };
  });
  step("row8", "viewer metadata", { viewerOpen: viewerOpen.ok, ...meta });
  await shot(page, "remediation-qa5-p3b-07-agreement-viewer.png");

  const execClick = await clickVisibleButton(page, "Record External Execution");
  step("row8", "click Record External Execution", execClick);
  await waitFor(page, () => (document.body.innerText.includes("Record external execution?") ? true : null), 8000, 300);
  await clickVisibleButton(page, "Record execution");
  const executedWait = await waitFor(page, () => (/execution recorded in tradepulse/i.test(document.body.innerText) ? true : null), 40000, 500);
  step("row8", "execution recorded banner (case-insensitive)", executedWait);
  await shot(page, "remediation-qa5-p3b-08-execution-recorded.png");
  await clickVisibleButton(page, "Close Viewer");
  await delay(1500);

  const postControls = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].filter((b) =>
      ["Leveling Locked", "Adjust Leveling", "Adjust"].includes((b.textContent || "").trim())
    );
    return btns.map((b) => ({ text: (b.textContent || "").trim(), disabled: b.disabled, title: b.getAttribute("title") }));
  });
  step("row8", "adjust controls after execution", postControls);
  const locked = postControls.find((c) => c.text === "Leveling Locked" && c.disabled);
  const forced = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Leveling Locked");
    if (!b) return { found: false };
    b.click();
    return { found: true, disabled: b.disabled };
  });
  await delay(1200);
  const modalAfter = await page.evaluate(() => document.body.innerText.includes("Forensic Leveling Adjustments"));
  step("row8", "forced click on locked control", { forced, adjustModalOpened: modalAfter });
  await shot(page, "remediation-qa5-p3b-09-leveling-locked.png");

  const agreements = projectId ? await client.query("agreements:listAgreements", { projectId }) : [];
  const agForPkg = agreements.filter((a) => a.csiDivision === NEW_CSI);
  step("row8", "backend agreement for new package", agForPkg.map((a) => ({ number: a.agreementNumber, sub: a.subcontractorName, sum: a.contractSum, status: a.status, executedAt: a.executedAt })));

  results.row8 = {
    status: awardedWait.ok && viewerOpen.ok && executedWait.ok && locked && !modalAfter && agForPkg.some((a) => a.status === "executed") ? "PASS" : "CHECK",
    winner,
    awardClick,
    viewerMeta: meta,
    executionRecorded: executedWait.ok,
    lockedControl: locked || null,
    adjustModalAfterForcedClick: modalAfter,
    backendAgreement: agForPkg.map((a) => ({ number: a.agreementNumber, sub: a.subcontractorName, sum: a.contractSum, status: a.status })),
  };
  step("row8", "ROW 8 VERDICT (clean re-run)", results.row8);

  results.diagnostics = {
    consoleErrors: consoleEvents.filter((e) => e.type === "error").map((e) => e.text),
    pageErrors,
    failedRequests,
    httpErrors,
  };
  say(`DIAGNOSTICS: ${JSON.stringify({ consoleErrors: results.diagnostics.consoleErrors.length, pageErrors: pageErrors.length, failedRequests: failedRequests.length, httpErrors: httpErrors.length })}`);
  saveState({ part3b: results, part3bAt: new Date().toISOString() });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa5-part3b-events.json"), JSON.stringify({ results, consoleEvents, pageErrors, failedRequests, httpErrors }, null, 2), "utf8");
  say(`QA5_RESULT ${JSON.stringify({ row7: { status: results.row7.status, bidsCount: bids.length, distinctContractors, allMatch, csvDownloaded: Boolean(csvFile), csvHasBoth }, row8: { status: results.row8.status, viewerMeta: meta, executionRecorded: executedWait.ok, locked: Boolean(locked), backendAgreement: results.row8.backendAgreement } })}`);
  write();
} catch (err) {
  say(`FATAL: ${err && err.stack ? err.stack : err}`);
  say(`EVENTS: ${JSON.stringify({ consoleErrors: consoleEvents.filter((e) => e.type === "error").map((e) => e.text), pageErrors, failedRequests, httpErrors })}`);
  write();
  process.exitCode = 1;
} finally {
  await browser.close();
}