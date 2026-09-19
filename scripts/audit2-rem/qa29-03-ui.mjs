/**
 * QA29-03 UI verification (live https://brainy-skunk-440.convex.site):
 *  A28-01 - AUDIT-QA29-BASFALSE: BAS void renders OPEN with assign buttons; no
 *           "Scope Assigned & Covered" claim, KPI voids $46,500.
 *  A28-02 - AUDIT-QA29-MANUAL: VFD card stays DETECTED after a manual accepted
 *           $1,000 VFD VE, offers "-$37,500" (no $38,500 claim); after the real
 *           1-click deduct the card shows deducted $37,500 and KPI matches backend.
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, EVIDENCE_DIR, sleep } from "./qa29-lib.mjs";

const F = readEvidence("fixtures");
const c = client();
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const reconcile = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1600)}`);
};

async function dismissTour(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"
    );
    b?.click();
  });
  await delay(500);
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

const mainText = (page) => page.evaluate(() => (document.querySelector("main") || document.body).innerText.replace(/\s+/g, " "));

async function cardInfo(page, titleNeedle) {
  return page.evaluate((needle) => {
    const h = [...document.querySelectorAll("h4")].find((x) => (x.textContent || "").includes(needle));
    if (!h) return { found: false };
    const hasP5 = (e) => /(^|\s)p-5(\s|$)/.test(e.className || "");
    let el = h;
    while (el && !hasP5(el)) el = el.parentElement;
    if (!el) return { found: false, reason: "card ancestor not found" };
    return {
      found: true,
      text: (el.innerText || "").replace(/\s+/g, " "),
      buttons: [...el.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean),
    };
  }, titleNeedle);
}

async function poll(fn, pred, timeoutMs, stepMs = 1500) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    last = await fn();
    if (pred(last)) return last;
    await sleep(stepMs);
  }
  return last;
}

async function open(page, projectId, query) {
  await page.goto(`${BASE}/?project=${projectId}&tab=coordination&${query}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await dismissTour(page);
  await delay(2400);
}

async function main() {
  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const dlDir = path.join(EVIDENCE_DIR, "fix4-qa29-downloads");
  fs.mkdirSync(dlDir, { recursive: true });

  try {
    // ============ A28-01 UI: false-positive inclusion keeps the void open ============
    await open(page, F.basFalse.id, "qa29=basfalse");
    const t0 = await mainText(page);
    const basCardUi = await cardInfo(page, "Low-Voltage 24V BAS Control & Interlock Wiring");
    const assignElecCount = (t0.match(/Assign to Div 26 \(Electrical\)/g) || []).length;
    const voidAuditRows = ((await c.query("auditLogs:listRecentLogs", { projectId: F.basFalse.id, limit: 200 })) || []).filter((l) => /scope void/i.test(l.title));
    const detectFalse = await c.query("coordination:detectCrossTradeClashes", { projectId: F.basFalse.id });
    const basFalseCard = detectFalse.scopeVoids.find((x) => x.id === "void-bas-wiring-01");
    await shot(page, "fix4-qa29-bas-false-open.png");
    reconcile.push({ step: "bas-false", backend: { status: basFalseCard?.status, totalVoidExposure: detectFalse.summary.totalScopeVoidExposure }, ui: { voids: /Unassigned Scope Voids \$([\d,]+)/.exec(t0)?.[1] ?? null } });
    record(
      "A29-A28-01-ui",
      "A28-01 UI: 'Base building general conditions allowance' fixture shows the BAS void OPEN ('Critical Scope Void Detected', both assign buttons, no assigned claim) and KPI voids $46,500",
      basCardUi.found &&
        /CRITICAL SCOPE VOID DETECTED/i.test(basCardUi.text) &&
        basCardUi.buttons.some((b) => /^Assign to Div 26 \(Electrical\)$/.test(b)) &&
        basCardUi.buttons.some((b) => /^Assign to Div 23 \(HVAC\)$/.test(b)) &&
        !/SCOPE ASSIGNED & COVERED/i.test(basCardUi.text) &&
        !/Included in mandatory scope/i.test(basCardUi.text) &&
        !/SCOPE ASSIGNED & COVERED/i.test(t0) &&
        !/Assigned to Division 26 Electrical/.test(t0) &&
        /Unassigned Scope Voids \$46,500/.test(t0) &&
        assignElecCount >= 2 && basFalseCard?.status === "open" && voidAuditRows.length === 0,
      { assignElecCount, backendCard: basFalseCard ? { status: basFalseCard.status, assignedTo: basFalseCard.assignedToTradeName ?? null } : null, totalVoidExposure: detectFalse.summary.totalScopeVoidExposure, voidAuditRows: voidAuditRows.length, voidCard: { text: basCardUi.text.slice(0, 520), buttons: basCardUi.buttons } }
    );

    // ============ A28-02 UI pre: remaining redundancy $37,500, still DETECTED ============
    await open(page, F.manual.id, "qa29=manual");
    const tPre = await mainText(page);
    const preCardUi = await cardInfo(page, "Variable Frequency Drives (VFDs) for AHUs & Pumps");
    const preDetect = await c.query("coordination:detectCrossTradeClashes", { projectId: F.manual.id });
    const preCard = preDetect.doubleBuys.find((x) => x.id === "clash-vfd-01");
    const preBtns = preCardUi.buttons;
    const falseClaimPre = /Deducted \$38,500|Recoverable Buyout Credits \$38,500|\$38,500 credit/.test(tPre);
    await shot(page, "fix4-qa29-manual-pre.png");
    reconcile.push({ step: "manual-pre", backend: { status: preCard?.status, redundant: preCard?.redundantAmount, total: preDetect.summary.totalDoubleBuyExposure }, ui: { creditsKpi: /Recoverable Buyout Credits \$([\d,]+)/.exec(tPre)?.[1] ?? null, buysKpi: /Redundant Double-Buys \$([\d,]+)/.exec(tPre)?.[1] ?? null } });
    record(
      "A29-A28-02-ui-pre",
      "A28-02 UI pre: card stays REDUNDANT DOUBLE-BUY DETECTED, shows $37,500 deductible and a -$37,500 button; no $38,500 credit/deducted claim (the $38,500 secondary line cost is legitimate)",
      preCardUi.found &&
        /REDUNDANT DOUBLE-BUY DETECTED/i.test(preCardUi.text) &&
        /Deductible Redundant Value:\s*\$37,500/.test(preCardUi.text) &&
        preBtns.includes("1-Click Deduct Credit (-$37,500)") &&
        !/CREDIT DEDUCTED & LEVELED/i.test(preCardUi.text) &&
        !falseClaimPre &&
        /Recoverable Buyout Credits \$0/.test(tPre) &&
        /Redundant Double-Buys \$49,500/.test(tPre) &&
        preCard?.status === "detected" && preCard?.redundantAmount === 37500 && preCard?.deductedAmount === undefined,
      { buttons: preBtns, backendCard: preCard ? { status: preCard.status, redundantAmount: preCard.redundantAmount, deductedAmount: preCard.deductedAmount ?? null } : null, falseClaimPre, secondaryCostShown: /\$38,500/.test(preCardUi.text), card: preCardUi.text.slice(0, 560) }
    );

    // ============ A28-02 UI action: real 1-click deduct of $37,500 ============
    const ded = await clickNth(page, "1-Click Deduct Credit", 0);
    const postCardPoll = await poll(
      () => c.query("coordination:detectCrossTradeClashes", { projectId: F.manual.id }).then((d) => d.doubleBuys.find((x) => x.id === "clash-vfd-01")),
      (card) => card?.status === "deducted",
      45000
    );
    const hvacBid = (await c.query("bids:listByPackage", { tradePackageId: F.manual.p23 })).find((b) => b._id === F.manual.b23.bidId);
    await delay(2500);
    const tPost = await mainText(page);
    const postCardUi = await cardInfo(page, "Variable Frequency Drives (VFDs) for AHUs & Pumps");
    const falseClaimPost = /Deducted \$38,500|Recoverable Buyout Credits \$38,500|\$38,500 credit/.test(tPost);
    const postDetect = await c.query("coordination:detectCrossTradeClashes", { projectId: F.manual.id });
    const postCard = postDetect.doubleBuys.find((x) => x.id === "clash-vfd-01");
    const auditRow = ((await c.query("auditLogs:listRecentLogs", { projectId: F.manual.id, limit: 200 })) || []).find((l) => /Double-Buy Credit Deducted/.test(l.title));
    await shot(page, "fix4-qa29-manual-post.png");
    reconcile.push({
      step: "manual-post",
      backend: { status: postCard?.status, deductedAmount: postCard?.deductedAmount, hvacLeveled: hvacBid?.leveledTotalCost, totalDoubleBuy: postDetect.summary.totalDoubleBuyExposure, audit: auditRow?.title },
      ui: { creditsKpi: /Recoverable Buyout Credits \$([\d,]+)/.exec(tPost)?.[1] ?? null, buysKpi: /Redundant Double-Buys \$([\d,]+)/.exec(tPost)?.[1] ?? null },
    });
    record(
      "A29-A28-02-ui-post",
      "A28-02 UI post: card shows CREDIT DEDUCTED & LEVELED with $37,500, HVAC bid leveled $432,500, KPI credits $37,500 / buys $12,000 matching backend",
      ded.ok && postCardUi.found && /CREDIT DEDUCTED & LEVELED/i.test(postCardUi.text) &&
        /Deducted \$37,500 credit from proposal/.test(postCardUi.text) &&
        !postCardUi.buttons.some((b) => /1-Click Deduct Credit/.test(b)) &&
        !falseClaimPost &&
        /Recoverable Buyout Credits \$37,500/.test(tPost) && /Redundant Double-Buys \$12,000/.test(tPost) &&
        postCard?.status === "deducted" && postCard?.deductedAmount === 37500 &&
        hvacBid?.leveledTotalCost === 432500 &&
        postDetect.summary.totalDoubleBuyExposure === 12000 &&
        Boolean(auditRow) && /-\$37,500/.test(auditRow.title) && /\$432,500/.test(auditRow.description) && !/updated to \$-/.test(auditRow.description),
      { ded, backendCard: postCard ? { status: postCard.status, deductedAmount: postCard.deductedAmount } : null, hvacLeveled: hvacBid?.leveledTotalCost, totalDoubleBuy: postDetect.summary.totalDoubleBuyExposure, auditRow: auditRow ? { title: auditRow.title, description: auditRow.description } : null, falseClaimPost, card: postCardUi.text.slice(0, 560), buttons: postCardUi.buttons }
    );

    record("A29-duiag", "UI diagnostics: zero page errors across both fixtures", diag.pageErrors.length === 0, { pageErrors: diag.pageErrors.slice(0, 5) });

    const out = {
      fixtureIds: { basFalse: F.basFalse.id, manual: F.manual.id },
      results,
      reconcile,
      summary: { pass: results.filter((r) => r.pass).length, total: results.length },
    };
    writeEvidence("ui", out);
    writeLog("ui", log);
    console.log(`ui: ${out.summary.pass}/${out.summary.total}`);
    if (results.some((r) => !r.pass)) process.exitCode = 2;
  } catch (err) {
    writeEvidence("ui", { results: [...results, { id: "A29-ui.ERR", pass: false, name: "aborted", detail: String(err?.stack ?? err) }], reconcile, summary: { pass: results.filter((r) => r.pass).length, total: results.length + 1 } });
    writeLog("ui", [...log, String(err?.stack ?? err)]);
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("ui-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});