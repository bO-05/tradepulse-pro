/**
 * QA35-03 UI verification of FIX-NEW-75/76 on a fresh AUDIT-QA35-FIXUI project:
 *  precondition $26,500 manual VFD coverage entered through the real leveling Adjust modal
 *  (collapses both redundancies to exactly $12,000), then ALL through the UI:
 *   1. deduct VFD $12,000 from its card -> both cards show deducted $12,000, KPI credits $24,000
 *   2. un-accept ONLY the VFD credit in the leveling modal -> VFD card detected + stale
 *      ("Clear stale credit record"), disconnect stays deducted $12,000, KPI $12,000
 *   3. Clear stale credit record -> record cleared, disconnect unchanged, bid 441,500
 *   4. re-deduct VFD, then Reverse credit on the VFD card only -> disconnect survives,
 *      bid 441,500, KPI $12,000 (pre-fix this restored $24,000 and cleared both)
 *  Backend reconciliation (card state, KPI, credit rows, recomputed leveled) at every step.
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab, selectProjectByTitle } from "./lib.mjs";
import { client, fixtureTitle, writeEvidence, writeLog, sleep, recomputeLeveled, creditRows, creditClashId } from "./qa35-lib.mjs";

const c = client();
const BASE = "https://brainy-skunk-440.convex.site";
const TITLE = fixtureTitle("FIXUI");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const findings = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1700)}`);
};
const finding = (id, severity, title, evidence) => {
  findings.push({ id, severity, title, evidence });
  say(`FINDING ${id} [${severity}] ${title}`);
};

const VFD = "Variable Frequency Drives (VFDs) for AHUs & Pumps";
const DISC = "Rooftop Mechanical Equipment Disconnect Switches";

async function clickText(page, needle, exact = false) {
  return page.evaluate(({ needle, exact }) => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const b = [...document.querySelectorAll("button")].find((x) => {
      const t = (x.innerText || "").replace(/\s+/g, " ").trim();
      return vis(x) && (exact ? t === needle : t.includes(needle));
    });
    if (!b) return { ok: false };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true, text: (b.innerText || "").replace(/\s+/g, " ").trim() };
  }, { needle, exact });
}

async function selectPackage(page, name) {
  return page.evaluate((n) => {
    const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => (x.innerText || "").includes(n));
    if (!b) return { ok: false };
    b.click();
    return { ok: true };
  }, name);
}

async function openAdjust(page, rowNeedle) {
  return page.evaluate((rowNeedle) => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    let cand = null;
    for (const el of [...document.querySelectorAll("tr, div")].filter(vis)) {
      if ((el.innerText || "").includes(rowNeedle)) {
        if (!cand || el.innerText.length < cand.innerText.length) cand = el;
      }
    }
    if (!cand) return { ok: false, reason: "no row" };
    let node = cand;
    for (let i = 0; i < 8 && node; i++) {
      const b = [...node.querySelectorAll("button")].find((x) => vis(x) && (x.innerText || "").includes("Adjust"));
      if (b) { b.scrollIntoView({ block: "center" }); b.click(); return { ok: true, text: (b.innerText || "").trim() }; }
      node = node.parentElement;
    }
    return { ok: false, reason: "no adjust button" };
  }, rowNeedle);
}

async function modalTop(page) {
  return page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const modals = [...document.querySelectorAll("div")].filter((d) => vis(d) && (d.innerText || "").includes("Forensic Leveling Adjustments") && (d.innerText || "").includes("Save Leveling Adjustments"));
    const top = modals.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    return top ? { open: true, text: (top.innerText || "").replace(/\s+/g, " ").slice(0, 500) } : { open: false };
  });
}

async function setModalInput(page, placeholder, value) {
  return page.evaluate(({ placeholder, value }) => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const modals = [...document.querySelectorAll("div")].filter((d) => vis(d) && (d.innerText || "").includes("Forensic Leveling Adjustments") && (d.innerText || "").includes("Save Leveling Adjustments"));
    const top = modals.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!top) return false;
    const el = [...top.querySelectorAll("input")].find((i) => (i.getAttribute("placeholder") || "").includes(placeholder));
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return el.value === String(value);
  }, { placeholder, value });
}

async function toggleCredit(page, matchText) {
  return page.evaluate((matchText) => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const modals = [...document.querySelectorAll("div")].filter((d) => vis(d) && (d.innerText || "").includes("Forensic Leveling Adjustments") && (d.innerText || "").includes("Save Leveling Adjustments"));
    const top = modals.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!top) return { ok: false, reason: "no modal" };
    const rows = [...top.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("Cross-Trade Clash Credit") && (!matchText || (d.innerText || "").includes(matchText)) && d.querySelector("button"));
    const row = rows.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!row) return { ok: false, reason: "no matching credit row", text: (top.innerText || "").slice(0, 300) };
    const btn = [...row.querySelectorAll("button")][0];
    btn.click();
    return { ok: true, before: (btn.innerText || "").trim() };
  }, matchText);
}

/** Card summary for the two known clash cards. */
async function clashCards(page) {
  return page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const titles = { vfd: "Variable Frequency Drives", disc: "Rooftop Mechanical Equipment Disconnect" };
    const out = {};
    for (const [key, title] of Object.entries(titles)) {
      const cands = [...document.querySelectorAll("div")].filter((d) => vis(d) && (d.innerText || "").includes(title) && /Reverse credit|1-Click Deduct Credit|Deducted \$|Clear stale credit record/.test(d.innerText || ""));
      const el = cands.sort((a, b) => a.innerText.length - b.innerText.length)[0];
      if (!el) { out[key] = { found: false }; continue; }
      const text = (el.innerText || "").replace(/\s+/g, " ");
      const btns = [...el.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim());
      out[key] = {
        found: true,
        deducted: /Deducted \$([\d,]+) credit from proposal/.exec(text)?.[1] ?? null,
        chip: /credit deducted & leveled/i.test(text),
        stale: /stale credit/i.test(text),
        staleBtn: btns.some((x) => /Clear stale credit record/.test(x)),
        reverseBtn: btns.some((x) => /Reverse credit/.test(x)),
        deductBtn: btns.some((x) => /1-Click Deduct Credit/.test(x)),
      };
    }
    return out;
  });
}

