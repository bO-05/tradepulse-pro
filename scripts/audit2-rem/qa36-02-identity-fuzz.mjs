/**
 * QA36-02 clash-keyed identity fuzz + regression sweep.
 * 44 operations across SM / EQ / MB: equal and unequal amounts, manual VE edits,
 * un-accept/re-accept via the public leveling mutations, stale create/clear,
 * award switches, executed-immutability refusals, wrong-package reverse probe,
 * amount-drift probe. Every op asserts: card amount == accepted marker row sum
 * for the same clash id, KPI == real accepted credit money, no orphan/stacked
 * credits, no leveled drift, and audit claims match the money moved.
 */
import {
  client, readEvidence, writeEvidence, writeLog, call, sleep,
  creditInvariants, getBid, creditRows, creditClashId, recomputeLeveled,
  latestAudit, REVERSED_AUDIT_RX, CLASH_VFD, CLASH_DISC, VFD_TITLE, DISC_TITLE,
} from "./qa36-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const findings = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1500)}`);
};
const finding = (id, severity, title, evidence) => {
  findings.push({ id, severity, title, evidence });
  say(`FINDING ${id} [${severity}] ${title}`);
};

const logsOf = (projectId, limit = 500) => c.query("auditLogs:listRecentLogs", { projectId, limit });
const describeRows = (bid) => creditRows(bid).map((r) => ({ id: creditClashId(r.description), a: r.costDeduct || 0, acc: !!r.isAccepted }));
const cardOf = (inv, id) => inv.cards.find((x) => x.id === id);
const statedRestore = (rows) => {
  const l = latestAudit(rows, REVERSED_AUDIT_RX);
  const m = /restored to \$([\d,]+)/.exec(l?.description || "");
  return m ? Number(m[1].replace(/,/g, "")) : null;
};
const setAlternates = (bidId, alternates) =>
  c.mutation("bids:updateBidAdjustments", { bidId, identifiedExclusions: [], valueEngineeringAlternates: alternates, leadTimePenalty: 0, coiPenalty: 0 });

