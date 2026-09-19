/**
 * QA28-04 full bid-day UI journey on a fresh project (created through the dialogs):
 * create -> Div26 + Div23 packages -> contractors -> bids -> clash scan -> deduct
 * -> assign -> award -> execute -> void -> re-award, reconciling backend vs UI at
 * every step. Bids are submitted through the same public mutation the LLM ingest
 * UI calls (no deterministic direct-bid UI exists; LLM/BYOK excluded).
 * Project title: AUDIT-QA28-JOURNEY.
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab, selectProjectByTitle } from "./lib.mjs";
import { client, fixtureTitle, writeEvidence, writeLog, EVIDENCE_DIR, sleep } from "./qa28-lib.mjs";

const c = client();
const BASE = "https://brainy-skunk-440.convex.site";
const TITLE = fixtureTitle("JOURNEY");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const reconcile = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1500)}`);
};

async function clickText(page, needle, exact = false) {
  return page.evaluate(
    ({ needle, exact }) => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const b = [...document.querySelectorAll("button")].find((x) => {
        const t = (x.innerText || "").replace(/\s+/g, " ").trim();
        return vis(x) && (exact ? t === needle : t.includes(needle));
      });
      if (!b) return { ok: false, available: [...document.querySelectorAll("button")].map((x) => (x.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 60) };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, text: (b.innerText || "").replace(/\s+/g, " ").trim(), disabled: b.disabled };
    },
    { needle, exact }
  );
}

async function clickNth(page, needle, n) {
  return page.evaluate(
    ({ needle, n }) => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const bs = [...document.querySelectorAll("button")].filter((x) => vis(x) && (x.innerText || "").includes(needle));
      const b = bs[n];
      if (!b) return { ok: false, count: bs.length, texts: bs.map((x) => (x.innerText || "").replace(/\s+/g, " ").trim()) };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, text: (b.innerText || "").replace(/\s+/g, " ").trim(), count: bs.length };
    },
    { needle, n }
  );
}

async function selectPackage(page, name) {
  return page.evaluate((n) => {
    const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => (x.innerText || "").includes(n));
    if (!b) return { ok: false, available: [...document.querySelectorAll("button[aria-pressed]")].map((x) => (x.innerText || "").trim()) };
    b.click();
    return { ok: true, text: (b.innerText || "").trim(), pressed: b.getAttribute("aria-pressed") };
  }, name);
}

async function setVal(page, sel, val) {
  return page.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return el.value === val;
  }, { sel, val });
}

async function typeInto(page, selector, value) {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type(selector, value, { delay: 12 });
}

async function poll(fn, pred, timeoutMs, stepMs) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    last = await fn();
    if (pred(last)) return last;
    await sleep(stepMs);
  }
  return last;
}

async function dialogInfo(page) {
  return page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const ds = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(vis);
    const top = ds[ds.length - 1] || null;
    if (!top) return { open: false };
    return {
      open: true,
      role: top.getAttribute("role"),
      title: (top.querySelector("h2,h3") || {}).innerText || null,
      body: (top.innerText || "").slice(0, 260),
      buttons: [...top.querySelectorAll("button")].map((b) => (b.innerText || "").trim()).slice(0, 14),
    };
  });
}

const bodyText = (page) => page.evaluate(() => document.body.innerText);
const mainText = (page) => page.evaluate(() => (document.querySelector("main") || document.body).innerText);

async function uiClashKpis(page) {
  return page.evaluate(() => {
    const t = (document.querySelector("main") || document.body).innerText.replace(/\n/g, " ");
    const grab = (label) => {
      const re = new RegExp(label + "\\s*\\$?([\\d,]+)");
      return re.exec(t)?.[1] ?? null;
    };
    return {
      doubleBuys: grab("Redundant Double-Buys"),
      voids: grab("Unassigned Scope Voids"),
      credits: grab("Recoverable Buyout Credits"),
      risk: /Coordination Risk Level\s*(Resolved|Active Audit)/.exec(t)?.[1] ?? null,
      deductedChips: (t.match(/Credit Deducted & Leveled/g) || []).length,
      assignedChips: (t.match(/Scope Assigned & Covered/g) || []).length,
      raw: t.slice(0, 900),
    };
  });
}

async function uiRegisterTable(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll("table tbody tr")].map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => (td.innerText || "").replace(/\s+/g, " ").trim())
    );
    const t = (document.querySelector("main") || document.body).innerText.replace(/\s+/g, " ");
    return {
      rows,
      sum: /ACTIVE CONTRACTED SUM\s*\$([\d,]+)/i.exec(t)?.[1] ?? null,
      exec: /EXECUTION STATUS RECORDED\s*(\d+)\s*\/\s*(\d+)/i.exec(t) ? `${RegExp.$1}/${RegExp.$2}` : null,
      chips: [...document.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()).filter((x) => /^(Active Contracts|Execution Status Recorded|Pending Execution|Superseded)/.test(x)),
      text: t.slice(0, 700),
    };
  });
}

async function main() {
  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);

  // purge prior journey fixture
  for (const p of ((await c.query("projects:listProjects", {})) || []).filter((x) => x.title === TITLE)) {
    const agrs0 = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs0.filter((x) => x.status === "executed")) {
      try { await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA28 journey purge of prior run executed record." }); } catch {}
    }
    try { await c.mutation("projects:deleteProject", { projectId: p._id }); } catch {}
  }

  try {
    // ---------- 1. create project through the dialog ----------
    await page.goto(`${BASE}/?qa28=journey`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await page.evaluate(() => { localStorage.removeItem("tradepulse.selectedProjectId"); localStorage.removeItem("tradepulse.selectedPackageId"); });
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
    await delay(900);
    await clickText(page, "New Project");
    await delay(700);
    const npFills = {
      title: await setVal(page, 'input[aria-label="Project title"]', TITLE),
      location: await setVal(page, 'input[aria-label="Project location"]', "Honolulu, HI"),
      type: await setVal(page, 'input[aria-label="Project type"]', "Healthcare / Mixed-Use"),
      gc: await setVal(page, 'input[aria-label="General contractor or contracting entity"]', "QA28 Journey GC, LLC"),
      budget: await setVal(page, 'input[aria-label="Estimated budget in dollars"]', "2000000"),
      weeks: await setVal(page, 'input[aria-label="Target completion duration in weeks"]', "52"),
      spec: await setVal(page, 'textarea[placeholder*="Outline high-level trade scopes"]', "Division 26 electrical and Division 23 HVAC scope for the QA28 journey."),
    };
    const npClick = await page.evaluate(() => {
      const ds = [...document.querySelectorAll('[role="dialog"]')].filter((x) => x.getBoundingClientRect().width > 1);
      const d = ds[ds.length - 1];
      const b = d && [...d.querySelectorAll("button")].find((x) => /Create Commercial Project/.test(x.innerText || ""));
      if (!b) return { ok: false };
      b.click();
      return { ok: true, disabled: b.disabled };
    });
    let proj = await poll(() => c.query("projects:listProjects", {}).then((ps) => ps.find((p) => p.title === TITLE)), (p) => Boolean(p), 90000, 2000);
    await delay(2000);
    record("A28-04.1", "fresh project created through the UI dialog", Boolean(proj) && Object.values(npFills).every(Boolean) && npClick.ok, { id: proj?._id, npFills, npClick });
    if (!proj) throw new Error("journey project not created");
    await selectProjectByTitle(page, TITLE);
    await delay(1200);

    // ---------- 2. two packages through the UI ----------
    await clickTab(page, "CSI Scoping");
    await delay(1400);
    const d = new Date(Date.now() + 14 * 86400000);
    const localD = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const SAFE_INC = "All labor and materials per plans and specifications";
    const mkPkgUI = async (csi, name, budget) => {
      const open = await clickText(page, "Create Trade Package");
      await delay(800);
      const filled = {
        csi: await setVal(page, 'input[aria-label="CSI division number"]', csi),
        name: await setVal(page, 'input[aria-label="Trade package name"]', name),
        budget: await setVal(page, 'input[aria-label="Budget estimate in dollars"]', budget),
        scope: await setVal(page, 'textarea[aria-label="Scope summary"]', `${name} scope per CSI ${csi}.`),
        inclusions: await setVal(page, 'textarea[aria-label="Mandatory inclusions, one per line"]', SAFE_INC),
        deadline: await setVal(page, 'input[aria-label="Bid deadline"]', localD),
      };
      const go = await clickText(page, "Create Package");
      await delay(1500);
      return { open, filled, go };
    };
    const mk26 = await mkPkgUI("26 00 00", "QA28 Journey Electrical", "900000");
    const pkgs1 = await poll(() => c.query("tradePackages:listByProject", { projectId: proj._id }), (x) => (x || []).length >= 1, 40000, 1200);
    const p26 = (pkgs1 || []).find((p) => p.csiDivision.startsWith("26"));
    const mk23 = await mkPkgUI("23 00 00", "QA28 Journey HVAC", "600000");
    const pkgs2 = await poll(() => c.query("tradePackages:listByProject", { projectId: proj._id }), (x) => (x || []).length >= 2, 40000, 1200);
    const p23 = (pkgs2 || []).find((p) => p.csiDivision.startsWith("23"));
    record("A28-04.2", "Div26 + Div23 packages created through the UI dialog with safe inclusion wording",
      mk26.go.ok && mk23.go.ok && Boolean(p26) && Boolean(p23) && Object.values(mk23.filled).every(Boolean),
      { p26: p26?._id, p23: p23?._id, inclusions: p26?.mandatoryInclusions, filled23: mk23.filled });
    if (!p26 || !p23) throw new Error("packages not created");

    // ---------- 3. contractors through the UI for both packages ----------
    const addCtr = async (pkgName, company, email, lic) => {
      await clickTab(page, "Discovery");
      await delay(1500);
      await selectPackage(page, pkgName);
      await delay(700);
      await clickText(page, "Add Contractor Manually");
      await delay(800);
      await typeInto(page, 'input[placeholder*="Rosendin"]', company);
      await typeInto(page, 'input[placeholder*="estimating@rosendin"]', email);
      await typeInto(page, 'input[placeholder*="TECL"]', lic);
      const go = await clickText(page, "Add to Directory");
      await delay(2200);
      return go;
    };
    const ctrGo1 = await addCtr(p26.tradeName, "AUDIT-QA28 Journey Prime", "estimating@qa28-journey-e.invalid", "HI-QA28-JE");
    const ctrGo2 = await addCtr(p23.tradeName, "AUDIT-QA28 Journey Mechanical", "estimating@qa28-journey-m.invalid", "HI-QA28-JM");
    const ctrs26 = await c.query("contractors:listByPackage", { tradePackageId: p26._id });
    const ctrs23 = await c.query("contractors:listByPackage", { tradePackageId: p23._id });
    const ctr26 = (ctrs26 || []).find((x) => /QA28 Journey Prime/.test(x.companyName));
    const ctr23 = (ctrs23 || []).find((x) => /QA28 Journey Mechanical/.test(x.companyName));
    record("A28-04.3", "contractors added through the UI for both packages",
      ctrGo1.ok && ctrGo2.ok && Boolean(ctr26) && Boolean(ctr23),
      { c26: ctr26?.companyName, c23: ctr23?.companyName });

    // ---------- 4. bids (public mutation the ingest UI uses) ----------
    const bid26 = await c.mutation("bids:submitDirectBid", {
      tradePackageId: p26._id, contractorId: ctr26._id, subcontractorName: ctr26.companyName,
      baseBidAmount: 800000, coiComplianceStatus: "compliant", coiPenalty: 0,
    });
    const bid23 = await c.mutation("bids:submitDirectBid", {
      tradePackageId: p23._id, contractorId: ctr23._id, subcontractorName: ctr23.companyName,
      baseBidAmount: 470000, coiComplianceStatus: "compliant", coiPenalty: 0,
    });
    reconcile.push({ step: "bids", backend: { b26: bid26.leveledTotalCost, b23: bid23.leveledTotalCost } });
    record("A28-04.4", "bids submitted (backend submitDirectBid; no deterministic direct-bid UI exists — AI ingest is LLM/BYOK and excluded)",
      bid26.leveledTotalCost === 800000 && bid23.leveledTotalCost === 470000,
      { bid26, bid23, limitation: "UI has only AI quote ingestion (Extract & Level Bid), which is LLM-backed" });

    // ---------- 5. cross-trade pre-state + scan through the UI ----------
    await clickTab(page, "Scope Clash");
    await delay(1800);
    const kpi0 = await uiClashKpis(page);
    reconcile.push({ step: "clash-pre", backend: { buys: 50500, voids: 46500, credits: 0 }, ui: kpi0 });
    record("A28-04.5", "cross-trade pre-state: UI KPI matches backend card totals (buys $50,500, voids $46,500, credits $0, no resolved chips)",
      kpi0.doubleBuys === "50,500" && kpi0.voids === "46,500" && kpi0.credits === "0" && kpi0.deductedChips === 0 && kpi0.assignedChips === 0,
      { kpi0 });

    const scanTry = await clickText(page, "Run Forensic Clash Scan");
    const scanMsg = await poll(
      () => page.evaluate(() => {
        const t = (document.querySelector("main") || document.body).innerText;
        const m = /Cross-trade scan complete:[^\n]*/.exec(t);
        return m ? m[0] : null;
      }),
      (m) => Boolean(m),
      90000,
      2000
    );
    let scanBackend = null;
    try { scanBackend = await c.action("coordination:scanCrossTradeClashes", { projectId: proj._id }); } catch {}
    record("A28-04.6", "UI clash scan banner reconciles with the backend scan message (or graceful refusal captured)",
      scanTry.ok && Boolean(scanMsg) && scanBackend?.analyzed === true && scanMsg === scanBackend.message,
      { click: scanTry, uiMessage: scanMsg, backendMessage: scanBackend?.message ?? null });

    // ---------- 6. 1-click deduct through the UI ----------
    const dedClick = await clickNth(page, "1-Click Deduct Credit", 0);
    const b23after = await poll(
      () => c.query("bids:listByPackage", { tradePackageId: p23._id }).then((bs) => bs.find((b) => b._id === bid23.bidId)),
      (b) => (b?.valueEngineeringAlternates || []).length > 0,
      40000,
      1500
    );
    await delay(1500);
    const kpi1 = await uiClashKpis(page);
    const detect1 = await c.query("coordination:detectCrossTradeClashes", { projectId: proj._id });
    const vfdCard = detect1.doubleBuys.find((x) => x.id === "clash-vfd-01");
    reconcile.push({ step: "deduct", backend: { leveled: b23after?.leveledTotalCost, deductedAmount: vfdCard?.deductedAmount }, ui: kpi1 });
    record("A28-04.7", "UI 1-click deduct: HVAC bid -$38,500 and card/KPI reconcile (credits $38,500; remaining buys $12,000)",
      dedClick.ok && b23after?.leveledTotalCost === 431500 && vfdCard?.deductedAmount === 38500 &&
        kpi1.credits === "38,500" && kpi1.doubleBuys === "12,000" && kpi1.deductedChips === 1,
      { dedClick, leveled: b23after?.leveledTotalCost, card: { status: vfdCard?.status, deductedAmount: vfdCard?.deductedAmount }, kpi1 });

    // ---------- 7. assign void through the UI ----------
    const asgClick = await clickNth(page, "Assign to Div 26 (Electrical)", 0);
    const b26after = await poll(
      () => c.query("bids:listByPackage", { tradePackageId: p26._id }).then((bs) => bs.find((b) => b._id === bid26.bidId)),
      (b) => (b?.baseBidAmount || 0) > 800000,
      40000,
      1500
    );
    await delay(1500);
    const kpi2 = await uiClashKpis(page);
    const detect2 = await c.query("coordination:detectCrossTradeClashes", { projectId: proj._id });
    const basCard = detect2.scopeVoids.find((x) => x.id === "void-bas-wiring-01");
    const p26now = (await c.query("tradePackages:listByProject", { projectId: proj._id })).find((x) => x._id === p26._id);
    reconcile.push({ step: "assign", backend: { base: b26after?.baseBidAmount, status: basCard?.status, inclusion: (p26now?.mandatoryInclusions || []).some((i) => i.includes("BAS")) }, ui: kpi2 });
    record("A28-04.8", "UI assign scope void: Div26 bid +$28,000, inclusion + overlay assigned, KPI voids fall to $18,500",
      asgClick.ok && b26after?.baseBidAmount === 828000 && basCard?.status === "assigned" &&
        (p26now?.mandatoryInclusions || []).some((i) => i.includes("BAS")) &&
        kpi2.voids === "18,500" && kpi2.assignedChips === 1 && kpi2.credits === "38,500",
      { asgClick, base: b26after?.baseBidAmount, card: basCard ? { status: basCard.status, assignedTo: basCard.assignedToTradeName } : null, kpi2 });

    // ---------- 8. award through the UI ----------
    await clickTab(page, "Bid Leveling");
    await delay(1600);
    await selectPackage(page, p26.tradeName);
    await delay(1200);
    const award1 = await clickText(page, "Award Compliant Winner");
    const awardTry = award1.ok ? award1 : await clickText(page, "Award Subcontract & Draft Agreement");
    const agrs1 = await poll(() => c.query("agreements:listAgreements", { projectId: proj._id }), (x) => (x || []).some((a) => a.status === "generated"), 60000, 2000);
    const agr = (agrs1 || []).find((a) => a.status === "generated");
    await delay(1500);
    const awardRow = ((await c.query("auditLogs:listRecentLogs", { projectId: proj._id, limit: 300 })) || []).find((l) => /AIA A401 Subcontract Agreement Awarded/.test(l.title));
    reconcile.push({ step: "award", backend: { number: agr?.agreementNumber, status: agr?.status, sum: agr?.contractSum }, ui: { awardTry } });
    record("A28-04.9", "UI award generates the agreement; audit description says 'generated ... pending external execution' (no executed claim)",
      awardTry.ok && agr?.contractSum === 828000 && Boolean(awardRow) &&
        /generated for CSI Division 26/.test(awardRow.description) && /pending external execution/.test(awardRow.description) && !/Executed subcontract/i.test(awardRow.description),
      { agr: { n: agr?.agreementNumber, s: agr?.status, sum: agr?.contractSum }, awardRow: awardRow ? { title: awardRow.title, description: awardRow.description } : null });

    // ---------- 9. execute through the UI ----------
    await page.keyboard.press("Escape");
    await delay(500);
    await clickTab(page, "Subcontracts");
    await delay(1800);
    await clickText(page, "Inspect Draft");
    await delay(1200);
    const execOpen1 = await clickText(page, "Record External Execution");
    const execOpen = execOpen1.ok ? execOpen1 : await clickText(page, "Record Execution Status");
    await delay(800);
    const execDlg = await dialogInfo(page);
    await clickText(page, "Record execution", true);
    const agrs2 = await poll(() => c.query("agreements:listAgreements", { projectId: proj._id }), (x) => (x || []).some((a) => a.status === "executed"), 45000, 1500);
    await delay(1500);
    const execRow = ((await c.query("auditLogs:listRecentLogs", { projectId: proj._id, limit: 300 })) || []).find((l) => /Execution Status Recorded/.test(l.title));
    const viewerText = await mainText(page);
    reconcile.push({ step: "execute", backend: { executed: (agrs2 || []).some((a) => a.status === "executed") }, ui: { execOpen, dialog: execDlg.title } });
    record("A28-04.10", "UI execution: status executed; audit says 'Execution status recorded ... external signature verification remains required'; viewer shows RECORDED • SIGNATURE REQUIRED",
      execOpen.ok && execDlg.open && (agrs2 || []).some((a) => a.status === "executed") &&
        Boolean(execRow) && /external signature verification remains required/.test(execRow.description) &&
        /RECORDED • SIGNATURE REQUIRED/.test(viewerText),
      { execDlg: { title: execDlg.title, buttons: execDlg.buttons }, execRow: execRow ? execRow.description : null, viewerHasBadge: /RECORDED • SIGNATURE REQUIRED/.test(viewerText) });

    // ---------- 10. void through the UI ----------
    const voidOpen = await clickText(page, "Void execution record");
    await delay(800);
    const voidDlg = await dialogInfo(page);
    await clickText(page, "Void execution record", true);
    const agrs3 = await poll(() => c.query("agreements:listAgreements", { projectId: proj._id }), (x) => (x || []).some((a) => a.status === "superseded"), 45000, 1500);
    await delay(1800);
    const voidRow = ((await c.query("auditLogs:listRecentLogs", { projectId: proj._id, limit: 300 })) || []).find((l) => /Executed Subcontract Voided/.test(l.title));
    const reg1 = await uiRegisterTable(page);
    const bid26afterVoid = (await c.query("bids:listByPackage", { tradePackageId: p26._id })).find((b) => b._id === bid26.bidId);
    reconcile.push({ step: "void", backend: { status: (agrs3 || []).find((a) => a._id === agr?._id)?.status, bidAwarded: bid26afterVoid?.isAwarded }, ui: reg1 });
    record("A28-04.11", "UI void: agreement superseded, bid unawarded; register shows the superseded row and no executed claim; audit says the recorded execution was voided with reason",
      voidOpen.ok && voidDlg.open && (agrs3 || []).some((a) => a.status === "superseded") && bid26afterVoid?.isAwarded === false &&
        Boolean(voidRow) && /was voided:/.test(voidRow.description) && /reopened for leveling/.test(voidRow.description) &&
        reg1.chips.some((c) => /Superseded/.test(c)),
      { voidDlg: { title: voidDlg.title, buttons: voidDlg.buttons }, voidRow: voidRow ? voidRow.description : null, bidAwarded: bid26afterVoid?.isAwarded, chips: reg1.chips });

    // ---------- 11. re-award through the UI ----------
    await clickTab(page, "Bid Leveling");
    await delay(1600);
    await selectPackage(page, p26.tradeName);
    await delay(1000);
    const reAward1 = await clickText(page, "Award Compliant Winner");
    const reAward = reAward1.ok ? reAward1 : await clickText(page, "Award Subcontract & Draft Agreement");
    const agrs4 = await poll(
      () => c.query("agreements:listAgreements", { projectId: proj._id }),
      (x) => (x || []).some((a) => a._id === agr?._id && a.status === "generated"),
      60000,
      2000
    );
    await delay(1500);
    const reRow = ((await c.query("auditLogs:listRecentLogs", { projectId: proj._id, limit: 300 })) || []).find((l) => /Re-Awarded/.test(l.title));
    const bid26re = (await c.query("bids:listByPackage", { tradePackageId: p26._id })).find((b) => b._id === bid26.bidId);
    reconcile.push({ step: "re-award", backend: { status: (agrs4 || []).find((a) => a._id === agr?._id)?.status, number: (agrs4 || []).find((a) => a._id === agr?._id)?.agreementNumber }, ui: reAward });
    record("A28-04.12", "UI re-award reactivates the same agreement (generated) with a 'Re-Awarded ... Re-activated' audit row and no execution claim",
      reAward.ok && (agrs4 || []).find((a) => a._id === agr?._id)?.agreementNumber === agr?.agreementNumber &&
        (agrs4 || []).find((a) => a._id === agr?._id)?.status === "generated" && bid26re?.isAwarded === true &&
        Boolean(reRow) && /Re-activated subcontract agreement/.test(reRow.description) && !/executed/i.test(reRow.description),
      { reAward, status: (agrs4 || []).find((a) => a._id === agr?._id)?.status, reRow: reRow ? { title: reRow.title, description: reRow.description } : null });

    // ---------- 12. audit tab truth sweep ----------
    await clickTab(page, "Live Activity Audit");
    await delay(2000);
    const auditUI = await mainText(page);
    const loggedRows = ((await c.query("auditLogs:listRecentLogs", { projectId: proj._id, limit: 400 })) || []).filter((l) => /Double-Buy Credit Logged/.test(l.title));
    record("A28-04.13", "audit UI renders the lifecycle claims as persisted: generation says pending execution, execution record present, void present, re-award present; no 'Logged' phantom rows",
      /pending external execution/.test(auditUI) && /Execution status recorded for/.test(auditUI) &&
        /was voided:/.test(auditUI) && /Re-activated subcontract agreement/.test(auditUI) && loggedRows.length === 0,
      { hasPendingExecution: /pending external execution/.test(auditUI), hasExecution: /Execution status recorded for/.test(auditUI), hasVoid: /was voided:/.test(auditUI), hasReAward: /Re-activated subcontract agreement/.test(auditUI), loggedRows: loggedRows.length });

    await shot(page, "fix4-qa28-journey-final.png");
    record("A28-04.14", "journey diagnostics: zero page errors", diag.pageErrors.length === 0, {
      pageErrors: diag.pageErrors.slice(0, 5),
      consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(-4).map((e) => e.text.slice(0, 160)),
    });

    writeEvidence("ui-journey", {
      projectId: proj._id, p26: p26._id, p23: p23._id, bid26: bid26.bidId, bid23: bid23.bidId,
      agreement: agr?.agreementNumber,
      results, reconcile,
      summary: { pass: results.filter((r) => r.pass).length, total: results.length },
    });
    writeLog("ui-journey", log);
    console.log(`ui-journey: ${results.filter((r) => r.pass).length}/${results.length}`);
  } catch (err) {
    writeEvidence("ui-journey", { results: [...results, { id: "A28-04.ERR", pass: false, name: "aborted", detail: String(err?.stack ?? err) }], reconcile, summary: { pass: results.filter((r) => r.pass).length, total: results.length + 1 } });
    writeLog("ui-journey", [...log, String(err?.stack ?? err)]);
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("ui-journey-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});