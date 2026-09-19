/**
 * QA15 live UI: A13-04/A12-04 print popups (Contracts viewer + Bid Leveling
 * agreement viewer), A13-01 superseded execute inline reason, A11-04 clash line.
 */
import {
  attachDiagnostics,
  clickHeaderTab,
  delay,
  launchBrowser,
  selectProjectByTitle,
  waitForAppReady,
  shot,
} from "./qa6-lib.mjs";
import { BASE_URL } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog } from "./qa15-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${detail}`);
};

const APP_NAV_RX = "CSI Scoping|Subcontract Agreements Register|Inspect Draft|Document type for upload";

async function capturePopup(page, popups, timeoutMs = 15000) {
  const start = Date.now();
  const collected = [];
  let best = null;
  while (Date.now() - start < timeoutMs) {
    for (const t of popups) {
      try {
        const p = await t.page();
        if (!p) continue;
        const info = await p.evaluate((appNavRx) => ({
          url: location.href,
          title: document.title,
          textLen: (document.body ? document.body.textContent || "" : "").length,
          textHead: (document.body ? (document.body.textContent || "").slice(0, 120) : ""),
          hasAppNav: new RegExp(appNavRx).test(document.body ? document.body.textContent || "" : ""),
          headerCount: document.querySelectorAll("header,nav").length,
        }), APP_NAV_RX);
        if (!collected.some((x) => x.title === info.title && x.textLen === info.textLen)) collected.push(info);
        if (info.textLen > 0) best = { ...info, pagesSeen: collected.length };
      } catch (err) {
        collected.push({ error: String(err && err.message ? err.message : err) });
      }
    }
    if (best) break;
    await delay(400);
  }
  if (!best && collected.length) {
    best = { ...collected[collected.length - 1], pagesSeen: collected.length };
  }
  return { best, collected };
}

async function realClickByTitle(page, title, scopeSelector = "body") {
  const box = await page.evaluate(
    ({ title, scopeSelector }) => {
      const vis = (e) => {
        const r = e.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      };
      const root = document.querySelector(scopeSelector) || document.body;
      const b = [...root.querySelectorAll("button")].find((x) => x.getAttribute("title") === title && vis(x));
      if (!b) return null;
      b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    { title, scopeSelector }
  );
  if (!box) return { ok: false, reason: "button not found", title };
  await page.mouse.click(box.x, box.y);
  return { ok: true };
}

async function clickVisibleButtonByText(page, text, exact = false, scopeSelector = "main") {
  const box = await page.evaluate(
    ({ text, exact, scopeSelector }) => {
      const vis = (e) => {
        const r = e.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      };
      const root = document.querySelector(scopeSelector) || document.body;
      const b = [...root.querySelectorAll("button")].find((x) => {
        if (!vis(x)) return false;
        const t = (x.innerText || "").trim().replace(/\s+/g, " ");
        return exact ? t === text : t.includes(text);
      });
      if (!b) return null;
      b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: (b.innerText || "").trim().replace(/\s+/g, " ") };
    },
    { text, exact, scopeSelector }
  );
  if (!box) return { ok: false, reason: "button not found", text };
  await page.mouse.click(box.x, box.y);
  return { ok: true, label: box.label };
}

async function clickRowButton(page, rowNeedle, buttonText) {
  const box = await page.evaluate(
    ({ rowNeedle, buttonText }) => {
      const vis = (e) => {
        const r = e.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      };
      const rows = [...document.querySelectorAll("main tr")].filter((tr) => (tr.innerText || "").includes(rowNeedle) && vis(tr));
      const row = rows[0];
      if (!row) return null;
      const b = [...row.querySelectorAll("button")].find((x) => (x.innerText || "").includes(buttonText));
      if (!b) return null;
      b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    { rowNeedle, buttonText }
  );
  if (!box) return { ok: false, reason: "row or button not found" };
  await page.mouse.click(box.x, box.y);
  return { ok: true };
}

async function probeAlertDialog(page) {
  return page.evaluate(() => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const ds = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis);
    const top = ds[ds.length - 1] || null;
    const alert = top ? top.querySelector('[role="alert"]') : null;
    return {
      dialogOpen: Boolean(top),
      title: top ? ((top.querySelector("h2") || {}).innerText || "").trim() : null,
      inlineAlert: alert ? alert.innerText.trim() : null,
      alertVisible: alert ? vis(alert) : null,
      buttons: top ? [...top.querySelectorAll("button")].map((b) => (b.innerText || "").trim().replace(/\s+/g, " ")) : [],
    };
  });
}