async function main() {
  const SM = F.sm.id, SMB = F.sm.b23.bidId;
  const EQ = F.eq.id, EQB = F.eq.b23.bidId;
  const MB = F.mb.id, MBB1 = F.mb.b23.bidId, MBB2 = F.mb.b23b.bidId;

  // ---------------------------------------------------------------- SM init
  {
    const inv = await creditInvariants(c, SM);
    const b = await getBid(c, SM, SMB);
    record("A36-F01", "SM init: both clashes detected ($38,500/$12,000), bid 480,000, zero credits",
      inv.clean && inv.claimsTotal === 0 && b.leveledTotalCost === 480000 &&
        cardOf(inv, CLASH_VFD).status === "detected" && cardOf(inv, CLASH_VFD).redundantAmount === 38500 &&
        cardOf(inv, CLASH_DISC).redundantAmount === 12000,
      { leveled: b.leveledTotalCost, summary: inv.summary });
  }

  // op1 deduct VFD 38,500
  {
    const r = await call("sm.deduct.vfd", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: SM, clashId: CLASH_VFD, tradePackageId: F.sm.p23, deductAmount: 38500, description: VFD_TITLE }));
    const b = await getBid(c, SM, SMB); const inv = await creditInvariants(c, SM);
    const vfd = cardOf(inv, CLASH_VFD);
    record("A36-F02", "op1 deduct VFD 38,500 (unequal): wallet-row KPI == actual, bid 441,500",
      r.ok && b.leveledTotalCost === 441500 && inv.clean && vfd.status === "deducted" && vfd.deductedAmount === 38500 &&
        inv.claimsTotal === 38500 && inv.actualTotal === 38500 && inv.acceptedCredits[0].clashId === CLASH_VFD,
      { leveled: b.leveledTotalCost, rows: describeRows(b), summary: inv.summary });
  }

  // op2 manual accepted row 5,000
  {
    const b0 = await getBid(c, SM, SMB);
    const alt = [...b0.valueEngineeringAlternates, { description: "QA36 Riser coordination allowance", costDeduct: 5000, isAccepted: true }];
    const r = await call("sm.manual.5000", () => setAlternates(SMB, alt));
    const b = await getBid(c, SM, SMB); const inv = await creditInvariants(c, SM);
    record("A36-F03", "op2 manual accepted 5,000: bid 436,500; VFD identity unaffected",
      r.ok && b.leveledTotalCost === 436500 && inv.clean && cardOf(inv, CLASH_VFD).deductedAmount === 38500 && inv.kpiVsActual,
      { leveled: b.leveledTotalCost, summary: inv.summary });
  }

  // op3 reverse VFD (manual preserved)
  {
    const r = await call("sm.reverse.vfd", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: SM, clashId: CLASH_VFD, tradePackageId: F.sm.p23 }));
    const b = await getBid(c, SM, SMB); const inv = await creditInvariants(c, SM);
    const stated = statedRestore(await logsOf(SM));
    record("A36-F04", "op3 reverse VFD: 475,000 (manual $5,000 preserved), reversedAmount 38,500, audit restored-to matches",
      r.ok && r.value.reversedAmount === 38500 && b.leveledTotalCost === 475000 && inv.clean && inv.actualTotal === 0 &&
        (b.valueEngineeringAlternates || []).length === 1 && stated === 475000,
      { reversed: r.value, leveled: b.leveledTotalCost, stated, rows: describeRows(b) });
  }

  // op4 reverse again -> refusal
  {
    const before = await getBid(c, SM, SMB);
    const r = await call("sm.reverse.vfd.again", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: SM, clashId: CLASH_VFD, tradePackageId: F.sm.p23 }));
    const b = await getBid(c, SM, SMB);
    record("A36-F05", "op4 reverse with no applied credit refused, no side effects",
      !r.ok && /no applied credit/.test(String(r.data ?? r.message)) && b.leveledTotalCost === before.leveledTotalCost && JSON.stringify(b.valueEngineeringAlternates) === JSON.stringify(before.valueEngineeringAlternates),
      { refusal: r.data ?? r.message, leveled: b.leveledTotalCost });
  }

  // op5 deduct DISC 12,000
  {
    const r = await call("sm.deduct.disc", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: SM, clashId: CLASH_DISC, tradePackageId: F.sm.p23, deductAmount: 12000, description: DISC_TITLE }));
    const b = await getBid(c, SM, SMB); const inv = await creditInvariants(c, SM);
    record("A36-F06", "op5 deduct DISC 12,000: bid 463,000, disc marker keyed, VFD still detected",
      r.ok && b.leveledTotalCost === 463000 && inv.clean && cardOf(inv, CLASH_DISC).deductedAmount === 12000 && cardOf(inv, CLASH_VFD).status === "detected",
      { leveled: b.leveledTotalCost, rows: describeRows(b) });
  }

  // op6 deduct VFD again (two markers, unequal amounts)
  {
    const r = await call("sm.deduct.vfd2", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: SM, clashId: CLASH_VFD, tradePackageId: F.sm.p23, deductAmount: 38500, description: VFD_TITLE }));
    const b = await getBid(c, SM, SMB); const inv = await creditInvariants(c, SM);
    record("A36-F07", "op6 two live credits (38,500 + 12,000): 424,500; distinct markers; no stacked/orphan",
      r.ok && b.leveledTotalCost === 424500 && inv.clean && inv.claimsTotal === 50500 && inv.actualTotal === 50500 &&
        new Set(inv.acceptedCredits.map((x) => x.clashId)).size === 2 && inv.stacked.length === 0,
      { leveled: b.leveledTotalCost, rows: describeRows(b), summary: inv.summary });
  }

  // op7 un-accept VFD only (public leveling save)
  {
    const b0 = await getBid(c, SM, SMB);
    const alt = b0.valueEngineeringAlternates.map((v) => (String(v.description).startsWith("Cross-Trade Clash Credit") && String(v.description).includes(CLASH_VFD) ? { ...v, isAccepted: false } : v));
    const r = await call("sm.unaccept.vfd", () => setAlternates(SMB, alt));
    const b = await getBid(c, SM, SMB); const inv = await creditInvariants(c, SM);
    record("A36-F08", "op7 un-accept VFD: bid 463,000 back; VFD detected + staleResolution; DISC stays deducted (clash-keyed, not amount-keyed)",
      r.ok && b.leveledTotalCost === 463000 && inv.clean && cardOf(inv, CLASH_VFD).status === "detected" && cardOf(inv, CLASH_VFD).staleResolution === true &&
        cardOf(inv, CLASH_DISC).status === "deducted" && cardOf(inv, CLASH_DISC).deductedAmount === 12000 && inv.limbo.length === 0 && inv.staleWithAccepted.length === 0,
      { leveled: b.leveledTotalCost, cards: inv.cards.filter((x) => x.kind === "double_buy").map((x) => ({ id: x.id, st: x.status, amt: x.deductedAmount, stale: x.staleResolution ?? false })), summary: inv.summary });
  }

  // op8 deduct while stale -> refusal
  {
    const before = await getBid(c, SM, SMB);
    const r = await call("sm.deduct.vfd.stale", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: SM, clashId: CLASH_VFD, tradePackageId: F.sm.p23, deductAmount: 38500, description: VFD_TITLE }));
    const b = await getBid(c, SM, SMB);
    record("A36-F09", "op8 deduct while stale refused ('already applied'), no mutation",
      !r.ok && /already been applied/.test(String(r.data ?? r.message)) && b.leveledTotalCost === before.leveledTotalCost,
      { refusal: r.data ?? r.message, leveled: b.leveledTotalCost });
  }

  // op9 clear stale VFD
  {
    const r = await call("sm.clear.vfd", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: SM, clashId: CLASH_VFD, tradePackageId: F.sm.p23 }));
    const b = await getBid(c, SM, SMB); const inv = await creditInvariants(c, SM);
    record("A36-F10", "op9 clear stale VFD: declined row removed, bid unchanged 463,000, DISC still deducted, VFD fully detected",
      r.ok && b.leveledTotalCost === 463000 && inv.clean && cardOf(inv, CLASH_VFD).status === "detected" && !cardOf(inv, CLASH_VFD).staleResolution && cardOf(inv, CLASH_DISC).status === "deducted",
      { note: r.value.note, leveled: b.leveledTotalCost, summary: inv.summary });
  }

  // op10 re-deduct VFD
  {
    const r = await call("sm.deduct.vfd3", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: SM, clashId: CLASH_VFD, tradePackageId: F.sm.p23, deductAmount: 38500, description: VFD_TITLE }));
    const b = await getBid(c, SM, SMB); const inv = await creditInvariants(c, SM);
    record("A36-F11", "op10 re-deduct VFD after clear: 424,500; both deducted; KPI 50,500",
      r.ok && b.leveledTotalCost === 424500 && inv.clean && inv.claimsTotal === 50500 && inv.actualTotal === 50500,
      { leveled: b.leveledTotalCost, summary: inv.summary });
  }

  // op11 reverse DISC only -> VFD must survive (pre-fix A34-02 over-reversal)
  {
    const r = await call("sm.reverse.disc", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: SM, clashId: CLASH_DISC, tradePackageId: F.sm.p23 }));
    const b = await getBid(c, SM, SMB); const inv = await creditInvariants(c, SM);
    record("A36-F12", "op11 reverse DISC only: bid 436,500; VFD marker survives accepted; reversedAmount 12,000; no over-reversal",
      r.ok && r.value.reversedAmount === 12000 && b.leveledTotalCost === 436500 && inv.clean &&
        inv.acceptedCredits.length === 1 && inv.acceptedCredits[0].clashId === CLASH_VFD && cardOf(inv, CLASH_DISC).status === "detected",
      { reversed: r.value, leveled: b.leveledTotalCost, rows: describeRows(b) });
  }

  // op12 reverse VFD -> manual only
  {
    const r = await call("sm.reverse.vfd2", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: SM, clashId: CLASH_VFD, tradePackageId: F.sm.p23 }));
    const b = await getBid(c, SM, SMB); const inv = await creditInvariants(c, SM);
    record("A36-F13", "op12 reverse VFD: 475,000 (manual $5,000 survives); zero credits; both detected",
      r.ok && b.leveledTotalCost === 475000 && inv.clean && inv.actualTotal === 0 &&
        (b.valueEngineeringAlternates || []).every((v) => !String(v.description).startsWith("Cross-Trade Clash Credit")),
      { reversed: r.value, leveled: b.leveledTotalCost, rows: describeRows(b) });
  }

  // op13 deduct DISC then un-accept then clear
  {
    await call("sm.deduct.disc2", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: SM, clashId: CLASH_DISC, tradePackageId: F.sm.p23, deductAmount: 12000, description: DISC_TITLE }));
    const b1 = await getBid(c, SM, SMB);
    const alt = b1.valueEngineeringAlternates.map((v) => (String(v.description).includes(CLASH_DISC) ? { ...v, isAccepted: false } : v));
    await call("sm.unaccept.disc", () => setAlternates(SMB, alt));
    const b2 = await getBid(c, SM, SMB); const inv2 = await creditInvariants(c, SM);
    const r3 = await call("sm.clear.disc", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: SM, clashId: CLASH_DISC, tradePackageId: F.sm.p23 }));
    const b3 = await getBid(c, SM, SMB); const inv3 = await creditInvariants(c, SM);
    record("A36-F14", "op13 DISC decline->clear cycle: decline restores 475,000 + stale; clear removes row, bid unchanged, all clean",
      b1.leveledTotalCost === 463000 && b2.leveledTotalCost === 475000 && inv2.clean && cardOf(inv2, CLASH_DISC).staleResolution === true &&
        r3.ok && b3.leveledTotalCost === 475000 && inv3.clean && !cardOf(inv3, CLASH_DISC).staleResolution,
      { afterDecline: b2.leveledTotalCost, afterClear: b3.leveledTotalCost, stale: cardOf(inv2, CLASH_DISC).staleResolution });
  }

  // op14 add manual VFD-named 2,000 then deduct VFD
  {
    const b0 = await getBid(c, SM, SMB);
    await call("sm.manual.vfd", () => setAlternates(SMB, [...b0.valueEngineeringAlternates, { description: "QA36 VFD factory direct buy credit", costDeduct: 2000, isAccepted: true }]));
    const r = await call("sm.deduct.vfd4", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: SM, clashId: CLASH_VFD, tradePackageId: F.sm.p23, deductAmount: 38500, description: VFD_TITLE }));
    const b = await getBid(c, SM, SMB); const inv = await creditInvariants(c, SM);
    const vfd = cardOf(inv, CLASH_VFD);
    record("A36-F14b", "op14 manual VFD-named coverage: the credit row itself counts as coverage so surplus redundancy collapses to 0 while the card keeps its own $38,500 amount",
      r.ok && b.leveledTotalCost === 434500 && inv.clean && vfd.deductedAmount === 38500 && vfd.redundantAmount === 0 && inv.actualTotal === 38500,
      { leveled: b.leveledTotalCost, card: { amt: vfd.deductedAmount, redundant: vfd.redundantAmount }, rows: describeRows(b) });
  }

  // op15 reverse VFD: manual rows survive
  {
    const r = await call("sm.reverse.vfd3", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: SM, clashId: CLASH_VFD, tradePackageId: F.sm.p23 }));
    const b = await getBid(c, SM, SMB); const inv = await creditInvariants(c, SM);
    const manuals = (b.valueEngineeringAlternates || []).filter((v) => !String(v.description).startsWith("Cross-Trade Clash Credit"));
    record("A36-F15", "op15 reverse VFD with two manual rows: 473,000; manuals preserved; card detected at 36,500 redundancy",
      r.ok && b.leveledTotalCost === 473000 && inv.clean && manuals.length === 2 && cardOf(inv, CLASH_VFD).status === "detected" && cardOf(inv, CLASH_VFD).redundantAmount === 36500,
      { leveled: b.leveledTotalCost, rows: describeRows(b) });
  }

  // op16 drop manual VFD-named row
  {
    const b0 = await getBid(c, SM, SMB);
    const alt = b0.valueEngineeringAlternates.filter((v) => !String(v.description).includes("VFD factory direct buy"));
    const r = await call("sm.drop.manual.vfd", () => setAlternates(SMB, alt));
    const b = await getBid(c, SM, SMB); const inv = await creditInvariants(c, SM);
    record("A36-F16", "op16 drop manual VFD row: 475,000, redundancy back to 38,500, still clean",
      r.ok && b.leveledTotalCost === 475000 && inv.clean && cardOf(inv, CLASH_VFD).redundantAmount === 38500,
      { leveled: b.leveledTotalCost, redundant: cardOf(inv, CLASH_VFD).redundantAmount });
  }

  // op17 drop last manual row -> 480,000
  {
    const b0 = await getBid(c, SM, SMB);
    const alt = b0.valueEngineeringAlternates.filter((v) => !String(v.description).includes("Riser coordination"));
    const r = await call("sm.drop.manual", () => setAlternates(SMB, alt));
    const b = await getBid(c, SM, SMB); const inv = await creditInvariants(c, SM);
    record("A36-F17", "op17 drop last manual row: bid exactly 480,000; zero rows; both detected",
      r.ok && b.leveledTotalCost === 480000 && inv.clean && (b.valueEngineeringAlternates || []).length === 0 && inv.actualTotal === 0,
      { leveled: b.leveledTotalCost, summary: inv.summary });
  }

  // ---------------------------------------------------------------- EQ
  {
    const inv = await creditInvariants(c, EQ);
    const b = await getBid(c, EQ, EQB);
    record("A36-EQ01", "EQ init: manual $26,500 -> BOTH redundancies exactly $12,000; bid 453,500",
      inv.clean && b.leveledTotalCost === 453500 && cardOf(inv, CLASH_VFD).redundantAmount === 12000 && cardOf(inv, CLASH_DISC).redundantAmount === 12000,
      { vfd: cardOf(inv, CLASH_VFD).redundantAmount, disc: cardOf(inv, CLASH_DISC).redundantAmount, leveled: b.leveledTotalCost });
  }
  {
    await call("eq.deduct.vfd", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: EQ, clashId: CLASH_VFD, tradePackageId: F.eq.p23, deductAmount: 12000, description: VFD_TITLE }));
    const r2 = await call("eq.deduct.disc", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: EQ, clashId: CLASH_DISC, tradePackageId: F.eq.p23, deductAmount: 12000, description: DISC_TITLE }));
    const b = await getBid(c, EQ, EQB); const inv = await creditInvariants(c, EQ);
    record("A36-EQ02", "op18/19 equal-amount credits: two distinct markers $12,000 each; bid 429,500; KPI 24,000 == actual; no mask/stack",
      r2.ok && b.leveledTotalCost === 429500 && inv.clean && inv.claimsTotal === 24000 && inv.actualTotal === 24000 &&
        new Set(inv.acceptedCredits.map((x) => x.clashId)).size === 2 && inv.overclaim.length === 0 && inv.mismatchRow.length === 0 && inv.stacked.length === 0,
      { leveled: b.leveledTotalCost, rows: describeRows(b), summary: inv.summary });
  }
  {
    const b0 = await getBid(c, EQ, EQB);
    const alt = b0.valueEngineeringAlternates.map((v) => (String(v.description).includes(CLASH_VFD) ? { ...v, isAccepted: false } : v));
    await call("eq.unaccept.vfd", () => setAlternates(EQB, alt));
    const b = await getBid(c, EQ, EQB); const inv = await creditInvariants(c, EQ);
    record("A36-EQ03", "op20 un-accept VFD only: VFD detected+stale, DISC deducted $12,000, bid 441,500, KPI 12,000 == actual (the A34-01 mask is gone)",
      b.leveledTotalCost === 441500 && inv.clean && inv.claimsTotal === 12000 && inv.actualTotal === 12000 &&
        cardOf(inv, CLASH_VFD).staleResolution === true && cardOf(inv, CLASH_DISC).status === "deducted" && cardOf(inv, CLASH_VFD).status === "detected",
      { leveled: b.leveledTotalCost, cards: inv.cards.filter((x) => x.kind === "double_buy").map((x) => ({ id: x.id, st: x.status, amt: x.deductedAmount, stale: x.staleResolution ?? false })), summary: inv.summary });
  }
  {
    const r = await call("eq.clear.vfd", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: EQ, clashId: CLASH_VFD, tradePackageId: F.eq.p23 }));
    const b = await getBid(c, EQ, EQB); const inv = await creditInvariants(c, EQ);
    record("A36-EQ04", "op21 clear stale VFD: declined row removed; DISC $12,000 keeps its own money; bid 441,500",
      r.ok && b.leveledTotalCost === 441500 && inv.clean && inv.actualTotal === 12000 && inv.acceptedCredits[0].clashId === CLASH_DISC,
      { note: r.value.note, leveled: b.leveledTotalCost, rows: describeRows(b) });
  }
  {
    const r = await call("eq.rededuct.vfd", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: EQ, clashId: CLASH_VFD, tradePackageId: F.eq.p23, deductAmount: 12000, description: VFD_TITLE }));
    const b = await getBid(c, EQ, EQB); const inv = await creditInvariants(c, EQ);
    record("A36-EQ05", "op22 re-deduct VFD: 429,500; two live equal credits; KPI 24,000 == actual",
      r.ok && b.leveledTotalCost === 429500 && inv.clean && inv.actualTotal === 24000 && inv.kpiVsActual,
      { leveled: b.leveledTotalCost, summary: inv.summary });
  }
  {
    const r = await call("eq.reverse.vfd.only", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: EQ, clashId: CLASH_VFD, tradePackageId: F.eq.p23 }));
    const b = await getBid(c, EQ, EQB); const inv = await creditInvariants(c, EQ);
    const auditStated = statedRestore(await logsOf(EQ));
    record("A36-EQ06", "op23 reverse VFD only (equal amounts): DISC survives; bid 441,500; reversedAmount 12,000; audit restored-to matches (A34-02 regression)",
      r.ok && r.value.reversedAmount === 12000 && b.leveledTotalCost === 441500 && inv.clean && inv.actualTotal === 12000 &&
        inv.acceptedCredits[0].clashId === CLASH_DISC && auditStated === 441500,
      { reversed: r.value, leveled: b.leveledTotalCost, rows: describeRows(b), auditStated });
  }
  {
    const r = await call("eq.reverse.disc", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: EQ, clashId: CLASH_DISC, tradePackageId: F.eq.p23 }));
    const b = await getBid(c, EQ, EQB); const inv = await creditInvariants(c, EQ);
    record("A36-EQ07", "op24 reverse DISC: bid exactly 453,500 (manual $26,500 only); both detected; KPI 0",
      r.ok && r.value.reversedAmount === 12000 && b.leveledTotalCost === 453500 && inv.clean && inv.actualTotal === 0 && cardOf(inv, CLASH_VFD).status === "detected",
      { reversed: r.value, leveled: b.leveledTotalCost, rows: describeRows(b) });
  }
  {
    // op25 swap order: DISC first, then un-accept/re-accept DISC
    await call("eq.deduct.disc2", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: EQ, clashId: CLASH_DISC, tradePackageId: F.eq.p23, deductAmount: 12000, description: DISC_TITLE }));
    const b1 = await getBid(c, EQ, EQB);
    const alt = b1.valueEngineeringAlternates.map((v) => (String(v.description).includes(CLASH_DISC) ? { ...v, isAccepted: false } : v));
    await call("eq.unaccept.disc", () => setAlternates(EQB, alt));
    const b2 = await getBid(c, EQ, EQB); const inv2 = await creditInvariants(c, EQ);
    const b2rows = b2.valueEngineeringAlternates;
    await call("eq.reaccept.disc", () => setAlternates(EQB, b2rows.map((v) => (String(v.description).includes(CLASH_DISC) ? { ...v, isAccepted: true } : v))));
    const b3 = await getBid(c, EQ, EQB); const inv3 = await creditInvariants(c, EQ);
    record("A36-EQ08", "op25/26/27 DISC decline then re-accept with the still-persisted record: decline restores 453,500 + stale; re-accept re-deducts to 441,500 with one marker, clean",
      b1.leveledTotalCost === 441500 && b2.leveledTotalCost === 453500 && inv2.clean && cardOf(inv2, CLASH_DISC).staleResolution === true &&
        b3.leveledTotalCost === 441500 && inv3.clean && cardOf(inv3, CLASH_DISC).status === "deducted" && inv3.acceptedCredits.length === 1,
      { b1: b1.leveledTotalCost, b2: b2.leveledTotalCost, b3: b3.leveledTotalCost });
  }
  {
    const r = await call("eq.reverse.disc2", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: EQ, clashId: CLASH_DISC, tradePackageId: F.eq.p23 }));
    const b = await getBid(c, EQ, EQB); const inv = await creditInvariants(c, EQ);
    record("A36-EQ09", "op28 final EQ reverse: restored 453,500, zero credits, both detected",
      r.ok && b.leveledTotalCost === 453500 && inv.clean && inv.actualTotal === 0,
      { leveled: b.leveledTotalCost, summary: inv.summary });
  }

  // ---------------------------------------------------------------- MB (award switches)
  {
    const r = await call("mb.deduct.vfd", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: MB, clashId: CLASH_VFD, tradePackageId: F.mb.p23, deductAmount: 38500, description: VFD_TITLE }));
    const b = await getBid(c, MB, MBB1); const inv = await creditInvariants(c, MB);
    record("A36-MB01", "op29 deduct VFD targets cheapest B1: 441,500",
      r.ok && b.leveledTotalCost === 441500 && inv.clean && inv.acceptedCredits[0].bidId === MBB1,
      { leveled: b.leveledTotalCost, carrier: inv.acceptedCredits[0].bidId });
  }
  {
    const r = await call("mb.award.B1", () => c.mutation("agreements:generateAgreement", { bidId: MBB1, tradePackageId: F.mb.p23 }));
    await sleep(400);
    const agrs = await c.query("agreements:listAgreements", { projectId: MB });
    const agr = agrs.find((a) => a.bidId === MBB1 && a.status !== "superseded");
    record("A36-MB02", "op30 award B1 after credit: agreement contractSum 441,500 synced to the credited bid",
      r.ok && agr?.contractSum === 441500 && agr?.status === "generated",
      { agreement: { n: agr?.agreementNumber, s: agr?.status, sum: agr?.contractSum } });
  }
  {
    const r = await call("mb.award.B2.switch", () => c.mutation("agreements:generateAgreement", { bidId: MBB2, tradePackageId: F.mb.p23 }));
    await sleep(400);
    const b1 = await getBid(c, MB, MBB1); const b2 = await getBid(c, MB, MBB2);
    const inv = await creditInvariants(c, MB);
    record("A36-MB03", "op31 award switch to B2 (497,000): B2 awarded; B1 credit row untouched",
      r.ok && b2.isAwarded === true && b1.leveledTotalCost === 441500 && inv.clean && inv.acceptedCredits[0].bidId === MBB1,
      { b1: b1.leveledTotalCost, b2: b2.leveledTotalCost, b2Awarded: b2.isAwarded });
  }
  {
    const r = await call("mb.reverse.vfd", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: MB, clashId: CLASH_VFD, tradePackageId: F.mb.p23 }));
    await sleep(400);
    const b1 = await getBid(c, MB, MBB1); const b2 = await getBid(c, MB, MBB2);
    const inv = await creditInvariants(c, MB);
    record("A36-MB04", "op32 reverse after award switch: credit removed from its real carrier B1 (480,000), awarded B2 untouched (497,000)",
      r.ok && r.value.reversedAmount === 38500 && b1.leveledTotalCost === 480000 && b2.leveledTotalCost === 497000 && inv.clean && inv.actualTotal === 0,
      { reversed: r.value, b1: b1.leveledTotalCost, b2: b2.leveledTotalCost });
  }
  {
    const r = await call("mb.rededuct.vfd", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: MB, clashId: CLASH_VFD, tradePackageId: F.mb.p23, deductAmount: 38500, description: VFD_TITLE }));
    await sleep(500);
    const b1 = await getBid(c, MB, MBB1); const b2 = await getBid(c, MB, MBB2);
    const agrs = await c.query("agreements:listAgreements", { projectId: MB });
    const agr2 = agrs.find((a) => a.bidId === MBB2 && a.status !== "superseded");
    const inv = await creditInvariants(c, MB);
    record("A36-MB05", "op33 re-deduct targets the awarded B2: 458,500; agreement contractSum re-synced; B1 stays 480,000",
      r.ok && b2.leveledTotalCost === 458500 && b1.leveledTotalCost === 480000 && agr2?.contractSum === 458500 && inv.clean,
      { b1: b1.leveledTotalCost, b2: b2.leveledTotalCost, agrSum: agr2?.contractSum, carrier: inv.acceptedCredits[0]?.bidId });
  }
  {
    const agrs = await c.query("agreements:listAgreements", { projectId: MB });
    const agr2 = agrs.find((a) => a.bidId === MBB2 && a.status !== "superseded");
    await call("mb.execute.B2", () => c.mutation("agreements:executeAgreement", { agreementId: agr2._id }));
    await sleep(500);
    const before = await getBid(c, MB, MBB2);
    const r = await call("mb.reverse.executed", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: MB, clashId: CLASH_VFD, tradePackageId: F.mb.p23 }));
    await sleep(400);
    const after = await getBid(c, MB, MBB2); const inv = await creditInvariants(c, MB);
    record("A36-MB06", "op34 execute B2 then reverse: refused by executed immutability, full rollback (bid 458,500, row intact, card deducted)",
      !r.ok && /immutable/i.test(String(r.data ?? r.message)) && after.leveledTotalCost === before.leveledTotalCost && inv.clean &&
        cardOf(inv, CLASH_VFD).status === "deducted",
      { refusal: r.data ?? r.message, leveled: after.leveledTotalCost });
  }
  {
    const agrs = await c.query("agreements:listAgreements", { projectId: MB });
    const agr2 = agrs.find((a) => a.bidId === MBB2 && a.status !== "superseded");
    await call("mb.void.B2", () => c.mutation("agreements:voidExecutedAgreement", { agreementId: agr2._id, reason: "QA36 fuzz award-switch cycle." }));
    await sleep(400);
    const r = await call("mb.reverse.afterVoid", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: MB, clashId: CLASH_VFD, tradePackageId: F.mb.p23 }));
    await sleep(400);
    const b2 = await getBid(c, MB, MBB2); const inv = await creditInvariants(c, MB);
    record("A36-MB07", "op35 void executed B2 then reverse: B2 restored to 497,000, row removed, clean",
      r.ok && r.value.reversedAmount === 38500 && b2.leveledTotalCost === 497000 && inv.clean && inv.actualTotal === 0,
      { reversed: r.value, leveled: b2.leveledTotalCost });
  }

  // ------------------------------------------------- SM API probes (explicit, valid-argument misuse)
  {
    await call("sm.probe.deduct", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: SM, clashId: CLASH_VFD, tradePackageId: F.sm.p23, deductAmount: 38500, description: VFD_TITLE }));
    const b1 = await getBid(c, SM, SMB);
    const r = await call("sm.probe.wrongPackageReverse", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: SM, clashId: CLASH_VFD, tradePackageId: F.sm.p26 }));
    await sleep(400);
    const b2 = await getBid(c, SM, SMB); const inv = await creditInvariants(c, SM);
    const vfd = cardOf(inv, CLASH_VFD);
    const reproduced = r.ok === true && r.value?.success === true && b2.leveledTotalCost === 441500 &&
      inv.actualTotal === 38500 && inv.claimsTotal === 0 && inv.orphanCredit.length === 1 && inv.overclaim.length === 0;
    record("A36-P01", "probe: reverse called with the sibling package id returns success 'Stale credit record cleared' while the credit stays accepted on the HVAC bid; card/KPI drop to $0 vs $38,500 real (reproduces cross-package phantom clear)",
      reproduced,
      { reverse: r.value ?? { data: r.data, message: r.message }, leveled: b2.leveledTotalCost, summary: inv.summary, card: { st: vfd.status, amt: vfd.deductedAmount, stale: vfd.staleResolution ?? false }, orphan: inv.orphanCredit.map((o) => ({ id: o.clashId, a: o.amount })) });
    if (reproduced) {
      finding("A36-01", "Medium", "reverseDoubleBuyCredit treats 'no credit in the caller-supplied package' as stale: a valid sibling package id silently deletes a live clash resolution and its audit claims no proposal carried the credit, while the accepted [clashId] credit remains deducted on the bid. Card flips to detected and KPI drops to $0 against $38,500 of real money until a re-deduct happens to replace the orphan row.", {
        projectId: SM, reverseResult: r.value, bidAfter: b2.leveledTotalCost, card: { status: vfd.status, amount: vfd.deductedAmount, stale: vfd.staleResolution ?? false }, kpi: { claims: inv.claimsTotal, actual: inv.actualTotal }, orphan: inv.orphanCredit,
      });
    }
    // recovery: re-deduct replaces the orphan (replace filter by clash id) so money is not double-stacked
    const r2 = await call("sm.probe.rededuct", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: SM, clashId: CLASH_VFD, tradePackageId: F.sm.p23, deductAmount: 38500, description: VFD_TITLE }));
    await sleep(400);
    const b3 = await getBid(c, SM, SMB); const inv3 = await creditInvariants(c, SM);
    record("A36-P02", "probe recovery: re-deduct after the phantom clear replaces the orphan row instead of stacking (bid stays 441,500; KPI returns to 38,500)",
      r2.ok && b3.leveledTotalCost === 441500 && inv3.clean && inv3.actualTotal === 38500,
      { leveled: b3.leveledTotalCost, summary: inv3.summary });
  }
  {
    // amount-drift probe on the live VFD credit
    const b0 = await getBid(c, SM, SMB);
    const alt = b0.valueEngineeringAlternates.map((v) => (String(v.description).startsWith("Cross-Trade Clash Credit") ? { ...v, costDeduct: 5000 } : v));
    const r = await call("sm.probe.amountEdit", () => setAlternates(SMB, alt));
    await sleep(400);
    const b1 = await getBid(c, SM, SMB); const inv = await creditInvariants(c, SM);
    const vfd = cardOf(inv, CLASH_VFD);
    const reproduced = r.ok && b1.leveledTotalCost === 475000 && inv.actualTotal === 5000 && inv.claimsTotal === 38500 && inv.mismatchRow.length === 1 && vfd.deductedAmount === 38500;
    record("A36-P03", "probe: public leveling save can shrink the accepted marker row to 5,000; card/KPI still claim 38,500 (overlay trusts resolution.amount, not the accepted row)",
      reproduced,
      { leveled: b1.leveledTotalCost, summary: inv.summary, mismatch: inv.mismatchRow });
    if (reproduced) {
      finding("A36-02", "Low", "Deducted-card amount comes from the persisted resolution, not from the accepted [clashId] row: a public bids:updateBidLeveling/updateBidAdjustments save that changes the row amount (UI cannot edit existing rows; API can) leaves the card/Voice KPI claiming the old amount while the bid only carries the new one.", {
        projectId: SM, bidAfter: b1.leveledTotalCost, cardAmount: vfd.deductedAmount, rowAmount: inv.actualTotal,
      });
    }
    // restore
    const b2 = await getBid(c, SM, SMB);
    const restored = b2.valueEngineeringAlternates.map((v) => (String(v.description).startsWith("Cross-Trade Clash Credit") ? { ...v, costDeduct: 38500 } : v));
    await call("sm.probe.restore", () => setAlternates(SMB, restored));
    const b3 = await getBid(c, SM, SMB); const inv3 = await creditInvariants(c, SM);
    record("A36-P04", "probe restored: amount back to 38,500, bid 441,500, invariants clean",
      b3.leveledTotalCost === 441500 && inv3.clean,
      { leveled: b3.leveledTotalCost, summary: inv3.summary });
  }

  // ------------------------------------------------- legacy-format compatibility (pre-FIX-NEW-75 rows)
  {
    const b0 = await getBid(c, SM, SMB);
    const legacyDesc = `Cross-Trade Clash Credit: Deduct redundant ${VFD_TITLE}`;
    const alt = b0.valueEngineeringAlternates.map((v) => (String(v.description).startsWith("Cross-Trade Clash Credit") ? { ...v, description: legacyDesc } : v));
    const r = await call("sm.probe.legacyRewrite", () => setAlternates(SMB, alt));
    await sleep(300);
    const b1 = await getBid(c, SM, SMB); const inv1 = await creditInvariants(c, SM);
    const vfd1 = cardOf(inv1, CLASH_VFD);
    record("A36-P05", "legacy row (old prefix + matching resolution note) is still recognized: card stays deducted 38,500, KPI == actual, invariants clean",
      r.ok && b1.leveledTotalCost === 441500 && inv1.clean && vfd1.status === "deducted" && vfd1.deductedAmount === 38500 &&
        inv1.actualTotal === 38500 && inv1.allCredits[0]?.legacy === true,
      { leveled: b1.leveledTotalCost, legacy: inv1.allCredits[0]?.legacy, card: { st: vfd1.status, amt: vfd1.deductedAmount }, summary: inv1.summary });
    const r2 = await call("sm.probe.legacyReverse", () => c.mutation("coordination:reverseDoubleBuyCredit", { projectId: SM, clashId: CLASH_VFD, tradePackageId: F.sm.p23 }));
    await sleep(300);
    const b2 = await getBid(c, SM, SMB); const inv2 = await creditInvariants(c, SM);
    record("A36-P06", "legacy row reverses fully: reversedAmount 38,500, bid exactly 480,000, zero rows, both detected",
      r2.ok && r2.value.reversedAmount === 38500 && b2.leveledTotalCost === 480000 && inv2.clean && inv2.actualTotal === 0,
      { reversed: r2.value, leveled: b2.leveledTotalCost, summary: inv2.summary });
  }

  const fails = results.filter((r) => !r.pass);
  writeEvidence("fuzz", {
    results,
    findings,
    summary: { pass: results.length - fails.length, total: results.length, findings: findings.length },
  });
  writeLog("fuzz", log);
  console.log(`fuzz: ${results.length - fails.length}/${results.length} pass, findings=${findings.length}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("fuzz-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});