/**
 * QA31-02 backend verification of round-13 fixes:
 *  A31-02.1  A30-02: accepted manual "Switchgear arc-flash package credit" does NOT
 *            reduce the disconnect clash (stays $12,000 detected).
 *  A31-02.2  A30-02 control: a true "disconnect ... credit" alternate still reduces it.
 *  A31-02.3  A30-01: deduct -> un-accept the credit VE -> detect shows detected (no
 *            phantom deducted claim); blind retry is refused by the one-credit guard.
 *  A31-02.4  A30-01: reverseDoubleBuyCredit clears the stale record (verified by the
 *            follow-up refusal) without touching the restored bid.
 *  A31-02.5  A30-L1: a deduct only replaces prior Cross-Trade Clash Credit entries for
 *            the same clash; the unrelated manual alternate containing the clash text
 *            and a prior other-clash credit both survive.
 */
import { client, readEvidence, writeEvidence, writeLog, call } from "./qa31-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1800)}`);
};

const VFD_TITLE = "Variable Frequency Drives (VFDs) for AHUs & Pumps";
const DISC_TITLE = "Rooftop Mechanical Equipment Disconnect Switches";
const detect = (projectId) => c.query("coordination:detectCrossTradeClashes", { projectId });
const card = (d, id) => (d.doubleBuys || []).find((x) => x.id === id);
const bidById = async (pkgId, bidId) => (await c.query("bids:listByPackage", { tradePackageId: pkgId }) || []).find((b) => b._id === bidId);
const credits = (bid) => (bid?.valueEngineeringAlternates || []);

