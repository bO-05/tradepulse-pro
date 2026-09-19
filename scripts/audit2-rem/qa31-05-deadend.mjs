/**
 * QA31-05 residual probe (adjacent to A30-01, beyond the stated acceptance criteria):
 *  After the credit VE is un-accepted through bid leveling, the card returns to
 *  DETECTED and exposes the 1-click deduct control, but the persisted resolution
 *  still blocks a blind deduct and the "Reverse credit" control is only rendered
 *  on a deducted card. This probe documents the resulting dead-end toast.
 *  Self-contained fixture AUDIT-QA31-DEADEND; purged on entry and exit.
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab, selectProjectByTitle } from "./lib.mjs";
import { client, writeEvidence, writeLog, sleep, plusDays } from "./qa31-lib.mjs";

const c = client();
const BASE = "https://brainy-skunk-440.convex.site";
const TITLE = "AUDIT-QA31-DEADEND";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1500)}`);
};

const VFD_TITLE = "Variable Frequency Drives (VFDs) for AHUs & Pumps";

async function purge() {
  const projects = (await c.query("projects:listProjects", {})) || [];
  for (const p of projects.filter((x) => x.title.startsWith(`${TITLE}`))) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try { await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA31 dead-end probe teardown of executed record." }); } catch {}
    }
    try { await c.mutation("projects:deleteProject", { projectId: p._id }); } catch {}
    await sleep(250);
  }
}

async function build() {
  const dl = plusDays(20);
  const id = await c.mutation("projects:createProject", {
    title: TITLE, location: "Austin, TX", projectType: "Class-A Commercial Mixed-Use",
    estBudget: 1600000, targetCompletionWeeks: 52, specDocumentText: `${TITLE} probe.`,
    isDemoProject: false, generalContractorName: "QA31 Dead-End GC",
  });
  const mkPkg = (csi, name, budget) =>
    c.mutation("tradePackages:createTradePackage", {
      projectId: id, csiDivision: csi, tradeName: name, budgetEstimate: budget,
      scopeSummary: `${name} scope.`, mandatoryInclusions: ["QA31 general scope per plans and specifications"], bidDeadline: dl,
    });
  const p26 = await mkPkg("26 00 00", "QA31 DEADEND Electrical", 900000);
  const p23 = await mkPkg("23 00 00", "QA31 DEADEND HVAC", 600000);
  const mkCtr = (pkgId, name, email, lic) =>
    c.mutation("contractors:createContractor", {
      tradePackageId: pkgId, companyName: name, contactEmail: email, phone: "+1 (206) 555-0199",
      licenseNumber: lic, licenseStatus: "Active / Verified (QA31)", sourceUrl: "https://qa31.example.invalid/license", rfqStatus: "invited",
    });
  const c26 = await mkCtr(p26, "AUDIT-QA31 DEADEND Electric", "estimating@qa31-deadend-e.invalid", "TX-QA31-DE");
  const c23 = await mkCtr(p23, "AUDIT-QA31 DEADEND Mechanical", "estimating@qa31-deadend-m.invalid", "TX-QA31-DM");
  const b26 = await c.mutation("bids:submitDirectBid", { tradePackageId: p26, contractorId: c26, subcontractorName: "AUDIT-QA31 DEADEND Electric", baseBidAmount: 800000, coiComplianceStatus: "compliant", coiPenalty: 0 });
  const b23 = await c.mutation("bids:submitDirectBid", { tradePackageId: p23, contractorId: c23, subcontractorName: "AUDIT-QA31 DEADEND Mechanical", baseBidAmount: 480000, coiComplianceStatus: "compliant", coiPenalty: 0 });
  return { id, p26, p23, b26, b23 };
}

async function main() {
  await purge();
  const f = await build();

  const ded = await c.mutation("coordination:deductDoubleBuyCredit", {
    projectId: f.id, clashId: "clash-vfd-01", tradePackageId: f.p23,
    deductAmount: 38500, description: VFD_TITLE,
  });
  await c.mutation("bids:updateBidAdjustments", {
    bidId: f.b23.bidId, identifiedExclusions: [], valueEngineeringAlternates: [], leadTimePenalty: 0, coiPenalty: 0,
  });
  const detect = await c.query("coordination:detectCrossTradeClashes", { projectId: f.id });
  const card = detect.doubleBuys.find((x) => x.id === "clash-vfd-01");

  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  let clickDeduct = null;
  let toast = null;
  let cardBefore = null;
  let cardAfter = null;
  try {
    await page.goto(`${BASE}/?project=${f.id}&tab=coordination&qa31=deadend`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
    await delay(1000);
    await selectProjectByTitle(page, TITLE);
    await delay(1200);
    await clickTab(page, "Scope Clash");
    await delay(1800);

    const CARD = (title) => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const cands = [...document.querySelectorAll("div")].filter(
        (el) => vis(el) && (el.innerText || "").includes(title) &&
          [...el.querySelectorAll("button")].some((b) => /1-Click Deduct Credit|Reverse credit/.test(b.innerText || ""))
      );
      const el = cands.sort((a, b) => (a.innerText || "").length - (b.innerText || "").length)[0] || null;
      return el ? { text: (el.innerText || "").replace(/\s+/g, " ").trim(), buttons: [...el.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()) } : null;
    };

    cardBefore = await page.evaluate(CARD, VFD_TITLE);
    clickDeduct = await page.evaluate((title) => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const cands = [...document.querySelectorAll("div")].filter(
        (el) => vis(el) && (el.innerText || "").includes(title) &&
          [...el.querySelectorAll("button")].some((b) => /1-Click Deduct Credit/.test(b.innerText || ""))
      );
      const el = cands.sort((a, b) => (a.innerText || "").length - (b.innerText || "").length)[0] || null;
      const b = el && [...el.querySelectorAll("button")].find((x) => /1-Click Deduct Credit/.test(x.innerText || ""));
      if (!b) return { ok: false };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, text: (b.innerText || "").replace(/\s+/g, " ").trim() };
    }, VFD_TITLE);

    for (let i = 0; i < 40; i++) {
      await delay(150);
      toast = await page.evaluate(() => {
        const el = [...document.querySelectorAll('[role="status"]')].find((x) => /Deduct credit failed|applied/i.test(x.innerText || ""));
        return el ? (el.innerText || "").replace(/\s+/g, " ").trim() : null;
      });
      if (toast) break;
    }
    cardAfter = await page.evaluate(CARD, VFD_TITLE);
    await shot(page, "fix4-qa31-ui-deadend.png", { full: true });

    const stillDetected = await c.query("coordination:detectCrossTradeClashes", { projectId: f.id });
    const cardNow = stillDetected.doubleBuys.find((x) => x.id === "clash-vfd-01");
    const bidNow = ((await c.query("bids:listByPackage", { tradePackageId: f.p23 })) || []).find((b) => b._id === f.b23.bidId);
    record("A31-05.1", "RESIDUAL OBSERVATION: after an un-accept, the card shows DETECTED with a deduct button but no reverse control; clicking deduct is refused with the readable stale-credit toast naming 'Reverse the existing credit' while the UI offers no reverse control at that state (workaround: re-accept the credit so the card flips to deducted and exposes Reverse credit)",
      ded.success === true && card?.status === "detected" &&
        Boolean(cardBefore) && cardBefore.buttons.some((b) => /1-Click Deduct Credit/.test(b)) && !cardBefore.buttons.some((b) => /Reverse credit/.test(b)) &&
        clickDeduct?.ok === true &&
        /Deduct credit failed: A buyout credit has already been applied for this clash\. Reverse the existing credit before applying another\./.test(toast || "") &&
        Boolean(cardAfter) && !cardAfter.buttons.some((b) => /Reverse credit/.test(b)) &&
        cardNow?.status === "detected" && bidNow?.leveledTotalCost === 480000,
      { detectAfterUnaccept: { status: card?.status, deductedAmount: card?.deductedAmount }, cardBefore: cardBefore?.buttons, clickDeduct, toast, cardAfter: cardAfter?.buttons, leveled: bidNow?.leveledTotalCost, note: "The documented A30-01 flow (backend reverseDoubleBuyCredit clears the stale record, then a fresh deduct applies) passes independently; this observation covers only the UI path when the user does not invoke the explicit reverse." });

    record("A31-05.2", "dead-end probe diagnostics: zero page errors / console errors",
      diag.pageErrors.length === 0 && diag.consoleLogs.filter((l) => l.type === "error").length === 0,
      { pageErrors: diag.pageErrors.slice(0, 4), consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 4).map((e) => e.text.slice(0, 160)) });

    writeEvidence("ui-deadend", { projectId: f.id, results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
    writeLog("ui-deadend", log);
  } catch (err) {
    writeEvidence("ui-deadend", { results: [...results, { id: "A31-05.ERR", pass: false, name: "aborted", detail: String(err?.stack ?? err) }] });
    writeLog("ui-deadend", [...log, String(err?.stack ?? err)]);
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    await purge();
    const remaining = ((await c.query("projects:listProjects", {})) || []).filter((p) => p.title.startsWith("AUDIT-QA31-"));
    say(`post-probe QA31 projects remaining: ${remaining.length}`);
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("ui-deadend-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});