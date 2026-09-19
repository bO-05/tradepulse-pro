/**
 * QA37-05 broad hunt (live). Fresh AUDIT-QA37-HUNT project:
 *  26(800k) + 23(600k) two bids B1(480k)/B2(497k) + accepted manual VFD $26,500
 *  -> BOTH clash redundancies exactly $12,000 (equal-amount surface).
 *
 * Backend state machine / races / claims:
 *  H1 illegal transitions refused (unknown clash id, reverse w/o resolution, zero/negative
 *     credit, cross-project package) with readable errors
 *  H2 duplicate deduct refused; exactly one marker row
 *  H3 two concurrent reverses of one clash: exactly one success, exactly one reversal audit
 *  H4 two concurrent deducts of one clash: exactly one success, exactly one marker row
 *  H5 award switch: deduct targets awarded B2 + syncs its agreement; reverse restores both
 *  H6 orphan clash-marker row with no resolution fabricates no deducted card
 *  H7 shrink probe: accepted credit row amount rewritten out-of-band -> card/KPI vs actual
 * UI:
 *  H8 claims truth: card chips + "Recoverable Buyout Credits" KPI == backend actual
 *  H9 responsive 375/768/1024: coordination + contracts-register overflow probe + shots
 * Any Medium+ becomes a finding; H7 is recorded Low if only reachable via the public
 * mutation (the UI editor cannot rewrite an existing alternate's amount).
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, delay, shot, selectProjectByTitle, clickTab, setViewport } from "./lib.mjs";
import { client, fixtureTitle, writeEvidence, writeLog, readEvidence, sleep, call, creditRows, creditClashId, recomputeLeveled, creditInvariants, getBid, detect, logs, EVIDENCE_DIR } from "./qa37-lib.mjs";

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
const VFD = "Variable Frequency Drives (VFDs) for AHUs & Pumps";
const DISC = "Rooftop Mechanical Equipment Disconnect Switches";
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
      try { await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA37 hunt purge." }); } catch {}
    }
    try { await c.mutation("projects:deleteProject", { projectId: p._id }); } catch {}
    await sleep(250);
  }
}

async function main() {
  await purgeHunt();
  const dl = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  const id = await c.mutation("projects:createProject", { title: TITLE, location: "Austin, TX", projectType: "Class-A Commercial", estBudget: 1600000, targetCompletionWeeks: 52, specDocumentText: "QA37 HUNT scope.", isDemoProject: false, generalContractorName: "QA37 HUNT GC" });
  const p26 = await c.mutation("tradePackages:createTradePackage", { projectId: id, csiDivision: "26 00 00", tradeName: "QA37 HUNT Electrical", budgetEstimate: 900000, scopeSummary: "Electrical scope.", mandatoryInclusions: ["General scope"], bidDeadline: dl });
  const p23 = await c.mutation("tradePackages:createTradePackage", { projectId: id, csiDivision: "23 00 00", tradeName: "QA37 HUNT HVAC", budgetEstimate: 600000, scopeSummary: "HVAC scope.", mandatoryInclusions: ["General scope"], bidDeadline: dl });
  const c26 = await c.mutation("contractors:createContractor", { tradePackageId: p26, companyName: "AUDIT-QA37 HUNT Electric", contactEmail: "estimating@qa37-hunt-e.invalid", phone: "+1 (206) 555-0121", licenseNumber: "TX-QA37-HUNT-E", licenseStatus: "Active / Verified (QA37)", sourceUrl: "https://qa37.example.invalid/license", rfqStatus: "invited" });
  const c23a = await c.mutation("contractors:createContractor", { tradePackageId: p23, companyName: "AUDIT-QA37 HUNT Mechanical B1", contactEmail: "estimating@qa37-hunt-m1.invalid", phone: "+1 (206) 555-0122", licenseNumber: "TX-QA37-HUNT-M1", licenseStatus: "Active / Verified (QA37)", sourceUrl: "https://qa37.example.invalid/license", rfqStatus: "invited" });
  const c23b = await c.mutation("contractors:createContractor", { tradePackageId: p23, companyName: "AUDIT-QA37 HUNT Mechanical B2", contactEmail: "estimating@qa37-hunt-m2.invalid", phone: "+1 (206) 555-0123", licenseNumber: "TX-QA37-HUNT-M2", licenseStatus: "Active / Verified (QA37)", sourceUrl: "https://qa37.example.invalid/license", rfqStatus: "invited" });
  const b26 = await c.mutation("bids:submitDirectBid", { tradePackageId: p26, contractorId: c26, subcontractorName: "AUDIT-QA37 HUNT Electric", baseBidAmount: 800000, coiComplianceStatus: "compliant", coiPenalty: 0 });
  const b1 = await c.mutation("bids:submitDirectBid", { tradePackageId: p23, contractorId: c23a, subcontractorName: "AUDIT-QA37 HUNT Mechanical B1", baseBidAmount: 480000, coiComplianceStatus: "compliant", coiPenalty: 0 });
  const b2 = await c.mutation("bids:submitDirectBid", { tradePackageId: p23, contractorId: c23b, subcontractorName: "AUDIT-QA37 HUNT Mechanical B2", baseBidAmount: 497000, coiComplianceStatus: "compliant", coiPenalty: 0 });
  await c.mutation("bids:updateBidAdjustments", { bidId: b1.bidId, identifiedExclusions: [], valueEngineeringAlternates: [{ description: "VFD factory pricing credit (manual entry)", costDeduct: 26500, isAccepted: true }], leadTimePenalty: 0, coiPenalty: 0 });
  const B1 = b1.bidId, B2 = b2.bidId;
  const bidById = (bidId) => getBid(c, id, bidId);
  const agreementsOf = () => c.query("agreements:listAgreements", { projectId: id });

  const pre = await detect(c, id);
  const preV = pre.doubleBuys.find((x) => x.id === "clash-vfd-01");
  const preD = pre.doubleBuys.find((x) => x.id === "clash-disconnect-02");
  record("A37-HUNT.0", "precondition: two HVAC bids; both equal-amount redundancies exactly $12,000",
    preV?.redundantAmount === 12000 && preD?.redundantAmount === 12000, { vfd: preV?.redundantAmount, disc: preD?.redundantAmount });

  // ---------- H1 illegal transitions ----------
  const u1 = await call("hunt.unknown.clash", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-unknown-99", tradePackageId: p23, deductAmount: 1000, description: "probe", bidId: B1 }));
  const u2 = await call("hunt.reverse.noresolution", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-disconnect-02", tradePackageId: p23 }));
  const u3 = await call("hunt.deduct.zero", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 0, description: "probe", bidId: B1 }));
  const u4 = await call("hunt.deduct.negative", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: -5000, description: "probe", bidId: B1 }));
  const u5 = await call("hunt.deduct.crossproject.pkg", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: F.sib.p26, deductAmount: 1000, description: "probe", bidId: B1 }));
  const refusals = !u1.ok && !u2.ok && !u3.ok && !u4.ok && !u5.ok;
  const h1 = !u1.ok && /Unknown clash id/.test(u1.data || "") &&
    !u2.ok && /no applied credit/i.test(u2.data || "") &&
    !u3.ok && /greater than zero|positive/i.test(u3.data || "") &&
    !u4.ok && /greater than zero|positive/i.test(u4.data || "") &&
    !u5.ok &&
    (await detect(c, id)).doubleBuys.every((x) => x.status === "detected");
  const crossReadable = /does not belong to the selected project/.test(u5.data || "") || /does not belong to the selected project/.test(u5.message || "");
  if (refusals && !crossReadable) {
    note("A37-H1-LOW", "Low / API-only: deductDoubleBuyCredit's cross-project package guard throws a plain Error, so the refusal reaches the client as a generic '[CONVEX ...] Server Error' instead of a readable message (reverseDoubleBuyCredit uses ConvexError for the same guard). No mutation occurs; not UI-reachable.", { u5: { ok: u5.ok, data: u5.data, message: u5.message }, u5Readable: crossReadable });
  }
  if (!h1) finding("A37-H1", "Medium", "illegal cross-trade transition not refused (unknown id / no-resolution reverse / non-positive credit / cross-project package)", { u1, u2, u3, u4, u5, refusals, crossReadable });
  record("A37-H1", "state machine refusals: unknown clash id, reverse without resolution, zero/negative credit, cross-project package all refused; no card mutated (cross-project message is generic, noted Low)",
    h1, { unknown: u1.data, noRes: u2.data, zero: u3.data, negative: u4.data ?? u4.message, cross: u5.data ?? u5.message, refusals, crossReadable });

  // ---------- H2 duplicate deduct ----------
  const d1 = await call("hunt.deduct.vfd", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 12000, description: VFD, bidId: B1 }));
  const d2 = await call("hunt.deduct.vfd.duplicate", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 12000, description: VFD, bidId: B1 }));
  const b1a = await bidById(B1);
  const h2 = d1.ok && d1.value?.deductAmount === 12000 && !d2.ok && /already been applied/i.test(d2.data || "") && b1a.leveledTotalCost === 441500 && rowsOf(b1a).length === 1;
  if (!h2) finding("A37-H2", "Medium", "duplicate deduct not refused or stacked marker rows", { d1: d1.value, d2: d2.data, leveled: b1a.leveledTotalCost, rows: rowsOf(b1a) });
  record("A37-H2", "duplicate deduct refused; exactly one marker row; bid 441,500", h2, { d1: d1.value, d2: d2.data, rows: rowsOf(b1a) });

  // ---------- H3 concurrent reverse race ----------
  const revBefore = (await logs(c, id, 200)).filter((l) => /Double-Buy Credit Reversed/.test(l.title || "")).length;
  const [rA, rB] = await Promise.all([
    call("hunt.reverse.race.A", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 })),
    call("hunt.reverse.race.B", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 })),
  ]);
  await sleep(500);
  const revAfter = (await logs(c, id, 200)).filter((l) => /Double-Buy Credit Reversed/.test(l.title || "")).length;
  const b1b = await bidById(B1);
  const h3 = [rA, rB].filter((r) => r.ok).length === 1 && [rA, rB].filter((r) => !r.ok).length === 1 &&
    revAfter - revBefore === 1 && b1b.leveledTotalCost === 453500 && rowsOf(b1b).length === 0;
  if (!h3) finding("A37-H3", "Medium", "concurrent reverse race double-reversed or wrote duplicate audit", { rA, rB, reversedAudits: [revBefore, revAfter], leveled: b1b.leveledTotalCost, rows: rowsOf(b1b) });
  record("A37-H3", "concurrent reverse race: exactly one success + one refusal, exactly one reversal audit, bid restored 453,500 (manual 26,500 kept)", h3,
    { ok: [rA.ok, rB.ok], audits: [revBefore, revAfter], leveled: b1b.leveledTotalCost });

  // ---------- H4 concurrent deduct race ----------
  const [dA, dB] = await Promise.all([
    call("hunt.deduct.race.A", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-disconnect-02", tradePackageId: p23, deductAmount: 12000, description: DISC, bidId: B1 })),
    call("hunt.deduct.race.B", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-disconnect-02", tradePackageId: p23, deductAmount: 12000, description: DISC, bidId: B1 })),
  ]);
  await sleep(400);
  const b1c = await bidById(B1);
  const h4 = [dA, dB].filter((r) => r.ok).length === 1 && rowsOf(b1c).filter((r) => r.id === "clash-disconnect-02").length === 1 && b1c.leveledTotalCost === 441500;
  if (!h4) finding("A37-H4", "Medium", "concurrent deduct race stacked credits or lost the resolution", { dA, dB, leveled: b1c.leveledTotalCost, rows: rowsOf(b1c) });
  record("A37-H4", "concurrent deduct race: exactly one success, one marker row, bid 441,500", h4, { ok: [dA.ok, dB.ok], leveled: b1c.leveledTotalCost, rows: rowsOf(b1c) });
  await call("hunt.reverse.disc.cleanup", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-disconnect-02", tradePackageId: p23 }));
  await sleep(300);

  // ---------- H5 award switch ----------
  const award = await call("hunt.award.B2", () => c.mutation("agreements:generateAgreement", { bidId: B2, tradePackageId: p23 }));
  const dV2 = await call("hunt.deduct.vfd.awarded", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 12000, description: VFD }));
  const b2a = await bidById(B2);
  const b1d = await bidById(B1);
  const agr2a = (await agreementsOf()).find((a) => a._id === award.value?._id);
  const rV2 = await call("hunt.reverse.vfd.awarded", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
  const b2b = await bidById(B2);
  const b1e = await bidById(B1);
  const agr2b = (await agreementsOf()).find((a) => a._id === award.value?._id);
  const h5 = award.ok && dV2.ok && dV2.value?.bidId === B2 && b2a.leveledTotalCost === 485000 && agr2a?.contractSum === 485000 && b1d.leveledTotalCost === 453500 &&
    rV2.ok && rV2.value?.reversedAmount === 12000 && b2b.leveledTotalCost === 497000 && agr2b?.contractSum === 497000 && b1e.leveledTotalCost === 453500 && recomputeLeveled(b2b) === 497000;
  if (!h5) finding("A37-H5", "Medium", "award-switch credit targeting/sync failed (awarded bid or its agreement desynced)", { deducted: dV2.value ?? dV2.data, reversed: rV2.value ?? rV2.data, b2: { l1: b2a.leveledTotalCost, l2: b2b.leveledTotalCost }, agreement: { s1: agr2a?.contractSum, s2: agr2b?.contractSum }, b1: b1e.leveledTotalCost });
  record("A37-H5", "award switch: deduct targets awarded B2 (485,000 + agreement sync), reverse restores B2/agreement 497,000; non-awarded B1 untouched",
    h5, { deducted: dV2.value, reversed: rV2.value, agreement: { before: agr2a?.contractSum, after: agr2b?.contractSum }, b1: b1e.leveledTotalCost });

  // ---------- H6 orphan marker ----------
  const b1f = await bidById(B1);
  const inject = await call("hunt.inject.orphan", () => c.mutation("bids:updateBidAdjustments", {
    bidId: B1, identifiedExclusions: [],
    valueEngineeringAlternates: (b1f.valueEngineeringAlternates || []).concat([{ description: "Cross-Trade Clash Credit [clash-disconnect-02]: Deduct redundant orphan marker probe", costDeduct: 12000, isAccepted: true }]),
    leadTimePenalty: 0, coiPenalty: 0,
  }));
  const dOrphan = await detect(c, id);
  const orphanCard = dOrphan.doubleBuys.find((x) => x.id === "clash-disconnect-02");
  const orphanB1 = await bidById(B1);
  const h6 = inject.ok && orphanCard?.status === "detected" && !orphanCard?.deductedAmount && !orphanCard?.staleResolution;
  if (!h6) finding("A37-H6", "Medium", "orphan clash-marker row fabricated a deducted/stale card", { card: orphanCard && { st: orphanCard.status, amt: orphanCard.deductedAmount, stale: orphanCard.staleResolution }, leveled: orphanB1.leveledTotalCost });
  record("A37-H6", "orphan accepted clash-marker row with no resolution fabricates no deducted/stale card (manual VE only)", h6,
    { card: orphanCard && { st: orphanCard.status, amt: orphanCard.deductedAmount, stale: orphanCard.staleResolution }, leveled: orphanB1.leveledTotalCost, rows: rowsOf(orphanB1) });
  await call("hunt.remove.orphan", () => c.mutation("bids:updateBidAdjustments", { bidId: B1, identifiedExclusions: [], valueEngineeringAlternates: (orphanB1.valueEngineeringAlternates || []).filter((v) => !String(v.description).startsWith("Cross-Trade Clash Credit")), leadTimePenalty: 0, coiPenalty: 0 }));

  // ---------- H7 shrink probe ----------
  const dShrink = await call("hunt.deduct.shrink", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 12000, description: VFD, bidId: B1 }));
  const b1g = await bidById(B1);
  const shrink = await call("hunt.shrink.row", () => c.mutation("bids:updateBidAdjustments", {
    bidId: B1, identifiedExclusions: [],
    valueEngineeringAlternates: (b1g.valueEngineeringAlternates || []).map((v) => String(v.description).startsWith("Cross-Trade Clash Credit [clash-vfd-01]") ? { ...v, costDeduct: 5000 } : v),
    leadTimePenalty: 0, coiPenalty: 0,
  }));
  await sleep(300);
  const dShrunk = await detect(c, id);
  const cardShrunk = dShrunk.doubleBuys.find((x) => x.id === "clash-vfd-01");
  const invShrunk = await creditInvariants(c, id);
  const b1h = await bidById(B1);
  const mismatch = cardShrunk?.status === "deducted" && cardShrunk?.deductedAmount === 12000 && invShrunk.summary.actualTotal === 5000 && b1h.leveledTotalCost === 448500;
  if (mismatch) {
    note("A37-H7", "pre-existing (QA36-00.4 carryover): public bids:updateBidAdjustments can shrink an accepted cross-trade credit row; the deducted card/KPI keep the original resolution amount (12,000 vs 5,000 actual). UI editor cannot edit an existing amount, so this is API-reachable only -> classified Low, not a new Medium+.", { card: cardShrunk && { st: cardShrunk.status, amt: cardShrunk.deductedAmount }, actual: invShrunk.summary.actualTotal, leveled: b1h.leveledTotalCost });
  }
  record("A37-H7", "shrink probe recorded (card 12,000 / actual 5,000 when the public mutation rewrites an accepted credit row); recovery via reverse returns the actual 5,000",
    dShrink.ok && shrink.ok && cardShrunk?.status === "deducted",
    { card: cardShrunk && { st: cardShrunk.status, amt: cardShrunk.deductedAmount }, actual: invShrunk.summary.actualTotal, mismatch });
  const rShrink = await call("hunt.reverse.shrunk", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
  await sleep(300);
  const b1i = await bidById(B1);
  const invAfterShrink = await creditInvariants(c, id);
  record("A37-H7b", "reverse after shrink removes the row and returns the ACTUAL accepted amount (5,000), deletes the record, card detected, no stranded credit",
    rShrink.ok && rShrink.value?.reversedAmount === 5000 && b1i.leveledTotalCost === 453500 && invAfterShrink.summary.actualTotal === 0 && invAfterShrink.clean,
    { reversed: rShrink.value, leveled: b1i.leveledTotalCost, inv: invAfterShrink.summary });

  // ---------- H8/H9 UI: claims truth + responsive ----------
  await c.mutation("coordination:deductDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23, deductAmount: 12000, description: VFD, bidId: B1 });
  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const dlDir = path.join(EVIDENCE_DIR, "fix4-qa37-hunt-downloads");
  fs.mkdirSync(dlDir, { recursive: true });
  try {
    await page.goto(`${BASE}/?qa37=hunt`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
    await delay(700);
    const sel = await selectProjectByTitle(page, TITLE);
    await delay(1800);
    await clickTab(page, "Scope Clash");
    await delay(1600);
    const ui = await page.evaluate(() => {
      const t = (document.querySelector("main") || document.body).innerText.replace(/\n/g, " ");
      return {
        credits: /Recoverable Buyout Credits\s*\$?([\d,]+)/.exec(t)?.[1] ?? null,
        chips: (t.match(/credit deducted & leveled/gi) || []).length,
        reverse: [...document.querySelectorAll("button")].filter((x) => /Reverse credit/.test(x.innerText || "")).length,
      };
    });
    const invUi = await creditInvariants(c, id);
    const h8 = sel.ok && ui.credits === "12,000" && ui.chips === 1 && ui.reverse === 1 && invUi.summary.actualTotal === 12000 && invUi.summary.claimsTotal === 12000;
    if (!h8) finding("A37-H8", "Medium", "claims truth: coordination UI KPI/chips disagree with the actual accepted credit", { ui, backend: invUi.summary });
    record("A37-H8", "claims truth: UI 'Recoverable Buyout Credits' $12,000 + 1 deducted chip + 1 Reverse == backend actual/claims 12,000", h8, { ui, backend: invUi.summary });

    const responsive = [];
    for (const [w, h] of [[375, 812], [768, 1024], [1024, 768]]) {
      await setViewport(page, w, h);
      await delay(600);
      await clickTab(page, "Scope Clash");
      await delay(900);
      const probe = await page.evaluate(OVERFLOW_PROBE);
      await shot(page, `fix4-qa37-responsive-${w}-coordination.png`, { full: true });
      responsive.push({ w, h, view: "coordination", ...probe });
    }
    await page.goto(`${BASE}/?project=${id}&tab=contracts&qa37=hunt-register`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await delay(1800);
    await setViewport(page, 768, 1024);
    await delay(600);
    const regProbe768 = await page.evaluate(OVERFLOW_PROBE);
    await shot(page, "fix4-qa37-responsive-768-register.png", { full: true });
    responsive.push({ w: 768, h: 1024, view: "register", ...regProbe768 });
    await setViewport(page, 1024, 768);
    await delay(600);
    const regProbe1024 = await page.evaluate(OVERFLOW_PROBE);
    await shot(page, "fix4-qa37-responsive-1024-register.png", { full: true });
    responsive.push({ w: 1024, h: 768, view: "register", ...regProbe1024 });
    const h9 = responsive.every((r) => r.pageOverflow <= 1 && r.bodyOverflow <= 1 && r.offenderCount === 0);
    if (!h9) finding("A37-H9", "Medium", "responsive horizontal overflow at 375/768/1024 on coordination or contracts register", { responsive });
    record("A37-H9", "responsive: no non-scroller horizontal overflow on coordination (375/768/1024) or contracts register (768/1024)", h9,
      { probes: responsive.map((r) => ({ w: r.w, view: r.view, pageOverflow: r.pageOverflow, offenderCount: r.offenderCount })) });

    const appConsoleErrors = diag.consoleLogs.filter((l) => l.type === "error" && !/^\[CONVEX [MQA]\(/.test(l.text));
    record("A37-HUNT.diag", "hunt UI pass: zero page errors and zero application console errors",
      diag.pageErrors.length === 0 && appConsoleErrors.length === 0,
      { pageErrors: diag.pageErrors.slice(0, 4), appErrors: appConsoleErrors.map((e) => e.text.slice(0, 160)) });
  } catch (err) {
    record("A37-HUNT.UI.ERR", "hunt UI pass aborted", false, { error: String(err?.stack ?? err) });
  } finally {
    await browser.close();
  }

  // cleanup HUNT project state (project itself deleted by qa37-99)
  await call("hunt.reverse.final", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: id, clashId: "clash-vfd-01", tradePackageId: p23 }));
  const invFinal = await creditInvariants(c, id);
  const out = {
    projectId: id, p23, b1: B1, b2: B2, results, findings, notes,
    summary: { pass: results.filter((r) => r.pass).length, total: results.length, findings: findings.length, notes: notes.length, finalClean: invFinal.clean, finalInv: invFinal.summary },
  };
  writeEvidence("hunt", out);
  writeLog("hunt", log);
  console.log(`hunt: ${out.summary.pass}/${out.summary.total} pass, ${findings.length} findings, ${notes.length} notes`);
  if (findings.some((f) => /^(High|Critical)$/.test(f.severity)) || results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeEvidence("hunt", { results: [...results, { id: "A37-05.ERR", pass: false, name: "aborted", detail: String(e?.stack ?? e) }], findings, notes });
  writeLog("hunt-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});