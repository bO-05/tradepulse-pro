/**
 * QA38-04 fresh-eyes hunt for new Medium+ issues (live). AUDIT-QA38-HUNT project:
 *  26 Elect(800k) + 23 HVAC two bids B1(480k)/B2(497k) + 22 Plumbing(280k) + accepted manual VFD $26,500 on B1.
 *
 * H1 third-package reversal: deduct VFD on HVAC B1, reverse passing the UNRELATED Plumbing (22)
 *    package id -> carrier must still be found, B1 restored 453,500 (manual 26,500 kept), no phantom clear.
 * H2 awarded-bid reversal: award B1, deduct on the awarded bid (agreement synced), reverse with the
 *    Plumbing package id -> bid AND agreement restored to 480,000, non-awarded B2 untouched.
 * H3 cross-project isolation: same clash id deducted on HUNT and SIB; reverse on HUNT with the
 *    Plumbing id must not touch SIB; then SIB reverses clean.
 * H4 UI sweep: all 8 tabs on HUNT, claims-diagnostics + credits KPI == backend + 375px overflow probe.
 * Any new Medium+ -> finding A38-xx.
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, delay, shot, selectProjectByTitle, clickTab, setViewport } from "./lib.mjs";
import { client, fixtureTitle, writeEvidence, writeLog, readEvidence, sleep, call, creditRows, creditClashId, recomputeLeveled, creditInvariants, getBid, detect, EVIDENCE_DIR, VFD_TITLE } from "./qa38-lib.mjs";

const F = readEvidence("fixtures");
const c = client();
const BASE = "https://brainy-skunk-440.convex.site";
const TITLE = fixtureTitle("HUNT");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const findings = [];
const notes = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1500)}`);
};
const finding = (id, severity, title, evidence) => {
  findings.push({ id, severity, title, evidence });
  say(`FINDING ${id} [${severity}] ${title}`);
};
const note = (id, text, detail) => {
  notes.push({ id, text, detail });
  say(`NOTE ${id} ${text}`);
};
const rowsOf = (b) => creditRows(b).map((r) => ({ id: creditClashId(r.description), a: r.costDeduct || 0, acc: !!r.isAccepted }));
const OVERFLOW_PROBE = () => {
  const vw = document.documentElement.clientWidth;
  const insideScroller = (el) => {
    let n = el.parentElement;
    while (n && n !== document.body) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === "auto" || ox === "scroll" || ox === "hidden") return true;
      n = n.parentElement;
    }
    return false;
  };
  const offenders = [...document.querySelectorAll("body *")]
    .map((el) => ({ el, r: el.getBoundingClientRect(), cs: getComputedStyle(el) }))
    .filter(({ r, cs }) => r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden")
    .filter(({ r }) => r.right > vw + 0.5)
    .filter(({ el }) => !insideScroller(el))
    .map(({ el, r }) => ({ tag: el.tagName, cls: String(el.className || "").slice(0, 70), text: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40), right: Math.round(r.right * 10) / 10 }));
  return { vw, pageOverflow: document.documentElement.scrollWidth - vw, bodyOverflow: document.body.scrollWidth - vw, offenders: offenders.slice(0, 6), offenderCount: offenders.length };
};

async function purgeHunt() {
  for (const p of ((await c.query("projects:listProjects", {})) || []).filter((x) => x.title === TITLE)) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try { await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA38 hunt purge." }); } catch {}
    }
    try { await c.mutation("projects:deleteProject", { projectId: p._id }); } catch {}
    await sleep(250);
  }
}

async function main() {
  await purgeHunt();
  const dl = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  const id = await c.mutation("projects:createProject", { title: TITLE, location: "Austin, TX", projectType: "Class-A Commercial", estBudget: 1800000, targetCompletionWeeks: 52, specDocumentText: "QA38 HUNT scope.", isDemoProject: false, generalContractorName: "QA38 HUNT GC" });
  const p26 = await c.mutation("tradePackages:createTradePackage", { projectId: id, csiDivision: "26 00 00", tradeName: "QA38 HUNT Electrical", budgetEstimate: 900000, scopeSummary: "Electrical scope.", mandatoryInclusions: ["General scope"], bidDeadline: dl });
  const p23 = await c.mutation("tradePackages:createTradePackage", { projectId: id, csiDivision: "23 00 00", tradeName: "QA38 HUNT HVAC", budgetEstimate: 600000, scopeSummary: "HVAC scope.", mandatoryInclusions: ["General scope"], bidDeadline: dl });
  const p22 = await c.mutation("tradePackages:createTradePackage", { projectId: id, csiDivision: "22 00 00", tradeName: "QA38 HUNT Plumbing", budgetEstimate: 300000, scopeSummary: "Plumbing scope.", mandatoryInclusions: ["General scope"], bidDeadline: dl });
  const mkCtr = (pkgId, name, email, lic) => c.mutation("contractors:createContractor", { tradePackageId: pkgId, companyName: name, contactEmail: email, phone: "+1 (206) 555-0121", licenseNumber: lic, licenseStatus: "Active / Verified (QA38)", sourceUrl: "https://qa38.example.invalid/license", rfqStatus: "invited" });
  const c26 = await mkCtr(p26, "AUDIT-QA38 HUNT Electric", "estimating@qa38-hunt-e.invalid", "TX-QA38-HUNT-E");
  const c23a = await mkCtr(p23, "AUDIT-QA38 HUNT Mechanical B1", "estimating@qa38-hunt-m1.invalid", "TX-QA38-HUNT-M1");
  const c23b = await mkCtr(p23, "AUDIT-QA38 HUNT Mechanical B2", "estimating@qa38-hunt-m2.invalid", "TX-QA38-HUNT-M2");
  const c22 = await mkCtr(p22, "AUDIT-QA38 HUNT Plumbing", "estimating@qa38-hunt-p.invalid", "TX-QA38-HUNT-P");
  const mkBid = (pkgId, contractorId, name, base) => c.mutation("bids:submitDirectBid", { tradePackageId: pkgId, contractorId, subcontractorName: name, baseBidAmount: base, coiComplianceStatus: "compliant", coiPenalty: 0 });
  const b26 = await mkBid(p26, c26, "AUDIT-QA38 HUNT Electric", 800000);
  const b1 = await mkBid(p23, c23a, "AUDIT-QA38 HUNT Mechanical B1", 480000);
  const b2 = await mkBid(p23, c23b, "AUDIT-QA38 HUNT Mechanical B2", 497000);
  const b22 = await mkBid(p22, c22, "AUDIT-QA38 HUNT Plumbing", 280000);
  await c.mutation("bids:updateBidAdjustments", { bidId: b1.bidId, identifiedExclusions: [], valueEngineeringAlternates: [{ description: "VFD factory pricing credit (manual entry)", costDeduct: 26500, isAccepted: true }], leadTimePenalty: 0, coiPenalty: 0 });
  const B1 = b1.bidId, B2 = b2.bidId;
  const bidById = (bidId) => getBid(c, id, bidId);
  const agreementsOf = () => c.query("agreements:listAgreements", { projectId: id });

  const pre = await detect(c, id);
  const preV = pre.doubleBuys.find((x) => x.id === "clash-vfd-01");
  record("A38-H.0", "precondition: three packages with priced bids; two-HVAC-bid fixture collapses the VFD redundancy to $12,000; B1 carries the manual $26,500 credit (453,500)",
    preV?.redundantAmount === 12000 && (await bidById(B1))?.leveledTotalCost === 453500 && (await bidById(B2))?.leveledTotalCost === 497000,
    { vfd: preV?.redundantAmount, b1: (await bidById(B1))?.leveledTotalCost, b2: (await bidById(B2))?.leveledTotalCost });

  // ---------- H1 third-package reversal ----------
  const d1 = await call("hunt.deduct.vfd", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 12000, description: VFD_TITLE, bidId: B1 }));
  const b1a = await bidById(B1);
  const r1 = await call("hunt.reverse.with.plumbing.pkg", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p22 }));
  await sleep(400);
  const b1b = await bidById(B1);
  const inv1 = await creditInvariants(c, id);
  const h1 = d1.ok && b1a.leveledTotalCost === 441500 && r1.ok && r1.value?.reversedAmount === 12000 &&
    b1b.leveledTotalCost === 453500 && rowsOf(b1b).length === 0 && inv1.summary.actualTotal === 0 && inv1.clean;
  if (!h1) finding("A38-H1", "High", "third-package reversal failed: carrier not found or credit stranded when an unrelated package id is passed", { deduct: d1.value ?? d1.data, before: b1a.leveledTotalCost, reverse: r1.value ?? r1.data, after: b1b.leveledTotalCost, rows: rowsOf(b1b), inv: inv1.summary, clean: inv1.clean });
  record("A38-H1", "third-package reversal: deduct 12,000 on HVAC B1 (441,500 with manual 26,500 + clash 12,000), reverse with the UNRELATED Plumbing package id -> carrier found, 453,500 restored (manual kept), invariants clean",
    h1, { deduct: d1.value, reverse: r1.value, after: b1b.leveledTotalCost, rows: rowsOf(b1b), inv: inv1.summary });

  // ---------- H2 awarded-bid reversal + agreement sync ----------
  const award = await call("hunt.award.B1", () => c.mutation("agreements:generateAgreement", { bidId: B1, tradePackageId: p23 }));
  await sleep(400);
  const agrBefore = (await agreementsOf()).find((a) => a._id === award.value?._id) || null;
  const d2 = await call("hunt.deduct.awarded", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 12000, description: VFD_TITLE, bidId: B1 }));
  await sleep(300);
  const b1c = await bidById(B1);
  const agrMid = (await agreementsOf()).find((a) => a._id === award.value?._id) || null;
  const r2 = await call("hunt.reverse.awarded.with.plumbing.pkg", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p22 }));
  await sleep(500);
  const b1d = await bidById(B1);
  const b2d = await bidById(B2);
  const agrAfter = (await agreementsOf()).find((a) => a._id === award.value?._id) || null;
  const h2 = award.ok && d2.ok && b1c.leveledTotalCost === 441500 && agrMid?.contractSum === 441500 &&
    r2.ok && r2.value?.reversedAmount === 12000 && b1d.leveledTotalCost === 453500 && agrAfter?.contractSum === 453500 &&
    b2d.leveledTotalCost === 497000 && recomputeLeveled(b1d) === 453500;
  if (!h2) finding("A38-H2", "High", "awarded-bid third-package reversal desynced the bid or its agreement", { award: award.value ?? award.data, deduct: d2.value ?? d2.data, bid: { mid: b1c.leveledTotalCost, after: b1d.leveledTotalCost }, agreement: { before: agrBefore?.contractSum, mid: agrMid?.contractSum, after: agrAfter?.contractSum }, b2: b2d.leveledTotalCost });
  record("A38-H2", "awarded-bid reversal via the Plumbing package id: awarded B1 441,500 with agreement synced, then restored 453,500 with agreement re-synced; non-awarded B2 untouched 497,000",
    h2, { agreement: { before: agrBefore?.contractSum, mid: agrMid?.contractSum, after: agrAfter?.contractSum }, b1: b1d.leveledTotalCost, b2: b2d.leveledTotalCost });

  // ---------- H3 cross-project isolation ----------
  const sib = F.sib;
  const sibB = await getBid(c, sib.id, sib.b23.bidId);
  const dSib = await call("hunt.deduct.vfd.sib", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: sib.id, clashId: "clash-vfd-01", tradePackageId: sib.p23, deductAmount: 38500, description: VFD_TITLE, bidId: sib.b23.bidId }));
  const dHunt = await call("hunt.deduct.vfd.hunt2", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 12000, description: VFD_TITLE, bidId: B1 }));
  const rHunt = await call("hunt.reverse.hunt.third.pkg", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p22 }));
  await sleep(400);
  const sibMid = await getBid(c, sib.id, sib.b23.bidId);
  const invSibMid = await creditInvariants(c, sib.id);
  const h3a = dSib.ok && sibMid.leveledTotalCost === 441500 && invSibMid.summary.deducted === 1;
  const h3b = dHunt.ok && rHunt.ok && rHunt.value?.reversedAmount === 12000 && (await bidById(B1)).leveledTotalCost === 453500 && (await creditInvariants(c, id)).clean;
  const rSib = await call("hunt.reverse.sib.sibling", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: sib.id, clashId: "clash-vfd-01", tradePackageId: sib.p26 }));
  await sleep(400);
  const sibAfter = await getBid(c, sib.id, sib.b23.bidId);
  const invSibAfter = await creditInvariants(c, sib.id);
  const h3c = rSib.ok && rSib.value?.reversedAmount === 38500 && sibAfter.leveledTotalCost === 480000 && invSibAfter.clean;
  const h3 = h3a && h3b && h3c;
  if (!h3) finding("A38-H3", "High", "cross-project credit isolation failed: reversing in one project altered another project's credit or stranded state", { sibDeduct: dSib.value ?? dSib.data, huntReverse: rHunt.value ?? rHunt.data, sibMid: { l: sibMid.leveledTotalCost, inv: invSibMid.summary }, sibReverse: rSib.value ?? rSib.data, sibAfter: { l: sibAfter.leveledTotalCost, inv: invSibAfter.summary } });
  record("A38-H3", "cross-project isolation: same clash id credited in HUNT and SIB; reversing HUNT via the third package leaves SIB deducted (441,500); SIB then reverses clean to 480,000",
    h3, { sibMid: { leveled: sibMid.leveledTotalCost, inv: invSibMid.summary }, huntAfter: { leveled: (await bidById(B1)).leveledTotalCost }, sibAfter: { leveled: sibAfter.leveledTotalCost, inv: invSibAfter.summary } });

  // ---------- H4 UI sweep + diagnostics + overflow ----------
  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  fs.mkdirSync(path.join(EVIDENCE_DIR, "fix4-qa38-hunt-downloads"), { recursive: true });
  try {
    await page.goto(`${BASE}/?qa38=hunt`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
    await delay(700);
    const sel = await selectProjectByTitle(page, TITLE);
    await delay(1800);
    const tabNoise = [];
    for (const t of ["CSI Scoping", "Discovery", "Pre-Bid Q&A", "Bid Leveling", "Scope Clash", "Subcontracts", "Live Activity Audit", "Evals & Architecture"]) {
      await clickTab(page, t);
      await delay(1300);
      const txt = await page.evaluate(() => (document.querySelector("main") || document.body).innerText);
      const bad = [];
      if (/Gemini 3\.8/i.test(txt)) bad.push("gemini38");
      if (/dedicated (programmatic|stateful)?\s*(@agentmail\.to )?inbox/i.test(txt)) bad.push("dedicatedInbox");
      if (/(?<!\bnot an )official AIA/i.test(txt)) bad.push("officialAia");
      if (bad.length) tabNoise.push({ tab: t, bad });
    }
    await clickTab(page, "Scope Clash");
    await delay(1500);
    const ui = await page.evaluate(() => {
      const t = (document.querySelector("main") || document.body).innerText.replace(/\n/g, " ");
      return {
        credits: /Recoverable Buyout Credits\s*\$?([\d,]+)/.exec(t)?.[1] ?? null,
        buys: /Redundant Double-Buys\s*\$?([\d,]+)/.exec(t)?.[1] ?? null,
        chips: (t.match(/credit deducted & leveled/gi) || []).length,
        reverse: [...document.querySelectorAll("button")].filter((x) => /Reverse credit/.test(x.innerText || "")).length,
      };
    });
    const invUi = await creditInvariants(c, id);
    const dUi = await detect(c, id);
    const expectedBuys = dUi.doubleBuys.reduce((s, x) => s + (x.redundantAmount || 0), 0);
    const fmt = (n) => n.toLocaleString("en-US");
    const h4 = sel.ok && ui.credits === fmt(invUi.summary.actualTotal) && ui.buys === fmt(expectedBuys) && ui.chips === 0 && ui.reverse === 0 && invUi.summary.actualTotal === 0 && invUi.clean && tabNoise.length === 0;
    if (!h4) finding("A38-H4", "Medium", "HUNT UI sweep: credits KPI truth, chips, or claims text disagree with the backend", { sel, ui, expectedBuys, backend: invUi.summary, clean: invUi.clean, tabNoise });
    record("A38-H4", "UI sweep across all 8 tabs: no forbidden claims text; coordination KPI credits $0 / buys reconciled with the backend / 0 chips / 0 reverse == backend clean",
      h4, { ui, expectedBuys, backend: invUi.summary, tabNoise });
    await setViewport(page, 375, 780);
    await delay(900);
    const m375 = await page.evaluate(OVERFLOW_PROBE);
    await shot(page, "fix4-qa38-hunt-mobile-375-coordination.png", { full: true });
    await setViewport(page, 768, 900);
    await delay(900);
    const m768 = await page.evaluate(OVERFLOW_PROBE);
    await shot(page, "fix4-qa38-hunt-768-coordination.png", { full: true });
    const h5 = m375.pageOverflow <= 0 && m375.offenderCount === 0 && m768.pageOverflow <= 0 && m768.offenderCount === 0;
    if (!h5) finding("A38-H5", "Medium", "responsive overflow on coordination at 375px or 768px", { m375, m768 });
    record("A38-H5", "coordination responsive: no page-level horizontal overflow and no unclipped offenders at 375px and 768px", h5, { m375: { ov: m375.pageOverflow, off: m375.offenderCount, first: m375.offenders.slice(0, 3) }, m768: { ov: m768.pageOverflow, off: m768.offenderCount, first: m768.offenders.slice(0, 3) } });
    const appConsoleErrors = diag.consoleLogs.filter((l) => l.type === "error" && !/^\[CONVEX [MQA]\(/.test(l.text));
    record("A38-H6", "hunt UI diagnostics: zero page errors, zero application console errors",
      diag.pageErrors.length === 0 && appConsoleErrors.length === 0,
      { pageErrors: diag.pageErrors.slice(0, 4), appErrors: appConsoleErrors.map((e) => e.text.slice(0, 160)) });
    if (diag.pageErrors.length || appConsoleErrors.length) finding("A38-H6", "Medium", "hunt UI produced page/console errors", { pageErrors: diag.pageErrors.slice(0, 4), appErrors: appConsoleErrors.map((e) => e.text.slice(0, 160)) });
  } catch (err) {
    record("A38-H4.UI", "hunt UI sweep aborted", false, { error: String(err?.stack ?? err) });
  } finally {
    await browser.close();
  }

  // final cleanup of HUNT credit state (project deleted by qa38-99)
  const invFinal = await creditInvariants(c, id);
  const out = {
    projectId: id, p26, p23, p22, b1: B1, b2: B2, b22: b22.bidId, b26: b26.bidId,
    results, findings, notes,
    summary: { pass: results.filter((r) => r.pass).length, total: results.length, findings: findings.length, notes: notes.length, finalClean: invFinal.clean, finalInv: invFinal.summary },
  };
  writeEvidence("hunt", out);
  writeLog("hunt", log);
  console.log(`hunt: ${out.summary.pass}/${out.summary.total} pass, ${findings.length} findings, ${notes.length} notes`);
  if (findings.some((f) => /^(High|Critical)$/.test(f.severity)) || results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeEvidence("hunt", { results: [...results, { id: "A38-04.ERR", pass: false, name: "aborted", detail: String(e?.stack ?? e) }], findings, notes });
  writeLog("hunt-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});