/**
 * QA33-03 UI verification of FIX-NEW-72..74 on AUDIT-QA33 fixtures:
 *  MBUI   - A32-01: deduct on cheapest B1, award B2, then UI "Reverse credit" from the
 *           card must remove the carrier B1's credit, restore $480,000, clear the card,
 *           write a reversal audit row, and leave the awarded B2 contract untouched.
 *  STALEUI- A32-02 + A31-05/UE.1: UI un-accept the credit -> card detected with a
 *           "Clear stale credit record" control; a refused deduct must toast with zero
 *           pageerror/console error; the clear must remove the record with an audit row;
 *           a subsequent deduct must apply cleanly.
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab, selectProjectByTitle } from "./lib.mjs";
import { client, writeEvidence, writeLog, sleep } from "./qa33-lib.mjs";
import { rebuildPair } from "./qa33-01-fixtures.mjs";

const c = client();
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1900)}`);
};

const VFD_DESC = "Variable Frequency Drives (VFDs) for AHUs & Pumps";

const detect = (projectId) => c.query("coordination:detectCrossTradeClashes", { projectId });
const card = (d, id) => d.doubleBuys.find((x) => x.id === id);
const bidsByPkg = (pkgId) => c.query("bids:listByPackage", { tradePackageId: pkgId });
const bidById = async (pkgId, bidId) => (await bidsByPkg(pkgId)).find((b) => b._id === bidId);
const creditRows = (bid) => (bid?.valueEngineeringAlternates || []).filter((v) => /^Cross-Trade Clash Credit:/.test(v.description || ""));
const auditRows = (projectId) => c.query("auditLogs:listRecentLogs", { projectId, limit: 300 });

async function poll(fn, predicate, timeoutMs, stepMs = 500) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    try { last = await fn(); } catch (err) { last = { error: String(err?.message ?? err) }; }
    if (predicate(last)) return last;
    await sleep(stepMs);
  }
  return last;
}

async function clickText(page, needle, exact = false) {
  return page.evaluate(
    ({ needle, exact }) => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const b = [...document.querySelectorAll("button")].find((x) => {
        const t = (x.innerText || "").replace(/\s+/g, " ").trim();
        return vis(x) && (exact ? t === needle : t.includes(needle));
      });
      if (!b) return { ok: false, available: [...document.querySelectorAll("button")].map((x) => (x.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 50) };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, text: (b.innerText || "").replace(/\s+/g, " ").trim(), disabled: b.disabled };
    },
    { needle, exact }
  );
}

async function selectPackage(page, name) {
  return page.evaluate((n) => {
    const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => (x.innerText || "").includes(n));
    if (!b) return { ok: false, available: [...document.querySelectorAll("button[aria-pressed]")].map((x) => (x.innerText || "").trim()) };
    b.click();
    return { ok: true, text: (b.innerText || "").trim() };
  }, name);
}

async function dismissTour(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
    b?.click();
  });
  await delay(800);
}

const findAdjustDialog = (page) =>
  page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const cands = [...document.querySelectorAll("div")].filter(
      (el) => vis(el) && /Forensic Leveling Adjustments/.test(el.innerText || "") && /Save Leveling Adjustments/.test(el.innerText || "")
    );
    const top = cands.sort((a, b) => (a.innerText || "").length - (b.innerText || "").length)[0];
    if (!top) return { ok: false };
    return {
      ok: true,
      creditRowText: [...top.querySelectorAll("div")].map((d) => d.innerText || "").find((t) => /Cross-Trade Clash Credit/.test(t) && t.length < 300) || null,
      buttons: [...top.querySelectorAll("button")].map((b) => (b.innerText || "").trim()),
    };
  });

async function toggleCredit(page) {
  return page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const cands = [...document.querySelectorAll("div")].filter(
      (el) => vis(el) && /Forensic Leveling Adjustments/.test(el.innerText || "") && /Save Leveling Adjustments/.test(el.innerText || "")
    );
    const top = cands.sort((a, b) => (a.innerText || "").length - (b.innerText || "").length)[0];
    if (!top) return { ok: false, reason: "no adjustment dialog" };
    const inCreditRow = (b) => {
      let n = b;
      for (let i = 0; i < 6 && n; i++) {
        if (/Cross-Trade Clash Credit/.test(n.innerText || "")) return true;
        n = n.parentElement;
      }
      return false;
    };
    const btns = [...top.querySelectorAll("button")].filter((b) => inCreditRow(b) && /Accepted|Accept Alternate/.test(b.innerText || ""));
    const btn = btns[0];
    if (!btn) return { ok: false, reason: "credit toggle not found" };
    const before = (btn.innerText || "").trim();
    btn.click();
    return { ok: true, before };
  });
}

async function saveAdjust(page) {
  return page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const cands = [...document.querySelectorAll("div")].filter(
      (el) => vis(el) && /Forensic Leveling Adjustments/.test(el.innerText || "") && /Save Leveling Adjustments/.test(el.innerText || "")
    );
    const top = cands.sort((a, b) => (a.innerText || "").length - (b.innerText || "").length)[0];
    const b = top && [...top.querySelectorAll("button")].find((x) => /Save Leveling Adjustments/.test(x.innerText || ""));
    if (!b) return { ok: false };
    b.click();
    return { ok: true };
  });
}

const toastText = (page) => page.evaluate(() => {
  const el = document.querySelector('[role="status"][aria-live="polite"]');
  return el ? (el.innerText || "").replace(/\s+/g, " ").trim() : null;
});

async function waitForToast(page, rx, timeoutMs = 12000) {
  const t0 = Date.now();
  let t = null;
  while (Date.now() - t0 < timeoutMs) {
    t = await toastText(page);
    if (t && rx.test(t)) return t;
    await sleep(300);
  }
  return t;
}

async function waitToastGone(page, timeoutMs = 7000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (!(await toastText(page))) return true;
    await sleep(300);
  }
  return false;
}

const uiClash = (page) =>
  page.evaluate(() => {
    const t = (document.querySelector("main") || document.body).innerText.replace(/\n/g, " ");
    const buttons = [...document.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    return {
      detectedChips: (t.match(/Redundant Double-Buy Detected/gi) || []).length,
      deductedChips: (t.match(/Credit Deducted & Leveled/gi) || []).length,
      noRemaining: /No remaining redundancy/.test(t),
      deductButtons: buttons.filter((x) => /1-Click Deduct Credit/.test(x)),
      reverseButtons: buttons.filter((x) => /Reverse credit/.test(x)),
      staleClearButtons: buttons.filter((x) => /Clear stale credit record/.test(x)),
      raw: t.slice(0, 500),
    };
  });

async function launchAndOpen(projectId, tag) {
  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.goto(`${BASE}/?project=${projectId}&qa33=${tag}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await dismissTour(page);
  return { browser, page, diag };
}

async function main() {
  // ================= MBUI: A32-01 reverse-from-card after award switch =================
  {
    const mb = await rebuildPair("MBUI", { twoHvacBids: true });
    const p23 = mb.p23;
    const b1Id = mb.b23.bidId;
    const b2Id = mb.b23b.bidId;
    const ded = await c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: mb.id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 38500, description: VFD_DESC,
    });
    const award = await c.mutation("agreements:generateAgreement", { bidId: b2Id, tradePackageId: p23 });
    const { browser, page, diag } = await launchAndOpen(mb.id, "mbui");
    try {
      await clickTab(page, "Scope Clash");
      await delay(2200);
      const uiPre = await uiClash(page);
      const dPre = await detect(mb.id);
      const revClick = await clickText(page, "Reverse credit");
      const toast = await waitForToast(page, /reversed|restored/i);
      await delay(1500);
      const b1 = await bidById(p23, b1Id);
      const b2 = await bidById(p23, b2Id);
      const agr = ((await c.query("agreements:listAgreements", { projectId: mb.id })) || []).find((a) => a.bidId === b2Id);
      const dAfter = await detect(mb.id);
      const revRows = (await auditRows(mb.id)).filter((l) => /Double-Buy Credit Reversed/.test(l.title));
      const allHvacCredit = (await bidsByPkg(p23)).flatMap((b) => creditRows(b)).length;
      const uiAfter = await uiClash(page);
      await shot(page, "fix4-qa33-ui-mbui-after-reverse.png", { full: true });

      record("A33-03.1", "A32-01 UI FIXED: before the click the card is deducted $38,500 and shows 'Reverse credit'; the click succeeds with the reversal toast",
        ded.newLeveledCost === 441500 && award.success !== false &&
          card(dPre, "clash-vfd-01")?.status === "deducted" && uiPre.reverseButtons.length === 1 &&
          revClick.ok && Boolean(toast) && /reversed/i.test(toast),
        { deduct: ded.newLeveledCost, uiPre: { deducted: uiPre.deductedChips, reverse: uiPre.reverseButtons }, revClick, toast });

      record("A33-03.2", "A32-01 UI FIXED: after the UI reverse the carrier B1 is restored to $480,000 with zero credit rows, B2 stays awarded at $497,000 (contract sum unchanged), the card returns to detected $38,500 and one reversal audit row exists — no stranded credit",
        b1?.leveledTotalCost === 480000 && creditRows(b1).length === 0 && b1?.isAwarded === false &&
          b2?.leveledTotalCost === 497000 && b2?.isAwarded === true && agr?.contractSum === 497000 &&
          card(dAfter, "clash-vfd-01")?.status === "detected" && card(dAfter, "clash-vfd-01")?.redundantAmount === 38500 && !card(dAfter, "clash-vfd-01")?.staleResolution &&
          revRows.length === 1 && /restored to \$480,000/.test(revRows[0]?.description || "") &&
          allHvacCredit === 0 && uiAfter.reverseButtons.length === 0,
        { b1: { leveled: b1?.leveledTotalCost, rows: creditRows(b1).length, awarded: b1?.isAwarded }, b2: { leveled: b2?.leveledTotalCost, awarded: b2?.isAwarded, contractSum: agr?.contractSum }, card: card(dAfter, "clash-vfd-01"), revAudit: revRows[0]?.description, strandedCredits: allHvacCredit, uiAfter });

      record("A33-03.3", "A32-01 UI diagnostics: zero page errors, zero console errors",
        diag.pageErrors.length === 0 && diag.consoleLogs.filter((l) => l.type === "error").length === 0,
        { pageErrors: diag.pageErrors.slice(0, 3), consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 3).map((e) => e.text.slice(0, 160)) });
    } finally {
      await browser.close();
    }
  }

  // ================= STALEUI: A32-02 stale clear + A31-05 refused-deduct =================
  {
    const st = await rebuildPair("STALEUI");
    const p23 = st.p23;
    const bId = st.b23.bidId;
    const ded = await c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: st.id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 38500, description: VFD_DESC,
    });
    const { browser, page, diag } = await launchAndOpen(st.id, "staleui");
    try {
      // UI un-accept through Bid Leveling
      await clickTab(page, "Bid Leveling");
      await delay(1600);
      const pkgSel = await selectPackage(page, "QA33 STALEUI HVAC");
      await delay(1000);
      await clickText(page, "Adjust Leveling");
      await delay(900);
      const dlg = await findAdjustDialog(page);
      const toggle = await toggleCredit(page);
      await delay(600);
      const save = await saveAdjust(page);
      const bAfter = await poll(
        () => bidById(p23, bId),
        (b) => b && b.leveledTotalCost === 480000 && creditRows(b).length === 1 && creditRows(b)[0].isAccepted === false,
        20000
      );

      await clickTab(page, "Scope Clash");
      await delay(2200);
      const dStale = await detect(st.id);
      const uiStale = await uiClash(page);
      await shot(page, "fix4-qa33-ui-stale-detected.png", { full: true });

      record("A33-03.4", "A32-02 UI setup FIXED: un-accepting via Bid Leveling restores $480,000 and the Scope Clash card is detected $38,500 with a visible 'Clear stale credit record' control (no reverse control, deduct still offered)",
        ded.newLeveledCost === 441500 && pkgSel.ok && dlg.ok && toggle.ok && save.ok &&
          bAfter?.leveledTotalCost === 480000 && creditRows(bAfter).length === 1 && creditRows(bAfter)[0].isAccepted === false &&
          card(dStale, "clash-vfd-01")?.status === "detected" && card(dStale, "clash-vfd-01")?.staleResolution === true &&
          uiStale.staleClearButtons.length === 1 &&
          uiStale.deductButtons.some((x) => /38,500/.test(x)) && uiStale.reverseButtons.length === 0,
        { toggle, save, leveled: bAfter?.leveledTotalCost, rows: creditRows(bAfter).map((v) => ({ a: v.isAccepted, c: v.costDeduct })), card: card(dStale, "clash-vfd-01"), ui: { staleClear: uiStale.staleClearButtons, deduct: uiStale.deductButtons, reverse: uiStale.reverseButtons } });

      // A31-05/UE.1: refused deduct -> toast, NO pageerror/console error
      const perrBefore = diag.pageErrors.length;
      const cerrBefore = diag.consoleLogs.filter((l) => l.type === "error").length;
      const refuseClick = await clickText(page, "1-Click Deduct Credit");
      const failToast = await waitForToast(page, /Deduct credit failed/i);
      await delay(1800);
      const perrAfter = diag.pageErrors.length;
      const cerrAfter = diag.consoleLogs.filter((l) => l.type === "error").length;
      const bRefused = await bidById(p23, bId);
      const dRefused = await detect(st.id);
      record("A33-03.5", "A31-05/UE.1 FIXED: the refused deduct shows the readable toast and produces zero page errors (no unhandled rejection); state unchanged. Residual: one console.error line emitted by the Convex client library itself (request_manager logs every refused mutation)",
        refuseClick.ok && Boolean(failToast) && /already been applied|Reverse the existing credit/i.test(failToast) &&
          perrAfter - perrBefore === 0 && cerrAfter - cerrBefore === 1 &&
          diag.consoleLogs.filter((l) => l.type === "error").every((l) => /^\[CONVEX M\(/.test(l.text)) &&
          bRefused?.leveledTotalCost === 480000 && card(dRefused, "clash-vfd-01")?.staleResolution === true,
        { refuseClick: rejectTrue(refuseClick), failToast, pageErrorDelta: perrAfter - perrBefore, consoleErrorDelta: cerrAfter - cerrBefore, libraryConsoleLine: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 3).map((e) => e.text.slice(0, 160)), leveled: bRefused?.leveledTotalCost, card: card(dRefused, "clash-vfd-01") });

      // A32-02: click the stale clear control
      await waitToastGone(page, 8000);
      const auditsBefore = (await auditRows(st.id)).filter((l) => /Double-Buy Credit/.test(l.title)).length;
      const clearClick = await clickText(page, "Clear stale credit record");
      const clearPoll = await poll(
        async () => {
          const rows = (await auditRows(st.id)).filter((l) => /Double-Buy Credit/.test(l.title));
          const d = await detect(st.id);
          const b = await bidById(p23, bId);
          return { rows, card: card(d, "clash-vfd-01"), bid: b };
        },
        (s) => s.rows.length > auditsBefore && !s.card?.staleResolution,
        20000
      );
      const clearToast = await waitForToast(page, /reversed|restored|cleared/i, 8000);
      const uiCleared = await uiClash(page);
      await shot(page, "fix4-qa33-ui-stale-cleared.png", { full: true });
      const rowsNow = clearPoll?.rows || [];
      const newAudit = rowsNow.slice(0, Math.max(0, rowsNow.length - auditsBefore)).map((l) => l.title);
      record("A33-03.6", "A32-02 UI FIXED: clicking 'Clear stale credit record' clears the record, writes an audit row, keeps the bid at $480,000, drops staleResolution, and the control disappears",
        clearClick.ok && clearPoll && clearPoll.rows.length > auditsBefore && !clearPoll.card?.staleResolution &&
          clearPoll.bid?.leveledTotalCost === 480000 && creditRows(clearPoll.bid).length === 0 &&
          clearPoll.card?.status === "detected" && clearPoll.card?.redundantAmount === 38500 &&
          uiCleared.staleClearButtons.length === 0,
        { clearClick, newAudit, toast: clearToast, leveled: clearPoll?.bid?.leveledTotalCost, rows: creditRows(clearPoll?.bid).length, card: clearPoll?.card, ui: { staleClear: uiCleared.staleClearButtons, deducted: uiCleared.deductedChips, deduct: uiCleared.deductButtons } });

      // A32-02: subsequent deduct applies cleanly
      const reClick = await clickText(page, "1-Click Deduct Credit");
      const okToast = await waitForToast(page, /Credit applied|applied/i);
      const dedPoll = await poll(
        () => bidById(p23, bId),
        (b) => b && b.leveledTotalCost === 441500 && creditRows(b).length === 1 && creditRows(b)[0].isAccepted === true,
        20000
      );
      const dFinal = await detect(st.id);
      const uiFinal = await uiClash(page);
      await shot(page, "fix4-qa33-ui-stale-rededuct.png", { full: true });
      record("A33-03.7", "A32-02 UI FIXED: after the clear, clicking deduct applies cleanly — $441,500, one accepted row, card deducted $38,500, success toast",
        reClick.ok && Boolean(okToast) && /applied/i.test(okToast) &&
          dedPoll?.leveledTotalCost === 441500 && creditRows(dedPoll).length === 1 && creditRows(dedPoll)[0].isAccepted === true &&
          card(dFinal, "clash-vfd-01")?.status === "deducted" && card(dFinal, "clash-vfd-01")?.deductedAmount === 38500 &&
          uiFinal.deductedChips >= 1,
        { reClick, okToast, leveled: dedPoll?.leveledTotalCost, row: creditRows(dedPoll)[0], card: card(dFinal, "clash-vfd-01"), ui: { deducted: uiFinal.deductedChips, staleClear: uiFinal.staleClearButtons } });

      record("A33-03.8", "A31-05/UE.1 UI diagnostics: zero page errors for the whole stale/unaccept journey; every console error is the Convex client's own '[CONVEX M(...)]' refusal log (no application errors)",
        diag.pageErrors.length === 0 &&
          diag.consoleLogs.filter((l) => l.type === "error").every((l) => /^\[CONVEX M\(/.test(l.text)),
        { pageErrors: diag.pageErrors.slice(0, 3), consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 3).map((e) => e.text.slice(0, 160)) });
    } finally {
      await browser.close();
    }
  }

  writeEvidence("ui-fixes", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
  writeLog("ui-fixes", log);
  console.log(`ui-fixes: ${results.filter((r) => r.pass).length}/${results.length}`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

function rejectTrue(obj) {
  const { available, ...rest } = obj;
  return { ...rest, availableCount: available?.length ?? 0 };
}

main().catch((e) => {
  console.error(e);
  writeEvidence("ui-fixes", { results: [...results, { id: "A33-03.ERR", pass: false, name: "aborted", detail: String(e?.stack ?? e) }] });
  writeLog("ui-fixes", [...log, String(e?.stack ?? e)]);
  process.exit(1);
});