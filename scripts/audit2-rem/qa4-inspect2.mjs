import fs from "node:fs";
import path from "node:path";
import {
  BASE_URL,
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  selectProjectByTitle,
  writeJson,
  writeLog,
  delay,
  REPO_ROOT,
} from "./lib.mjs";

const log = [];
const say = (s) => {
  console.log(s);
  log.push(s);
};

const downloadsDir = path.join(REPO_ROOT, "evidence", "fix4-qa4-downloads");
fs.mkdirSync(downloadsDir, { recursive: true });

const out = { steps: {}, downloads: [], timestamp: new Date().toISOString() };

const { browser, executablePath } = await launchBrowser();
say(`EXECUTABLE: ${executablePath}`);
const page = await browser.newPage();
const diag = attachDiagnostics(page);
const cdp = await page.createCDPSession();
await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadsDir, eventsEnabled: true });

async function body() {
  return (await page.evaluate(() => document.body.innerText)).replace(/\r/g, "");
}

async function clickSel(sel, n = 0) {
  return page.evaluate(
    (s, idx) => {
      const els = [...document.querySelectorAll(s)];
      if (!els[idx]) return { ok: false, count: els.length };
      els[idx].scrollIntoView({ block: "center" });
      els[idx].click();
      return { ok: true, count: els.length, text: (els[idx].textContent || "").trim().slice(0, 80) };
    },
    sel,
    n
  );
}

async function clickText(text, opts = {}) {
  return page.evaluate(
    (needle, exact, nth) => {
      const els = [...document.querySelectorAll("button, [role=tab]")];
      const matches = els.filter((b) => {
        const t = (b.textContent || "").trim();
        return exact ? t === needle : t.includes(needle);
      });
      const m = matches[nth || 0];
      if (!m) return { ok: false, count: matches.length, available: els.map((e) => (e.textContent || "").trim()).filter(Boolean).slice(0, 80) };
      m.scrollIntoView({ block: "center" });
      m.click();
      return { ok: true, count: matches.length, text: (m.textContent || "").trim().slice(0, 80) };
    },
    text,
    !!opts.exact,
    opts.nth || 0
  );
}

async function tab(name) {
  const map = {
    packages: "01: CSI Scoping",
    discovery: "02: Discovery",
    qna: "03: Pre-Bid Q&A",
    leveling: "04: Bid Leveling",
    coordination: "05: Scope Clash",
    contracts: "06: Subcontracts",
    audit: "Live Activity Audit",
    diagnostics: "Evals & Architecture",
  };
  const r = await page.evaluate((needle) => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith(needle));
    if (!b) return { ok: false };
    b.click();
    return { ok: true, label: b.getAttribute("title") };
  }, map[name]);
  await delay(900);
  return r;
}

async function expandWhyGC() {
  return page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "") === "Toggle commercial context");
    if (!b) return { ok: false };
    b.click();
    return { ok: true };
  });
}

async function dialogTexts() {
  return page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"]')].map((d) => ({
      label: d.getAttribute("aria-label") || d.getAttribute("aria-labelledby") || "",
      text: (d.innerText || "").replace(/\r/g, ""),
      buttons: [...d.querySelectorAll("button")].map((b) => ({ t: (b.textContent || "").trim().slice(0, 70), disabled: b.disabled, title: b.getAttribute("title") || "" })),
    }))
  );
}

async function closeAnyModal() {
  await page.keyboard.press("Escape");
  await delay(300);
  let remaining = await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length);
  if (remaining) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /cancel|close|dismiss/i.test((x.textContent || "").trim()));
      if (b) b.click();
    });
    await delay(300);
    remaining = await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length);
  }
  return remaining;
}