async function clickDialogButton(page, label) {
  return page.evaluate((needle) => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const ds = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis);
    const top = ds[ds.length - 1];
    if (!top) return false;
    const b = [...top.querySelectorAll("button")].find((x) => (x.innerText || "").trim().replace(/\s+/g, " ") === needle);
    if (!b) return false;
    b.click();
    return true;
  }, label);
}

async function closeAllPopups(popups) {
  for (const t of [...popups]) {
    try {
      const p = await t.page();
      if (p) await p.close();
    } catch {}
  }
  popups.length = 0;
}

async function closeContractsViewer(page) {
  const closed = await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="Close contract viewer"]');
    if (!b) return false;
    b.click();
    return true;
  });
  if (!closed) await page.keyboard.press("Escape");
  await delay(600);
  return closed;
}

async function main() {
  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const popups = [];
  browser.on("targetcreated", (target) => {
    if (target.type() === "page") popups.push(target);
  });

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, F.mainProjectTitle);
  await delay(2400);

  const contractLen = F.print.contractTextLength;

  // ======================================================== A13-04a Contracts viewer print
  await clickHeaderTab(page, "06: Subcontracts");
  await delay(2400);
  const openedContracts = await clickRowButton(page, F.print.agreementNumber, "Inspect Draft");
  await delay(1200);
  const contractsViewer = await page.evaluate(() => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const d = [...document.querySelectorAll('[role="dialog"]')].filter(vis).pop();
    return {
      open: Boolean(d),
      labelledby: d ? d.getAttribute("aria-labelledby") : null,
      textLength: d ? (d.innerText || "").length : null,
      hasFullDraft: d ? /SUBCONTRACT AGREEMENT/.test(d.innerText || "") : false,
    };
  });
  popups.length = 0;
  const printClickA = await realClickByTitle(page, "Print agreement or save as PDF", '[role="dialog"]');
  const popupA = await capturePopup(page, popups);
  await shot(page, "fix4-qa15-A13-04-contracts-print.png");
  record(
    "A13-04-A12-04-contracts-print-isolated-full-text",
    openedContracts.ok &&
      contractsViewer.open &&
      printClickA.ok &&
      popupA.best &&
      typeof popupA.best.textLen === "number" &&
      popupA.best.textLen >= contractLen * 0.95 &&
      popupA.best.hasAppNav === false && popupA.best.title === F.print.agreementNumber,
    `opened=${JSON.stringify(openedContracts)}; viewerLen=${contractsViewer.textLength}; printClick=${JSON.stringify(printClickA)}; popup=${JSON.stringify(popupA.best)}; contractLen=${contractLen}`
  );
  await closeAllPopups(popups);
  const closedViewer = await closeContractsViewer(page);
  say(`contracts viewer closed=${closedViewer}`);

  // ======================================================== A13-02/A13-04b Bid Leveling agreement viewer print
  await clickHeaderTab(page, "04: Bid Leveling");
  await delay(2400);
  const switched = await page.evaluate((pkgName) => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const candidates = [...document.querySelectorAll("main button[aria-pressed]")].filter(
      (b) => vis(b) && (b.innerText || "").includes(pkgName)
    );
    const b = candidates[0] || null;
    if (!b) return { ok: false, reason: "package switch not found" };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true, text: (b.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80) };
  }, F.print.packageName);
  await delay(1800);
  const buyerVisible = await page.evaluate(
    (name) => document.body.innerText.includes(name),
    F.print.contractorName || "AUDIT-QA15 Print Electric Co"
  );
  const openedLeveling = await page.evaluate((contractorName) => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const cards = [...document.querySelectorAll("main div")].filter(
      (d) =>
        (d.innerText || "").includes(contractorName) &&
        vis(d) &&
        [...d.querySelectorAll("button")].some((x) => /Inspect Draft/.test(x.innerText || ""))
    );
    const card = cards.sort((a, b) => (a.innerText || "").length - (b.innerText || "").length)[0];
    if (!card) return { ok: false, reason: "card with Inspect Draft not found" };
    const b = [...card.querySelectorAll("button")].find((x) => /Inspect Draft/.test(x.innerText || ""));
    if (!b) return { ok: false, reason: "Inspect Draft not found" };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true };
  }, "AUDIT-QA15 Print Electric Co");
  await delay(1400);
  const levelingModal = await page.evaluate(() => {
    const holders = [...document.querySelectorAll("div.fixed.inset-0")].filter((d) => /A401-style Subcontract Draft/.test(d.innerText || ""));
    const d = holders[holders.length - 1] || null;
    return {
      open: Boolean(d),
      hasAgreementNumber: d ? /A401-2026-2600-/.test(d.innerText || "") : false,
      textLength: d ? (d.innerText || "").length : null,
    };
  });
  popups.length = 0;
  const printClickB = await realClickByTitle(page, "Print subcontract agreement or save as PDF", "div.fixed.inset-0");
  const popupB = await capturePopup(page, popups);
  await shot(page, "fix4-qa15-A13-02-leveling-modal-print.png");
  record(
    "A13-02-A13-04-leveling-modal-print-isolated-full-text",
    switched.ok &&
      buyerVisible &&
      openedLeveling.ok &&
      levelingModal.open &&
      printClickB.ok &&
      popupB.best &&
      typeof popupB.best.textLen === "number" &&
      popupB.best.textLen >= contractLen * 0.95 &&
      popupB.best.hasAppNav === false && popupB.best.title === F.print.agreementNumber,
    `switch=${JSON.stringify(switched)}; buyerVisible=${buyerVisible}; open=${JSON.stringify(openedLeveling)}; modal=${JSON.stringify(levelingModal)}; printClick=${JSON.stringify(printClickB)}; popup=${JSON.stringify(popupB.best)}; contractLen=${contractLen}`
  );
  await closeAllPopups(popups);
  // close the leveling modal (last unlabeled X button in the topmost fixed overlay)
  const closeLeveling = await page.evaluate(() => {
    const holders = [...document.querySelectorAll("div.fixed.inset-0")].filter((d) => /A401-style Subcontract Draft/.test(d.innerText || ""));
    const d = holders[holders.length - 1];
    if (!d) return false;
    const buttons = [...d.querySelectorAll("button")].filter((b) => !((b.innerText || "").trim()));
    const x = buttons[buttons.length - 1];
    if (!x) return false;
    x.click();
    return true;
  });
  await delay(800);
  say(`leveling modal close click=${closeLeveling}`);

  // ======================================================== A13-01 superseded execute inline reason
  await clickHeaderTab(page, "06: Subcontracts");
  await delay(2400);
  const supersededFilter = await clickVisibleButtonByText(page, "Superseded (", false, "main");
  await delay(1000);
  const execClick = await clickRowButton(page, F.superseded.agreementNumber, "Record Execution Status");
  await delay(900);
  const beforeRefusal = await probeAlertDialog(page);
  const confirmClick = await clickDialogButton(page, "Record execution");
  await delay(2800);
  const afterRefusal = await probeAlertDialog(page);
  await shot(page, "fix4-qa15-A13-01-superseded-execute-inline.png");
  const agrAfter = (await c.query("agreements:listAgreements", { projectId: F.mainProjectId })).find((a) => a._id === F.superseded.agreementId);
  record(
    "A13-01-execute-superseded-readable-inline",
    supersededFilter.ok &&
      execClick.ok &&
      beforeRefusal.dialogOpen &&
      confirmClick &&
      afterRefusal.dialogOpen &&
      typeof afterRefusal.inlineAlert === "string" &&
      /^Cannot execute a superseded agreement/.test(afterRefusal.inlineAlert) &&
      !/Something went wrong/i.test(afterRefusal.inlineAlert) &&
      agrAfter.status === "superseded",
    `filter=${JSON.stringify(supersededFilter)}; execClick=${JSON.stringify(execClick)}; title=${JSON.stringify(afterRefusal.title)}; alert=${JSON.stringify(afterRefusal.inlineAlert)}; stillOpen=${afterRefusal.dialogOpen}; backendStatus=${agrAfter.status}`
  );
  await clickDialogButton(page, "Cancel");
  await delay(500);

  // ======================================================== A11-04 clash per-card applied credit
  await clickHeaderTab(page, "05: Scope Clash");
  await delay(2800);
  const clashProbe = await page.evaluate(() => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const cards = [...document.querySelectorAll("main div.rounded-xl")].filter(
      (d) => vis(d) && /Rooftop Mechanical Equipment Disconnect Switches/.test(d.innerText || "")
    );
    const card = cards[cards.length - 1] || null;
    if (!card) return { found: false };
    const badges = [...card.querySelectorAll("span")].map((s) => (s.innerText || "").trim()).filter((t) => /deducted/i.test(t));
    const actionSpan = [...card.querySelectorAll("span")].find((s) => /^Deducted \$/.test((s.innerText || "").trim()));
    const kpiCard = [...document.querySelectorAll("div.rounded-xl")].find((d) => /Recoverable Buyout Credits/.test(d.innerText || ""));
    return {
      found: true,
      cardText: (card.innerText || "").replace(/\s+/g, " ").slice(0, 700),
      badges: [...new Set(badges)],
      actionLine: actionSpan ? (actionSpan.innerText || "").trim() : null,
      actionLineVisible: actionSpan ? vis(actionSpan) : false,
      kpiText: kpiCard ? (kpiCard.innerText || "").replace(/\s+/g, " ") : null,
    };
  });
  await shot(page, "fix4-qa15-A11-04-clash-applied-credit.png");
  const applied = "$9,999";
  const benchmark = "$12,000";
  record(
    "A11-04-clash-applied-credit-line",
    clashProbe.found &&
      clashProbe.actionLineVisible &&
      typeof clashProbe.actionLine === "string" &&
      clashProbe.actionLine.includes(applied) &&
      !clashProbe.actionLine.includes(benchmark) &&
      /Credit Deducted & Leveled/i.test(clashProbe.cardText || ""),
    `line=${JSON.stringify(clashProbe.actionLine)}; badges=${JSON.stringify(clashProbe.badges)}; kpi=${JSON.stringify((clashProbe.kpiText || "").slice(0, 120))}; benchmarkInLine=${(clashProbe.actionLine || "").includes(benchmark)}`
  );

  const diagnostics = {
    consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((e) => e.text.slice(0, 200)),
    pageErrors: diag.pageErrors.slice(0, 10),
    pageErrorCount: diag.pageErrors.length,
    failedRequests: diag.failedRequests.slice(0, 10),
  };
  say(`diagnostics: ${JSON.stringify({ consoleErrors: diagnostics.consoleErrors.length, pageErrors: diagnostics.pageErrorCount, failedRequests: diagnostics.failedRequests.length })}`);

  writeEvidence("print-superseded-clash", {
    results,
    contractLen,
    openedContracts,
    contractsViewer,
    printClickA,
    popupA,
    switched,
    openedLeveling,
    levelingModal,
    printClickB,
    popupB,
    supersededFilter,
    execClick,
    beforeRefusal,
    afterRefusal,
    agrAfterStatus: agrAfter.status,
    clashProbe,
    diagnostics,
  });
  writeLog("print-superseded-clash", log);
  console.log(`\nresults: ${results.filter((r) => r.pass).length}/${results.length} passed`);
  await browser.close();
}

main().catch(async (e) => {
  console.error(e);
  writeLog("print-superseded-clash-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});