async function main() {
  // ---------------- A30-02: unrelated "switchgear" alias must not offset the disconnect clash ----------------
  {
    const d0 = await detect(F.a302.id);
    const disc = card(d0, "clash-disconnect-02");
    const vfd = card(d0, "clash-vfd-01");
    const b23 = await bidById(F.a302.p23, F.a302.b23.bidId);
    record("A31-02.1", "A30-02: accepted manual 'Switchgear arc-flash package credit' $5,000 leaves the disconnect clash DETECTED at $12,000 (and the VFD card at $38,500)",
      disc?.status === "detected" && disc?.redundantAmount === 12000 &&
        vfd?.status === "detected" && vfd?.redundantAmount === 38500 &&
        credits(b23).length === 1 && credits(b23)[0].costDeduct === 5000 && credits(b23)[0].isAccepted === true,
      { disconnect: disc, vfd: { status: vfd?.status, redundantAmount: vfd?.redundantAmount }, ve: credits(b23) });
  }

  // ---------------- A30-02 control: a real disconnect alternate still offsets ----------------
  {
    const add = await call("a302-add-true-disconnect-ve", () => c.mutation("bids:updateBidAdjustments", {
      bidId: F.a302.b23.bidId,
      identifiedExclusions: [],
      valueEngineeringAlternates: [F.a302.aliasVe, F.a302.trueVe],
      leadTimePenalty: 0,
      coiPenalty: 0,
    }));
    const d1 = await detect(F.a302.id);
    const disc1 = card(d1, "clash-disconnect-02");
    const vfd1 = card(d1, "clash-vfd-01");
    const reset = await call("a302-reset-alias-only", () => c.mutation("bids:updateBidAdjustments", {
      bidId: F.a302.b23.bidId,
      identifiedExclusions: [],
      valueEngineeringAlternates: [F.a302.aliasVe],
      leadTimePenalty: 0,
      coiPenalty: 0,
    }));
    const d2 = await detect(F.a302.id);
    const disc2 = card(d2, "clash-disconnect-02");
    record("A31-02.2", "A30-02 control: a true 'disconnect ... credit' alternate $2,000 reduces the disconnect clash to DETECTED $10,000; resetting to the switchgear alias restores $12,000",
      add.ok && disc1?.status === "detected" && disc1?.redundantAmount === 10000 && vfd1?.redundantAmount === 38500 &&
        reset.ok && disc2?.status === "detected" && disc2?.redundantAmount === 12000,
      { withTrueAlt: { status: disc1?.status, redundantAmount: disc1?.redundantAmount }, reset: { status: disc2?.status, redundantAmount: disc2?.redundantAmount }, add: add.value ?? add.data, resetResult: reset.value ?? reset.data });
  }

  // ---------------- A30-01: deduct -> un-accept -> no phantom ----------------
  let staleState = null;
  {
    const ded = await call("a301-deduct", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.a301.id, clashId: "clash-vfd-01", tradePackageId: F.a301.p23,
      deductAmount: 38500, description: VFD_TITLE,
    }));
    const bAfterDeduct = await bidById(F.a301.p23, F.a301.b23.bidId);
    const dDeduct = await detect(F.a301.id);
    const unaccept = await call("a301-unaccept-credit", () => c.mutation("bids:updateBidAdjustments", {
      bidId: F.a301.b23.bidId,
      identifiedExclusions: [],
      valueEngineeringAlternates: [],
      leadTimePenalty: 0,
      coiPenalty: 0,
    }));
    const bAfterUnaccept = await bidById(F.a301.p23, F.a301.b23.bidId);
    const dStale = await detect(F.a301.id);
    const staleCard = card(dStale, "clash-vfd-01");
    const retry = await call("a301-blind-retry", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.a301.id, clashId: "clash-vfd-01", tradePackageId: F.a301.p23,
      deductAmount: 38500, description: VFD_TITLE,
    }));
    record("A31-02.3", "A30-01: after the accepted credit VE is removed via updateBidAdjustments, detect reports the VFD clash DETECTED with no deductedAmount/phantom and summary exposure back to $50,500; blind re-deduct is refused until reversed",
      ded.ok && ded.value?.newLeveledCost === 441500 &&
        dDeduct.doubleBuys.find((x) => x.id === "clash-vfd-01")?.status === "deducted" &&
        unaccept.ok && bAfterUnaccept?.leveledTotalCost === 480000 && credits(bAfterUnaccept).length === 0 &&
        staleCard?.status === "detected" && staleCard?.deductedAmount === undefined &&
        dStale.summary.totalDoubleBuyExposure === 50500 &&
        !retry.ok && /already been applied/.test(retry.data || ""),
      {
        deduct: ded.value ?? ded.data,
        leveledAfterDeduct: bAfterDeduct?.leveledTotalCost,
        cardAfterDeduct: { status: card(dDeduct, "clash-vfd-01")?.status, deductedAmount: card(dDeduct, "clash-vfd-01")?.deductedAmount },
        leveledAfterUnaccept: bAfterUnaccept?.leveledTotalCost,
        staleCard: { status: staleCard?.status, deductedAmount: staleCard?.deductedAmount, redundantAmount: staleCard?.redundantAmount },
        staleSummary: dStale.summary,
        retry: retry.data,
      });
    staleState = { staleCard, retry };
  }

  // ---------------- A30-01: reverse clears the stale record, fresh deduct then applies ----------------
  {
    const before = await bidById(F.a301.p23, F.a301.b23.bidId);
    const rev = await call("a301-reverse-stale", () => c.mutation("coordination:reverseDoubleBuyCredit", {
      projectId: F.a301.id, clashId: "clash-vfd-01", tradePackageId: F.a301.p23,
    }));
    const afterRev = await bidById(F.a301.p23, F.a301.b23.bidId);
    const dRev = await detect(F.a301.id);
    const revCard = card(dRev, "clash-vfd-01");
    const revAgain = await call("a301-reverse-again", () => c.mutation("coordination:reverseDoubleBuyCredit", {
      projectId: F.a301.id, clashId: "clash-vfd-01", tradePackageId: F.a301.p23,
    }));
    record("A31-02.4", "A30-01: reverseDoubleBuyCredit clears the stale record ('Stale credit record cleared; the proposal no longer carried it.'), leaves the restored $480,000 bid untouched, and a second reverse is refused as having no applied credit",
      rev.ok && rev.value?.success === true && /Stale credit record cleared/.test(rev.value?.note || "") &&
        afterRev?.leveledTotalCost === 480000 && credits(afterRev).length === 0 &&
        revCard?.status === "detected" && revCard?.deductedAmount === undefined &&
        !revAgain.ok && /no applied credit to reverse/.test(revAgain.data || ""),
      { reverse: rev.value ?? rev.data, leveled: afterRev?.leveledTotalCost, ve: credits(afterRev), card: { status: revCard?.status, deductedAmount: revCard?.deductedAmount }, secondReverse: revAgain.data });
  }

  // ---------------- A30-L1: collision-safe replace ----------------
  {
    const d0 = await detect(F.l1.id);
    const vfd0 = card(d0, "clash-vfd-01");
    const ded = await call("l1-deduct", () => c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.l1.id, clashId: "clash-vfd-01", tradePackageId: F.l1.p23,
      deductAmount: 38000, description: VFD_TITLE,
    }));
    const bAfter = await bidById(F.l1.p23, F.l1.b23.bidId);
    const veAfter = credits(bAfter);
    const manualSurvived = veAfter.find((v) => v.description === F.l1.manualVe.description);
    const otherCreditSurvived = veAfter.find((v) => v.description === F.l1.priorOtherCredit.description);
    const vfdCredits = veAfter.filter((v) => v.description.startsWith("Cross-Trade Clash Credit:") && /Variable Frequency Drives/i.test(v.description));
    const dAfter = await detect(F.l1.id);
    const vfdAfter = card(dAfter, "clash-vfd-01");
    record("A31-02.5", "A30-L1: a VFD deduct replaces only prior Cross-Trade Clash Credit entries for the VFD clash; the unrelated manual alternate containing the clash text ($500) and the prior disconnect credit ($1) both survive; card reports $38,000 deducted",
      ded.ok && vfd0?.redundantAmount === 38000 &&
        Boolean(manualSurvived) && manualSurvived.isAccepted === true && manualSurvived.costDeduct === 500 &&
        Boolean(otherCreditSurvived) && otherCreditSurvived.isAccepted === true && otherCreditSurvived.costDeduct === 1 &&
        vfdCredits.length === 1 && vfdCredits[0].costDeduct === 38000 &&
        vfdAfter?.status === "deducted" && vfdAfter?.deductedAmount === 38000 &&
        bAfter?.leveledTotalCost === 441499,
      {
        preCard: { status: vfd0?.status, redundantAmount: vfd0?.redundantAmount },
        deduct: ded.value ?? ded.data,
        veAfter: veAfter.map((v) => ({ description: v.description, costDeduct: v.costDeduct, isAccepted: v.isAccepted })),
        leveled: bAfter?.leveledTotalCost,
        postCard: { status: vfdAfter?.status, deductedAmount: vfdAfter?.deductedAmount, redundantAmount: vfdAfter?.redundantAmount },
      });
  }

  writeEvidence("backend", {
    results,
    projects: { a302: F.a302.id, a301: F.a301.id, l1: F.l1.id },
    summary: { pass: results.filter((r) => r.pass).length, total: results.length },
  });
  writeLog("backend", log);
  console.log(`backend: ${results.filter((r) => r.pass).length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeEvidence("backend", { results: [...results, { id: "A31-02.ERR", pass: false, name: "aborted", detail: String(e?.stack ?? e) }] });
  writeLog("backend", [...log, String(e?.stack ?? e)]);
  process.exit(1);
});