async function closeTour() {
  const closed = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.getAttribute("title") || "") === "Close Demo Tour" || (x.getAttribute("title") || "") === "Close Teleprompter" || (x.textContent || "").trim() === "Dismiss"
    );
    if (!b) return false;
    b.click();
    return true;
  });
  await delay(500);
  return closed;
}

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, "Domain Tower B");
  await delay(1200);
  out.steps.tourClosedOnLoad = await closeTour();
  await delay(400);

  // PACKAGES
  await tab("packages");
  await expandWhyGC();
  await delay(300);
  out.steps.packagesWhy = (await body()).split("Why GCs Care")[1]?.slice(0, 3000) || "";
  await shot(page, "fix4-qa4-packages-why-expanded.png", { full: true });
  const specBtn = await clickText("AI Spec Breakdown");
  await delay(700);
  out.steps.specModal = await dialogTexts();
  await shot(page, "fix4-qa4-dialog-spec-breakdown.png", { full: false });
  out.steps.specModalClosed = await closeAnyModal();

  // DISCOVERY filters
  await tab("discovery");
  await clickText("Discovered (0)");
  await delay(500);
  out.steps.discoveryEmptyDiscovered = (await body()).split("Trade Directory")[1]?.slice(0, 1500) || (await body()).split("Discovery & Directory")[1]?.slice(0, 1500) || "";
  await shot(page, "fix4-qa4-empty-discovery-discovered.png", { full: true });
  await clickText("Invited (2)");
  await delay(400);
  out.steps.discoveryInvitedCount = ((await body()).match(/Trade Directory \((\d+) of (\d+)\)/) || []).join(" ");
  await clickText("All (4)");
  await delay(300);
  await expandWhyGC();
  await delay(300);
  out.steps.discoveryWhy = (await body()).split("Why GCs Care")[1]?.slice(0, 2500) || "";
  await shot(page, "fix4-qa4-discovery-why-expanded.png", { full: true });

  // QnA
  await tab("qna");
  await clickText("Approved for Addendum (0)");
  await delay(500);
  out.steps.qnaEmptyApproved = (await body()).split("Queue Filter")[1]?.slice(0, 1500) || "";
  await shot(page, "fix4-qa4-empty-qna-approved.png", { full: true });
  await clickText("All RFIs (3)");
  await delay(300);
  await expandWhyGC();
  await delay(300);
  out.steps.qnaWhy = (await body()).split("Why GCs Care")[1]?.slice(0, 3000) || "";
  const edit = await clickText("Edit Response");
  await delay(500);
  out.steps.qnaEditInline = (await body()).split("Edit Clarification for Addendum")[1]?.slice(0, 1200) || "";
  await shot(page, "fix4-qa4-qna-edit-response.png", { full: true });
  await clickText("Cancel");
  await delay(300);
  out.steps.addendumGate = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Issue Legal Addendum"));
    return b ? { disabled: b.disabled, title: b.getAttribute("title") || "", text: b.textContent.trim().slice(0, 80) } : null;
  });

  // LEVELING
  await tab("leveling");
  await expandWhyGC();
  await delay(300);
  out.steps.levelingWhy = (await body()).split("Why GCs Care")[1]?.slice(0, 3000) || "";
  await shot(page, "fix4-qa4-leveling-why-expanded.png", { full: true });
  const spread = await clickText("Spread Table View");
  await delay(600);
  out.steps.spread = spread;
  out.steps.levelingSpreadText = (await body()).split("Real-Time Forensic Bid Leveling Matrix")[1]?.slice(0, 5000) || "";
  await shot(page, "fix4-qa4-leveling-spread.png", { full: true });
  await clickText("Card View");
  await delay(400);
  const adjust = await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => (b.textContent || "").includes("Adjust")).map((b) => (b.textContent || "").trim().slice(0, 40)));
  out.steps.adjustButtons = adjust;
  if (adjust.length) {
    await clickText("Adjust", { nth: adjust.length - 1 });
    await delay(600);
    out.steps.adjustModal = await dialogTexts();
    await shot(page, "fix4-qa4-dialog-adjust-leveling.png", { full: false });
    out.steps.adjustClosed = await closeAnyModal();
  }
  const li = await clickText("Line Item Breakdown");
  await delay(500);
  out.steps.lineItems = li;
  out.steps.lineItemsText = (await body()).split("Line Item Breakdown")[1]?.slice(0, 4000) || "";
  await shot(page, "fix4-qa4-leveling-lineitems.png", { full: true });
  const sim = await clickText("Open Demo Simulation");
  await delay(900);
  out.steps.sim = sim;
  out.steps.judgeDock = await dialogTexts();
  await shot(page, "fix4-qa4-dialog-judge-sim.png", { full: false });
  out.steps.judgeClosed = await closeAnyModal();
  // Export CSV (read-only local download)
  let downloadCountBefore = fs.readdirSync(downloadsDir).length;
  await clickText("Export Leveling CSV");
  await delay(2000);
  out.downloads.push({ what: "leveling-csv", files: fs.readdirSync(downloadsDir).slice(downloadCountBefore) });

  // COORDINATION
  await tab("coordination");
  await expandWhyGC();
  await delay(300);
  out.steps.coordWhy = (await body()).split("Why GCs Care")[1]?.slice(0, 3000) || "";
  await shot(page, "fix4-qa4-coordination-why-expanded.png", { full: true });

  // CONTRACTS
  await tab("contracts");
  await expandWhyGC();
  await delay(300);
  out.steps.contractsWhy = (await body()).split("Why GCs Care")[1]?.slice(0, 2500) || "";
  const inspect = await clickText("Inspect AIA A401");
  await delay(900);
  out.steps.contractA401 = await dialogTexts();
  await shot(page, "fix4-qa4-dialog-a401.png", { full: false });
  // Download agreement text file (read-only local export)
  downloadCountBefore = fs.readdirSync(downloadsDir).length;
  const dl = await page.evaluate(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => (x.getAttribute("title") || "").includes("Download subcontract agreement"));
    if (!b) return { ok: false };
    b.click();
    return { ok: true };
  });
  out.steps.contractDownload = dl;
  await delay(2000);
  out.downloads.push({ what: "a401-txt", files: fs.readdirSync(downloadsDir).slice(downloadCountBefore) });
  out.steps.contractModalClosed = await closeAnyModal();
  out.steps.executeGate = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Record Execution"));
    return b ? { disabled: b.disabled, title: b.getAttribute("title") || "" } : null;
  });

  // AUDIT + DIAGNOSTICS
  await tab("audit");
  out.steps.auditText = (await body()).split("Live Reactive Activity Audit Stream")[1]?.slice(0, 4000) || "";
  await tab("diagnostics");
  downloadCountBefore = fs.readdirSync(downloadsDir).length;
  await clickText("Download Traces JSON");
  await delay(2500);
  out.downloads.push({ what: "traces-json", files: fs.readdirSync(downloadsDir).slice(downloadCountBefore) });

  out.diag = {
    consoleErrors: diag.consoleLogs.filter((m) => m.type === "error").map((m) => m.text.slice(0, 200)),
    pageErrors: diag.pageErrors.slice(0, 8),
    failedRequests: diag.failedRequests.slice(0, 8),
  };
  say(`DOWNLOADS: ${JSON.stringify(out.downloads)}`);
} catch (e) {
  say(`INSPECT2 ERROR: ${e.stack || e}`);
  out.error = String(e.stack || e);
} finally {
  writeJson("fix4-qa4-inspect2.json", out);
  writeLog("fix4-qa4-inspect2-log.txt", log);
  await browser.close();
}