async function clickCardButton(page, cardTitle, label) {
  return page.evaluate(({ cardTitle, label }) => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const cands = [...document.querySelectorAll("div")].filter((d) => vis(d) && (d.innerText || "").includes(cardTitle) && /Reverse credit|1-Click Deduct Credit|Clear stale credit record|Deducted \$/.test(d.innerText || ""));
    const el = cands.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!el) return { ok: false, reason: "no card" };
    const b = [...el.querySelectorAll("button")].find((x) => vis(x) && (x.innerText || "").replace(/\s+/g, " ").trim().includes(label));
    if (!b) return { ok: false, reason: "no button", buttons: [...el.querySelectorAll("button")].map((x) => (x.innerText || "").trim()) };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true, text: (b.innerText || "").replace(/\s+/g, " ").trim() };
  }, { cardTitle, label });
}

async function uiKpis(page) {
  return page.evaluate(() => {
    const t = (document.querySelector("main") || document.body).innerText.replace(/\n/g, " ");
    const grab = (label) => new RegExp(label + "\\s*\\$?([\\d,]+)").exec(t)?.[1] ?? null;
    const labels = [...document.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim());
    return {
      doubleBuys: grab("Redundant Double-Buys"),
      credits: grab("Recoverable Buyout Credits"),
      deductedChips: (t.match(/credit deducted & leveled/gi) || []).length,
      staleButtons: labels.filter((x) => /Clear stale credit record/.test(x)).length,
    };
  });
}

const bidById = async (pkgId, bidId) => (await c.query("bids:listByPackage", { tradePackageId: pkgId })).find((b) => b._id === bidId);
const cardOf = (d, id) => d.doubleBuys.find((x) => x.id === id);
const toastText = (page) => page.evaluate(() => [...document.querySelectorAll('[role="status"],[aria-live="polite"]')].map((e) => (e.innerText || "").trim()).filter(Boolean).join(" | "));

