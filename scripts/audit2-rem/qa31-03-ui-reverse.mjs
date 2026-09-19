/**
 * QA31-03 UI verification:
 *  A31-03.1 A30-02 UI: the disconnect clash renders DETECTED with a $12,000
 *           "1-Click Deduct Credit" while only the unrelated switchgear alias exists.
 *  A31-03.2 A30-01 UI: after the credit VE was removed (and stale record cleared),
 *           the KPIs show reality ($0 recoverable / $50,500 exposure) and the VFD
 *           card offers the 1-click deduct again.
 *  A31-03.3 UI 1-click deduct applies: card flips to deducted, KPI credits $38,500,
 *           leveled cost drops, and the "Reverse credit" control appears.
 *  A31-03.4 Reverse happy path: clicking "Reverse credit" restores the leveled cost,
 *           the card returns to detected with the deduct button, and KPI credits reset.
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab, selectProjectByTitle } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, sleep } from "./qa31-lib.mjs";

const c = client();
const BASE = "https://brainy-skunk-440.convex.site";
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1700)}`);
};

const VFD_TITLE = "Variable Frequency Drives (VFDs) for AHUs & Pumps";
const DISC_TITLE = "Rooftop Mechanical Equipment Disconnect Switches";
const detect = (projectId) => c.query("coordination:detectCrossTradeClashes", { projectId });
const card = (d, id) => (d.doubleBuys || []).find((x) => x.id === id);
const bidById = async (pkgId, bidId) => (await c.query("bids:listByPackage", { tradePackageId: pkgId }) || []).find((b) => b._id === bidId);

async function cardState(page, title) {
  return page.evaluate((title) => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const cands = [...document.querySelectorAll("div")].filter(
      (el) =>
        vis(el) &&
        (el.innerText || "").includes(title) &&
        [...el.querySelectorAll("button")].some((b) => /1-Click Deduct Credit|Reverse credit/.test(b.innerText || ""))
    );
    const el = cands.sort((a, b) => (a.innerText || "").length - (b.innerText || "").length)[0] || null;
    if (!el) return null;
    return {
      text: (el.innerText || "").replace(/\s+/g, " ").trim(),
      textLower: (el.innerText || "").replace(/\s+/g, " ").trim().toLowerCase(),
      buttons: [...el.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean),
    };
  }, title);
}

async function kpiState(page) {
  return page.evaluate(() => {
    const t = (document.querySelector("main") || document.body).innerText.replace(/\s+/g, " ");
    const grab = (label) => new RegExp(label + "\\s*\\$?([\\d,]+)").exec(t)?.[1] ?? null;
    return {
      redundantDoubleBuys: grab("Redundant Double-Buys"),
      recoverableCredits: grab("Recoverable Buyout Credits"),
      unassignedVoids: grab("Unassigned Scope Voids"),
      deductedChip: (t.match(/Credit Deducted & Leveled/gi) || []).length,
    };
  });
}

async function clickCardButton(page, title, needle) {
  return page.evaluate(
    (title, needle) => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const cands = [...document.querySelectorAll("div")].filter(
        (el) =>
          vis(el) &&
          (el.innerText || "").includes(title) &&
          [...el.querySelectorAll("button")].some((b) => /1-Click Deduct Credit|Reverse credit/.test(b.innerText || ""))
      );
      const el = cands.sort((a, b) => (a.innerText || "").length - (b.innerText || "").length)[0] || null;
      if (!el) return { ok: false, reason: "card not found" };
      const b = [...el.querySelectorAll("button")].find((x) => vis(x) && (x.innerText || "").includes(needle));
      if (!b) return { ok: false, reason: "button not found", buttons: [...el.querySelectorAll("button")].map((x) => (x.innerText || "").trim()) };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, text: (b.innerText || "").replace(/\s+/g, " ").trim() };
    },
    title,
    needle
  );
}

async function poll(fn, predicate, timeoutMs, stepMs = 1500) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    try { last = await fn(); } catch (err) { last = { error: String(err?.message ?? err) }; }
    if (predicate(last)) return last;
    await sleep(stepMs);
  }
  return last;
}

async function main() {
  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const dismiss = async () => {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"
      );
      b?.click();
    });
    await delay(500);
  };

  try {
    // ------------------ A30-02 UI: alias must not suppress the disconnect deduct ------------------
    await page.goto(`${BASE}/?project=${F.a302.id}&tab=coordination&qa31=alias`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await dismiss();
    await selectProjectByTitle(page, "AUDIT-QA31-A302");
    await delay(1500);
    await clickTab(page, "Scope Clash");
    await delay(1800);
    const disc = await cardState(page, DISC_TITLE);
    const vfdA = await cardState(page, VFD_TITLE);
    const kpiA = await kpiState(page);
    await shot(page, "fix4-qa31-ui-alias-disconnect.png", { full: true });
    record("A31-03.1", "A30-02 UI: with only the $5,000 switchgear alias accepted, the disconnect card is DETECTED at $12,000 with its own '1-Click Deduct Credit (-$12,000)' control (VFD card at $38,500)",
      Boolean(disc) && disc.textLower.includes("redundant double-buy detected") && disc.text.includes("$12,000") &&
        disc.buttons.includes("1-Click Deduct Credit (-$12,000)") && !/no remaining redundancy/i.test(disc.text) &&
        Boolean(vfdA) && vfdA.buttons.includes("1-Click Deduct Credit (-$38,500)") &&
        kpiA.redundantDoubleBuys === "50,500" && kpiA.recoverableCredits === "0",
      { disconnect: disc, vfd: vfdA, kpi: kpiA });

    // ------------------ A30-01 UI: reality after credit removal ------------------
    await page.goto(`${BASE}/?project=${F.a301.id}&tab=coordination&qa31=reverse`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await dismiss();
    await selectProjectByTitle(page, "AUDIT-QA31-A301");
    await delay(1500);
    await clickTab(page, "Scope Clash");
    await delay(1800);
    const reality = await kpiState(page);
    const vfd0 = await cardState(page, VFD_TITLE);
    await shot(page, "fix4-qa31-ui-reality.png", { full: true });
    record("A31-03.2", "A30-01 UI reality: after the credit VE was removed and the stale record cleared, KPI credits read $0, redundant exposure reads $50,500, the VFD card is DETECTED and offers '1-Click Deduct Credit (-$38,500)'",
      reality.recoverableCredits === "0" && reality.redundantDoubleBuys === "50,500" && reality.deductedChip === 0 &&
        Boolean(vfd0) && vfd0.textLower.includes("redundant double-buy detected") && vfd0.buttons.includes("1-Click Deduct Credit (-$38,500)") &&
        !vfd0.textLower.includes("reverse credit"),
      { kpi: reality, vfd: vfd0 });

    // ------------------ UI 1-click deduct applies ------------------
    const clickDeduct = await clickCardButton(page, VFD_TITLE, "38,500");
    const afterDeductCard = await poll(
      () => detect(F.a301.id).then((d) => card(d, "clash-vfd-01")),
      (cd) => cd?.status === "deducted" && cd?.deductedAmount === 38500,
      20000
    );
    await delay(1200);
    const bAfterDeduct = await bidById(F.a301.p23, F.a301.b23.bidId);
    const uiDeducted = await kpiState(page);
    const vfdDeducted = await cardState(page, VFD_TITLE);
    record("A31-03.3", "UI 1-click deduct applies the fresh $38,500 credit: proposal levels to $441,500, card flips to deducted, KPI credits read $38,500 and 'Reverse credit' appears",
      clickDeduct.ok && afterDeductCard?.status === "deducted" && afterDeductCard?.deductedAmount === 38500 &&
        bAfterDeduct?.leveledTotalCost === 441500 &&
        uiDeducted.recoverableCredits === "38,500" &&
        Boolean(vfdDeducted) && vfdDeducted.textLower.includes("credit deducted & leveled") && vfdDeducted.buttons.includes("Reverse credit"),
      { clickDeduct, card: afterDeductCard, leveled: bAfterDeduct?.leveledTotalCost, kpi: uiDeducted, vfd: vfdDeducted });

    // ------------------ Reverse happy path ------------------
    const clickReverse = await clickCardButton(page, VFD_TITLE, "Reverse credit");
    const afterReverseCard = await poll(
      () => detect(F.a301.id).then((d) => card(d, "clash-vfd-01")),
      (cd) => cd?.status === "detected",
      20000
    );
    await delay(1200);
    const bReversed = await bidById(F.a301.p23, F.a301.b23.bidId);
    const uiReversed = await kpiState(page);
    const vfdReversed = await cardState(page, VFD_TITLE);
    await shot(page, "fix4-qa31-ui-reversed.png", { full: true });
    record("A31-03.4", "UI reverse happy path: clicking 'Reverse credit' restores the $480,000 leveled cost, removes the credit alternate, returns the card to DETECTED with the deduct button, and resets KPI credits to $0",
      clickReverse.ok && afterReverseCard?.status === "detected" &&
        bReversed?.leveledTotalCost === 480000 && (bReversed?.valueEngineeringAlternates || []).length === 0 &&
        uiReversed.recoverableCredits === "0" && uiReversed.redundantDoubleBuys === "50,500" &&
        Boolean(vfdReversed) && vfdReversed.textLower.includes("redundant double-buy detected") &&
        vfdReversed.buttons.includes("1-Click Deduct Credit (-$38,500)") && !vfdReversed.textLower.includes("reverse credit"),
      { clickReverse, card: afterReverseCard, leveled: bReversed?.leveledTotalCost, ve: bReversed?.valueEngineeringAlternates, kpi: uiReversed, vfd: vfdReversed });

    record("A31-03.5", "UI reversal probes: zero page errors / console errors on both projects",
      diag.pageErrors.length === 0 && diag.consoleLogs.filter((l) => l.type === "error").length === 0,
      { pageErrors: diag.pageErrors.slice(0, 4), consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 4).map((e) => e.text.slice(0, 160)) });

    writeEvidence("ui", {
      projects: { a302: F.a302.id, a301: F.a301.id },
      results,
      summary: { pass: results.filter((r) => r.pass).length, total: results.length },
    });
    writeLog("ui", log);
    console.log(`ui: ${results.filter((r) => r.pass).length}/${results.length}`);
  } catch (err) {
    writeEvidence("ui", { results: [...results, { id: "A31-03.ERR", pass: false, name: "aborted", detail: String(err?.stack ?? err) }] });
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