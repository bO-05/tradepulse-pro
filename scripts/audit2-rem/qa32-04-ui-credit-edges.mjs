/**
 * QA32-04 UI credit-edge repros on the reverse path:
 *  UNACC - deduct VFD via API, then UI Bid Leveling un-accepts the credit; Scope Clash card
 *          returns to "detected" but the apply button is refused by the stale resolution and
 *          NO reverse control is rendered (dead action / stuck state).
 *          Then re-accept via UI -> card deducted -> "Reverse credit" works via UI.
 *  MBUI  - deduct lands on cheapest B1; award B2 through the agreement generator; UI
 *          "Reverse credit" then silently clears the resolution without touching the awarded
 *          proposal or restoring B1 (stranded credit; toast claims the leveled cost was restored).
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab, selectProjectByTitle } from "./lib.mjs";
import { client, fixtureTitle, writeEvidence, writeLog, plusDays, sleep } from "./qa32-lib.mjs";

const c = client();
const BASE = "https://brainy-skunk-440.convex.site";
const MBUI_TITLE = fixtureTitle("MBUI");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1900)}`);
};

const VFD_DESC = "Variable Frequency Drives (VFDs) for AHUs & Pumps";

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

const toastText = (page) => page.evaluate(() => (document.querySelector('[role="status"][aria-live="polite"]') || {}).innerText || null);

const uiClash = (page) =>
  page.evaluate(() => {
    const t = (document.querySelector("main") || document.body).innerText.replace(/\n/g, " ");
    const grab = (label) => new RegExp(label + "\\s*\\$?([\\d,]+)").exec(t)?.[1] ?? null;
    const buttons = [...document.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    return {
      credits: grab("Recoverable Buyout Credits"),
      doubleBuys: grab("Redundant Double-Buys"),
      detectedChips: (t.match(/Redundant Double-Buy Detected/gi) || []).length,
      deductedChips: (t.match(/Credit Deducted & Leveled/gi) || []).length,
      noRemaining: /No remaining redundancy/.test(t),
      deductButtons: buttons.filter((x) => /1-Click Deduct Credit/.test(x)),
      reverseButtons: buttons.filter((x) => /Reverse credit/.test(x)),
      raw: t.slice(0, 700),
    };
  });

async function launchAndOpen(projectId, tag) {
  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.goto(`${BASE}/?project=${projectId}&qa32=${tag}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await dismissTour(page);
  return { browser, page, diag };
}

async function buildMbui() {
  const dl = plusDays(20);
  const id = await c.mutation("projects:createProject", {
    title: MBUI_TITLE, location: "Austin, TX", projectType: "Class-A Commercial Mixed-Use",
    estBudget: 1600000, targetCompletionWeeks: 52, specDocumentText: `${MBUI_TITLE} split-award UI probe.`,
    isDemoProject: false, generalContractorName: "QA32 MBUI GC",
  });
  const mkPkg = (csi, name, budget) =>
    c.mutation("tradePackages:createTradePackage", {
      projectId: id, csiDivision: csi, tradeName: name, budgetEstimate: budget,
      scopeSummary: `${name} scope per CSI ${csi}.`, mandatoryInclusions: ["QA32 general scope per plans and specifications"], bidDeadline: dl,
    });
  const p26 = await mkPkg("26 00 00", "QA32 MBUI Electrical", 900000);
  const p23 = await mkPkg("23 00 00", "QA32 MBUI HVAC", 600000);
  const mkCtr = (pkgId, name, email, lic) =>
    c.mutation("contractors:createContractor", {
      tradePackageId: pkgId, companyName: name, contactEmail: email, phone: "+1 (206) 555-0199",
      licenseNumber: lic, licenseStatus: "Active / Verified (QA32)", sourceUrl: "https://qa32.example.invalid/license", rfqStatus: "invited",
    });
  const mkBid = (pkgId, ctrId, name, base) =>
    c.mutation("bids:submitDirectBid", {
      tradePackageId: pkgId, contractorId: ctrId, subcontractorName: name, baseBidAmount: base,
      identifiedExclusions: [], longLeadEquipmentWeeks: 8, leadTimePenalty: 0, coiComplianceStatus: "compliant", coiPenalty: 0,
    });
  const c26 = await mkCtr(p26, "AUDIT-QA32 MBUI Electric", "estimating@qa32-mbui-e.invalid", "TX-QA32-MBUI-E");
  const c23 = await mkCtr(p23, "AUDIT-QA32 MBUI Mechanical", "estimating@qa32-mbui-m.invalid", "TX-QA32-MBUI-M");
  const c23b = await mkCtr(p23, "AUDIT-QA32 MBUI Mechanical Alt", "estimating@qa32-mbui-m2.invalid", "TX-QA32-MBUI-M2");
  await mkBid(p26, c26, "AUDIT-QA32 MBUI Electric", 800000);
  const b1 = await mkBid(p23, c23, "AUDIT-QA32 MBUI Mechanical", 480000);
  const b2 = await mkBid(p23, c23b, "AUDIT-QA32 MBUI Mechanical Alt", 497000);
  const ded = await c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 38500, description: VFD_DESC });
  const agr = await c.mutation("agreements:generateAgreement", { bidId: b2.bidId, tradePackageId: p23 });
  return { id, p23, b1: b1.bidId, b2: b2.bidId, ded, agr };
}

async function main() {
  const F = (await import("./qa32-lib.mjs")).readEvidence("fixtures");
  const U = F.unacc;
  const b23 = U.b23.bidId;

  // purge a previous MBUI run
  for (const p of ((await c.query("projects:listProjects", {})) || []).filter((x) => x.title === MBUI_TITLE)) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try { await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA32 MBUI purge of prior executed record." }); } catch {}
    }
    try { await c.mutation("projects:deleteProject", { projectId: p._id }); } catch {}
  }

  const deduct = await c.mutation("coordination:deductDoubleBuyCredit", {
    projectId: U.id, clashId: "clash-vfd-01", tradePackageId: U.p23, deductAmount: 38500, description: VFD_DESC,
  });

  // ---------- UNACC: dead-end repro ----------
  {
    const { browser, page, diag } = await launchAndOpen(U.id, "unacc");
    try {
      const bBefore = (await c.query("bids:listByPackage", { tradePackageId: U.p23 })).find((b) => b._id === b23);
      await clickTab(page, "Bid Leveling");
      await delay(1600);
      await selectPackage(page, "QA32 UNACC HVAC");
      await delay(1000);
      const open = await clickText(page, "Adjust Leveling");
      await delay(900);
      const dlg = await findAdjustDialog(page);
      const toggle = await toggleCredit(page);
      await delay(600);
      const save = await saveAdjust(page);
      await delay(2200);
      const bAfter = (await c.query("bids:listByPackage", { tradePackageId: U.p23 })).find((b) => b._id === b23);
      const rows = (bAfter?.valueEngineeringAlternates || []).filter((v) => /^Cross-Trade Clash Credit:/.test(v.description));

      await clickTab(page, "Scope Clash");
      await delay(2000);
      const uiBefore = await uiClash(page);
      await shot(page, "fix4-qa32-ui-unacc-detected.png", { full: true });

      const retry = await clickText(page, "1-Click Deduct Credit");
      const toast = await (async () => { const t0 = Date.now(); let t = null; while (Date.now() - t0 < 12000) { t = await toastText(page); if (t) break; await sleep(400); } return t; })();
      await delay(1200);
      const bRetry = (await c.query("bids:listByPackage", { tradePackageId: U.p23 })).find((b) => b._id === b23);
      const dCard = await c.query("coordination:detectCrossTradeClashes", { projectId: U.id });
      const vfd = dCard.doubleBuys.find((x) => x.id === "clash-vfd-01");
      const uiAfter = await uiClash(page);
      await shot(page, "fix4-qa32-ui-unacc-retry.png", { full: true });

      record("A32-UE.1", "UI un-accept -> card detected $38,500 with a live '1-Click Deduct Credit' button, but clicking it is refused by the stale resolution and no 'Reverse credit' control exists (dead action; stuck without the hidden re-accept workaround)",
        !(deduct.newLeveledCost === 441500 && bBefore?.leveledTotalCost === 441500 && toggle.ok && /Accepted/.test(toggle.before || "") &&
          save.ok && bAfter?.leveledTotalCost === 480000 && rows.length === 1 && rows[0].isAccepted === false &&
          uiBefore.credits === "0" && vfd.status === "detected" && vfd.redundantAmount === 38500 &&
          uiBefore.deductButtons.some((x) => /38,500/.test(x)) && uiBefore.reverseButtons.length === 0 &&
          Boolean(toast) && /already been applied|Reverse the existing credit/.test(toast) &&
          bRetry?.leveledTotalCost === 480000 && uiAfter.reverseButtons.length === 0),
        {
          deduct: deduct.newLeveledCost, toggle, save, leveledAfterToggle: bAfter?.leveledTotalCost, creditRows: rows.map((v) => ({ a: v.isAccepted, c: v.costDeduct })),
          uiBefore: { credits: uiBefore.credits, deduct: uiBefore.deductButtons, reverse: uiBefore.reverseButtons, detected: uiBefore.detectedChips },
          retryClicked: retry.ok, toast, backendAfterRetry: { leveled: bRetry?.leveledTotalCost, status: vfd.status, redundant: vfd.redundantAmount },
          uiAfter: { reverse: uiAfter.reverseButtons, deduct: uiAfter.deductButtons.length },
          diagnosticNote: "pageError/console error above is the expected rethrow of the refused deduct action (App toast + throw); recorded, not treated as a separate failure",
          diagnostic: { pageErrors: diag.pageErrors.slice(0, 3), consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 3).map((e) => e.text.slice(0, 120)) },
        });

      // recovery: re-accept the credit through the UI, then reverse from the card
      const toggle2 = await (async () => {
        await clickTab(page, "Bid Leveling");
        await delay(1600);
        await selectPackage(page, "QA32 UNACC HVAC");
        await delay(1000);
        await clickText(page, "Adjust Leveling");
        await delay(900);
        const t = await toggleCredit(page);
        await delay(500);
        await saveAdjust(page);
        await delay(2200);
        return t;
      })();
      const bReacc = (await c.query("bids:listByPackage", { tradePackageId: U.p23 })).find((b) => b._id === b23);
      await clickTab(page, "Scope Clash");
      await delay(2000);
      const uiDeducted = await uiClash(page);
      // wait for the save toast to expire so the reverse toast is unambiguous
      await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 6500) { if (!(await toastText(page))) return; await sleep(300); } })();
      const revClick = await clickText(page, "Reverse credit");
      const toastRev = await (async () => { const t0 = Date.now(); let t = null; while (Date.now() - t0 < 12000) { t = await toastText(page); if (t && /reversed/.test(t)) break; await sleep(400); } return t; })();
      await delay(1200);
      const bFinal = (await c.query("bids:listByPackage", { tradePackageId: U.p23 })).find((b) => b._id === b23);
      record("A32-UE.2", "UI recovery path: re-accept via Bid Leveling -> card deducted with 'Reverse credit' -> reversing from the card restores $480,000 and the card returns to detected (normal path works)",
        toggle2.ok && bReacc?.leveledTotalCost === 441500 && uiDeducted.reverseButtons.length === 1 && uiDeducted.deductedChips === 1 &&
          revClick.ok && Boolean(toastRev) && /reversed/.test(toastRev) && bFinal?.leveledTotalCost === 480000 &&
          (bFinal?.valueEngineeringAlternates || []).length === 0,
        { toggle2, reacceptedLeveled: bReacc?.leveledTotalCost, uiDeducted: { reverse: uiDeducted.reverseButtons, deducted: uiDeducted.deductedChips }, revClick, toastRev, finalLeveled: bFinal?.leveledTotalCost });
    } finally {
      await browser.close();
    }
  }

  // ---------- MBUI: split-award strand via UI reverse ----------
  let mb = null;
  {
    mb = await buildMbui();
    const { browser, page, diag } = await launchAndOpen(mb.id, "mbui");
    try {
      await clickTab(page, "Scope Clash");
      await delay(2200);
      const uiPre = await uiClash(page);
      const click = await clickText(page, "Reverse credit");
      const toast = await (async () => { const t0 = Date.now(); let t = null; while (Date.now() - t0 < 12000) { t = await toastText(page); if (t) break; await sleep(400); } return t; })();
      await delay(1500);
      const bids = await c.query("bids:listByPackage", { tradePackageId: mb.p23 });
      const b1 = bids.find((b) => b._id === mb.b1);
      const b2 = bids.find((b) => b._id === mb.b2);
      const agr = ((await c.query("agreements:listAgreements", { projectId: mb.id })) || []).find((a) => a.bidId === mb.b2);
      const d = await c.query("coordination:detectCrossTradeClashes", { projectId: mb.id });
      const vfd = d.doubleBuys.find((x) => x.id === "clash-vfd-01");
      const revRows = ((await c.query("auditLogs:listRecentLogs", { projectId: mb.id, limit: 300 })) || []).filter((l) => /Double-Buy Credit Reversed/.test(l.title));
      const uiAfter = await uiClash(page);
      await shot(page, "fix4-qa32-ui-mbui-after-reverse.png", { full: true });

      const stranded = click.ok && b1?.leveledTotalCost === 441500 &&
        (b1?.valueEngineeringAlternates || []).some((v) => /^Cross-Trade Clash Credit:/.test(v.description) && v.costDeduct === 38500) &&
        b2?.leveledTotalCost === 497000 && b2?.isAwarded === true && agr?.contractSum === 497000 &&
        revRows.length === 0 && uiAfter.noRemaining && uiAfter.reverseButtons.length === 0;
      record("A32-UE.3", "MBUI split-award: UI 'Reverse credit' reports success but the awarded B2 contract ($497,000) never receives the $38,500 credit, B1 keeps the stranded credit ($441,500), no reversal audit row is written, and the card now claims no remaining redundancy",
        !stranded,
        { click, toast, b1: { leveled: b1?.leveledTotalCost, awarded: b1?.isAwarded, rows: (b1?.valueEngineeringAlternates || []).map((v) => ({ d: v.description.slice(0, 60), a: v.isAccepted, c: v.costDeduct })) }, b2: { leveled: b2?.leveledTotalCost, awarded: b2?.isAwarded, contractSum: agr?.contractSum }, card: { status: vfd.status, redundant: vfd.redundantAmount }, reversalAuditRows: revRows.length, uiAfter: { noRemaining: uiAfter.noRemaining, credits: uiAfter.credits, reverse: uiAfter.reverseButtons.length }, diagnostic: { pageErrors: diag.pageErrors.slice(0, 3) } });
    } finally {
      await browser.close();
    }
  }

  writeEvidence("ui-credit-edges", { mbui: mb ? { id: mb.id, p23: mb.p23, b1: mb.b1, b2: mb.b2 } : null, results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
  writeLog("ui-credit-edges", log);
  console.log(`ui-credit-edges: ${results.filter((r) => r.pass).length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeEvidence("ui-credit-edges", { results: [...results, { id: "A32-04.ERR", pass: false, name: "aborted", detail: String(e?.stack ?? e) }] });
  writeLog("ui-credit-edges", [...log, String(e?.stack ?? e)]);
  process.exit(1);
});