async function poll(fn, pred, timeoutMs = 45000, stepMs = 1200) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    last = await fn();
    if (pred(last)) return last;
    await sleep(stepMs);
  }
  return last;
}

async function main() {
  // fresh FIXUI project (backend for speed; the manual coverage itself is UI-entered)
  for (const p of ((await c.query("projects:listProjects", {})) || []).filter((x) => x.title === TITLE)) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try { await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA35 UI fixture purge." }); } catch {}
    }
    try { await c.mutation("projects:deleteProject", { projectId: p._id }); } catch {}
  }
  const dl = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  const id = await c.mutation("projects:createProject", { title: TITLE, location: "Austin, TX", projectType: "Class-A Commercial", estBudget: 1600000, targetCompletionWeeks: 52, specDocumentText: "QA35 FIX UI scope.", isDemoProject: false, generalContractorName: "QA35 FIX UI GC" });
  const p26 = await c.mutation("tradePackages:createTradePackage", { projectId: id, csiDivision: "26 00 00", tradeName: "QA35 FIXUI Electrical", budgetEstimate: 900000, scopeSummary: "Electrical scope.", mandatoryInclusions: ["General scope"], bidDeadline: dl });
  const p23 = await c.mutation("tradePackages:createTradePackage", { projectId: id, csiDivision: "23 00 00", tradeName: "QA35 FIXUI HVAC", budgetEstimate: 600000, scopeSummary: "HVAC scope.", mandatoryInclusions: ["General scope"], bidDeadline: dl });
  const c26 = await c.mutation("contractors:createContractor", { tradePackageId: p26, companyName: "AUDIT-QA35 FIXUI Electric", contactEmail: "estimating@qa35-fixui-e.invalid", phone: "+1 (206) 555-0101", licenseNumber: "TX-QA35-FIXUI-E", licenseStatus: "Active / Verified (QA35)", sourceUrl: "https://qa35.example.invalid/license", rfqStatus: "invited" });
  const c23 = await c.mutation("contractors:createContractor", { tradePackageId: p23, companyName: "AUDIT-QA35 FIXUI Mechanical", contactEmail: "estimating@qa35-fixui-m.invalid", phone: "+1 (206) 555-0102", licenseNumber: "TX-QA35-FIXUI-M", licenseStatus: "Active / Verified (QA35)", sourceUrl: "https://qa35.example.invalid/license", rfqStatus: "invited" });
  const b26 = await c.mutation("bids:submitDirectBid", { tradePackageId: p26, contractorId: c26, subcontractorName: "AUDIT-QA35 FIXUI Electric", baseBidAmount: 800000, coiComplianceStatus: "compliant", coiPenalty: 0 });
  const b23 = await c.mutation("bids:submitDirectBid", { tradePackageId: p23, contractorId: c23, subcontractorName: "AUDIT-QA35 FIXUI Mechanical", baseBidAmount: 480000, coiComplianceStatus: "compliant", coiPenalty: 0 });
  const BID = b23.bidId;
  say(`project=${id} p23=${p23} bid23=${BID}`);

  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  try {
    await page.goto(`${BASE}/?qa35=fixui`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
    await selectProjectByTitle(page, TITLE);
    await delay(1500);

    // ---- 1. precondition via the real leveling UI: accepted manual VFD credit $26,500 ----
    await clickTab(page, "Bid Leveling");
    await delay(1600);
    await selectPackage(page, "QA35 FIXUI HVAC");
    await delay(1200);
    const openAdj = await openAdjust(page, "AUDIT-QA35 FIXUI Mechanical");
    await delay(900);
    const descSet = await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const modals = [...document.querySelectorAll("div")].filter((d) => vis(d) && (d.innerText || "").includes("Forensic Leveling Adjustments") && (d.innerText || "").includes("Save Leveling Adjustments"));
      const top = modals.sort((a, b) => a.innerText.length - b.innerText.length)[0];
      const el = top && [...top.querySelectorAll("input")].find((i) => (i.getAttribute("placeholder") || "").includes("Add new VE alternate"));
      if (!el) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "VFD factory pricing credit (manual entry)");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value.length > 0;
    });
    const amtSet = await setModalInput(page, "Deduct $", 26500);
    const addAlt = await clickText(page, "Add Alternate");
    await delay(500);
    const saveAlt = await clickText(page, "Save Leveling Adjustments");
    const b1 = await poll(() => bidById(p23, BID), (b) => b?.leveledTotalCost === 453500);
    const detect1 = await c.query("coordination:detectCrossTradeClashes", { projectId: id });
    const vfd1 = cardOf(detect1, "clash-vfd-01");
    const disc1 = cardOf(detect1, "clash-disconnect-02");
    record("A35-UI.1", "precondition via the real leveling modal: accepted manual VFD $26,500 -> bid 453,500, both redundancies exactly $12,000, leveled == recompute",
      descSet && amtSet && addAlt.ok && saveAlt.ok && b1?.leveledTotalCost === 453500 && recomputeLeveled(b1) === 453500 && vfd1.redundantAmount === 12000 && disc1.redundantAmount === 12000,
      { openAdj, amtSet, addAlt, saveAlt, leveled: b1?.leveledTotalCost, vfd: vfd1.redundantAmount, disc: disc1.redundantAmount });

    // ---- 2. deduct BOTH $12,000 credits from their own cards ----
    await clickTab(page, "Scope Clash");
    await delay(1800);
    const k0 = await uiKpis(page);
    const dedVfd = await clickCardButton(page, "Variable Frequency Drives", "1-Click Deduct Credit");
    const b2 = await poll(() => bidById(p23, BID), (b) => b?.leveledTotalCost === 441500);
    await delay(900);
    const dedDisc = await clickCardButton(page, "Rooftop Mechanical Equipment Disconnect", "1-Click Deduct Credit");
    const b3 = await poll(() => bidById(p23, BID), (b) => b?.leveledTotalCost === 429500);
    await delay(1200);
    const k1 = await uiKpis(page);
    const cards1 = await clashCards(page);
    const detect2 = await c.query("coordination:detectCrossTradeClashes", { projectId: id });
    const vfd2 = cardOf(detect2, "clash-vfd-01");
    const disc2 = cardOf(detect2, "clash-disconnect-02");
    const rows3 = creditRows(b3).map((v) => ({ clashId: creditClashId(v.description), amount: v.costDeduct, accepted: v.isAccepted }));
    const bothShow = vfd2.status === "deducted" && vfd2.deductedAmount === 12000 && disc2.status === "deducted" && disc2.deductedAmount === 12000;
    record("A35-UI.2", "equal-amount credits through the UI: both cards show deducted $12,000, KPI credits $24,000, 2 chips; bid 429,500; KPI == real money",
      dedVfd.ok && dedDisc.ok && b3?.leveledTotalCost === 429500 && recomputeLeveled(b3) === 429500 && bothShow &&
        k1.credits === "24,000" && k1.deductedChips === 2 && rows3.length === 2 && rows3.every((r) => r.amount === 12000 && r.accepted) &&
        cards1.vfd?.deducted === "12,000" && cards1.disc?.deducted === "12,000" && cards1.vfd?.chip === true && cards1.disc?.chip === true,
      { dedVfd, dedDisc, leveled: b3?.leveledTotalCost, k0, k1, cards1, backendCards: { vfd: { s: vfd2.status, a: vfd2.deductedAmount }, disc: { s: disc2.status, a: disc2.deductedAmount } }, rows3 });

    // ---- 3. un-accept ONLY the VFD credit in the leveling modal ----
    await clickTab(page, "Bid Leveling");
    await delay(1500);
    await selectPackage(page, "QA35 FIXUI HVAC");
    await delay(1000);
    await openAdjust(page, "AUDIT-QA35 FIXUI Mechanical");
    await delay(900);
    const modalBefore = await modalTop(page);
    const t1 = await toggleCredit(page, "Variable Frequency");
    await delay(300);
    const saveDecline = await clickText(page, "Save Leveling Adjustments");
    const b4 = await poll(() => bidById(p23, BID), (b) => b?.leveledTotalCost === 441500);
    const rows4 = (b4.valueEngineeringAlternates || []).filter((v) => /^Cross-Trade Clash Credit/.test(v.description)).map((v) => ({ clashId: creditClashId(v.description), accepted: v.isAccepted }));
    await clickTab(page, "Scope Clash");
    await delay(1800);
    const k2 = await uiKpis(page);
    const cards2 = await clashCards(page);
    const detect3 = await c.query("coordination:detectCrossTradeClashes", { projectId: id });
    const vfd3 = cardOf(detect3, "clash-vfd-01");
    const disc3 = cardOf(detect3, "clash-disconnect-02");
    const phantom = vfd3.status === "deducted" || k2.credits === "24,000" || cards2.vfd?.deducted !== null;
    if (phantom) {
      finding("A35-01", "Medium", "UI equal-amount masking still present: VFD card shows a deducted credit after its own credit was declined", { card: { status: vfd3.status, stale: vfd3.staleResolution, amount: vfd3.deductedAmount }, kpi: k2, cards: cards2 });
    }
    record("A35-UI.3", "un-accept ONLY the VFD credit via the modal: VFD card detected + stale ('Clear stale credit record'), disconnect card stays deducted $12,000, KPI credits $12,000; bid 441,500 == recompute",
      t1.ok && saveDecline.ok && b4?.leveledTotalCost === 441500 && recomputeLeveled(b4) === 441500 &&
        vfd3.status === "detected" && vfd3.staleResolution === true && (vfd3.deductedAmount === undefined || vfd3.deductedAmount === null) &&
        disc3.status === "deducted" && disc3.deductedAmount === 12000 && k2.credits === "12,000" && k2.doubleBuys === "12,000" &&
        k2.staleButtons === 1 && k2.deductedChips === 1 && cards2.vfd?.staleBtn === true && cards2.disc?.deducted === "12,000" &&
        rows4.some((r) => r.clashId === "clash-vfd-01" && r.accepted === false) && rows4.some((r) => r.clashId === "clash-disconnect-02" && r.accepted === true),
      { modalBefore, t1, saveDecline, leveled: b4?.leveledTotalCost, k2, cards2, backend: { vfd: { s: vfd3.status, stale: vfd3.staleResolution, a: vfd3.deductedAmount }, disc: { s: disc3.status, a: disc3.deductedAmount } }, rows4 });

    // ---- 4. Clear stale credit record -> only VFD record cleared ----
    const clearClick = await clickCardButton(page, "Variable Frequency Drives", "Clear stale credit record");
    const clearToast = await poll(() => toastText(page), (t) => Boolean(t) && /revers|clear/i.test(t), 12000, 400);
    await delay(1000);
    const b5 = await bidById(p23, BID);
    const detect4 = await c.query("coordination:detectCrossTradeClashes", { projectId: id });
    const vfd4 = cardOf(detect4, "clash-vfd-01");
    const disc4 = cardOf(detect4, "clash-disconnect-02");
    const k3 = await uiKpis(page);
    const rows5 = creditRows(b5).map((v) => ({ clashId: creditClashId(v.description), accepted: v.isAccepted }));
    record("A35-UI.4", "Clear stale credit record through the UI: VFD row gone, resolution cleared, disconnect card still deducted $12,000; bid unchanged 441,500; KPI $12,000",
      clearClick.ok && Boolean(clearToast) && b5.leveledTotalCost === 441500 && recomputeLeveled(b5) === 441500 &&
        vfd4.status === "detected" && !vfd4.staleResolution && disc4.status === "deducted" && disc4.deductedAmount === 12000 &&
        rows5.length === 1 && rows5[0].clashId === "clash-disconnect-02" && k3.credits === "12,000" && k3.staleButtons === 0,
      { clearClick, clearToast, leveled: b5.leveledTotalCost, vfd: { s: vfd4.status, stale: vfd4.staleResolution }, disc: { s: disc4.status, a: disc4.deductedAmount }, rows5, k3 });

    // ---- 5. re-deduct VFD, then Reverse credit on the VFD card only (over-reversal guard) ----
    const dedVfd2 = await clickCardButton(page, "Variable Frequency Drives", "1-Click Deduct Credit");
    const b6 = await poll(() => bidById(p23, BID), (b) => b?.leveledTotalCost === 429500);
    await delay(1000);
    const k4 = await uiKpis(page);
    await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 8000) { if (!(await toastText(page))) return; await sleep(300); } })();
    const rev = await clickCardButton(page, "Variable Frequency Drives", "Reverse credit");
    const revToast = await poll(() => toastText(page), (t) => Boolean(t) && /revers/i.test(t), 15000, 300);
    await delay(1200);
    const b7 = await poll(() => bidById(p23, BID), (b) => b?.leveledTotalCost === 441500);
    const k5 = await uiKpis(page);
    const cards3 = await clashCards(page);
    const detect5 = await c.query("coordination:detectCrossTradeClashes", { projectId: id });
    const vfd5 = cardOf(detect5, "clash-vfd-01");
    const disc5 = cardOf(detect5, "clash-disconnect-02");
    const rows7 = creditRows(b7).map((v) => ({ clashId: creditClashId(v.description), amount: v.costDeduct, accepted: v.isAccepted }));
    const audit5 = ((await c.query("auditLogs:listRecentLogs", { projectId: id, limit: 200 })) || []).find((l) => /Double-Buy Credit Reversed: \$12,000/.test(l.title));
    const overReversed = b7?.leveledTotalCost === 453500 || rows7.length === 0 || disc5.status !== "deducted";
    if (overReversed) {
      finding("A35-02", "Medium", "UI over-reversal with equal-amount credits: reversing the VFD credit removed the disconnect credit too", { leveled: b7?.leveledTotalCost, rows7, disc: { s: disc5.status, stale: disc5.staleResolution }, cards: cards3 });
    }
    record("A35-UI.5", "UI reverse VFD only: disconnect row survives accepted, disconnect card still deducted $12,000; bid 441,500 == recompute; KPI credits $12,000; audit $12,000",
      dedVfd2.ok && rev.ok && Boolean(revToast) && b7?.leveledTotalCost === 441500 && recomputeLeveled(b7) === 441500 &&
        vfd5.status === "detected" && disc5.status === "deducted" && disc5.deductedAmount === 12000 &&
        rows7.length === 1 && rows7[0].clashId === "clash-disconnect-02" && rows7[0].accepted === true &&
        k5.credits === "12,000" && k5.deductedChips === 1 && cards3.disc?.deducted === "12,000" && Boolean(audit5),
      { dedVfd2, rev, revToast, leveled: b7?.leveledTotalCost, k4, k5, cards3, backend: { vfd: { s: vfd5.status }, disc: { s: disc5.status, a: disc5.deductedAmount } }, rows7, audit: audit5?.description });

    // ---- 6. diagnostics ----
    const consoleErrors = diag.consoleLogs.filter((l) => l.type === "error");
    const appFailed = diag.failedRequests.filter((f) => !/favicon/i.test(f));
    record("A35-UI.6", "UI run diagnostics: zero pageerrors, zero failed app requests; no unexpected console errors",
      diag.pageErrors.length === 0 && appFailed.length === 0,
      { pageErrors: diag.pageErrors.slice(0, 3), consoleErrors: consoleErrors.slice(0, 4).map((e) => e.text.slice(0, 140)), failed: appFailed.slice(0, 4) });

    await shot(page, "fix4-qa35-ui-final.png", { full: true });
    writeEvidence("fix-ui", { projectId: id, p26, p23, bid23: BID, results, findings, summary: { pass: results.filter((r) => r.pass).length, total: results.length, findings: findings.length } });
    writeLog("fix-ui", log);
    console.log(`fix-ui: ${results.filter((r) => r.pass).length}/${results.length} pass, ${findings.length} findings`);
  } catch (err) {
    writeEvidence("fix-ui", { results: [...results, { id: "A35-03.ERR", pass: false, name: "aborted", detail: String(err?.stack ?? err) }], findings });
    writeLog("fix-ui", [...log, String(err?.stack ?? err)]);
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("fix-ui-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});