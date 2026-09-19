/**
 * QA30-02 clash detection truth matrix (read-only on fixtures):
 *  BASE  - clean pair: 2 detected buys / 2 open voids with exact amounts, scan banner reconciles.
 *  TRAP  - substring traps ("Base building", "Smoke evacuation", "Low voltage cabling") must NOT assign voids.
 *  ALIAS - true aliases ("BAS control wiring", "BMS", "Duct smoke detector", "FACP") must assign both voids to Div26.
 *  MAN   - accepted manual VEs: VFD $1,000 reduces VFD redundancy to $37,500 (truthful);
 *          "Switchgear ... credit" $5,000/$20,000 matches /Switch/ and suppresses the disconnect double-buy
 *          although no disconnect scope is covered (alias collision probe).
 */
import { client, fixtureTitle, readEvidence, writeEvidence, writeLog } from "./qa30-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1600)}`);
};
const F = readEvidence("fixtures");

const detect = (projectId) => c.query("coordination:detectCrossTradeClashes", { projectId });
const card = (d, id) => d.doubleBuys.find((x) => x.id === id);
const voidCard = (d, id) => d.scopeVoids.find((x) => x.id === id);

async function main() {
  // ---------- BASE: clean truth ----------
  {
    const d = await detect(F.base.id);
    const vfd = card(d, "clash-vfd-01");
    const disc = card(d, "clash-disconnect-02");
    const bas = voidCard(d, "void-bas-wiring-01");
    const smoke = voidCard(d, "void-smoke-detectors-02");
    record("A30-02.1", "BASE clean pair: VFD $38,500 + disconnect $12,000 detected; BAS $28,000 + smoke $18,500 open",
      vfd?.status === "detected" && vfd?.redundantAmount === 38500 &&
        disc?.status === "detected" && disc?.redundantAmount === 12000 &&
        bas?.status === "open" && bas?.estimatedVoidCost === 28000 &&
        smoke?.status === "open" && smoke?.estimatedVoidCost === 18500 &&
        d.summary.totalDoubleBuyExposure === 50500 && d.summary.totalScopeVoidExposure === 46500 &&
        d.summary.activeClashesCount === 4,
      { vfd: { s: vfd?.status, amt: vfd?.redundantAmount }, disc: { s: disc?.status, amt: disc?.redundantAmount }, bas: { s: bas?.status }, smoke: { s: smoke?.status }, summary: d.summary });

    const scan = await c.action("coordination:scanCrossTradeClashes", { projectId: F.base.id });
    const expected = "Cross-trade scan complete: 2 double-buy item(s) worth $50,500 and 2 open scope void(s) worth $46,500.";
    record("A30-02.2", "BASE scan banner reconciles with computed cards (2 buys $50,500 / 2 voids $46,500)",
      scan?.analyzed === true && scan?.message === expected,
      { message: scan?.message, expected });
  }

  // ---------- TRAP: substring false positives ----------
  {
    const d = await detect(F.trap.id);
    const bas = voidCard(d, "void-bas-wiring-01");
    const smoke = voidCard(d, "void-smoke-detectors-02");
    const pkgs = await c.query("tradePackages:listByProject", { projectId: F.trap.id });
    const p26 = pkgs.find((p) => p._id === F.trap.p26);
    const p23 = pkgs.find((p) => p._id === F.trap.p23);
    record("A30-02.3", "TRAP: 'Base building', 'Smoke evacuation', 'Low voltage cabling' inclusions do NOT assign voids (BAS word-boundary + smoke/detector + control-wiring regexes)",
      bas?.status === "open" && smoke?.status === "open" &&
        p26?.mandatoryInclusions?.[0] === "Base building general conditions allowance" &&
        p23?.mandatoryInclusions?.length === 2,
      { bas: { s: bas?.status, at: bas?.assignedToDivision ?? null }, smoke: { s: smoke?.status, at: smoke?.assignedToDivision ?? null }, p26inclusions: p26?.mandatoryInclusions, p23inclusions: p23?.mandatoryInclusions });
  }

  // ---------- ALIAS: true alias assignments ----------
  {
    const d = await detect(F.alias.id);
    const bas = voidCard(d, "void-bas-wiring-01");
    const smoke = voidCard(d, "void-smoke-detectors-02");
    record("A30-02.4", "ALIAS: 'BAS control wiring and BMS integration' + 'Duct smoke detector ... FACP tie-in' assign both voids to the Div26 package holding them",
      bas?.status === "assigned" && bas?.assignedToDivision === "26 00 00" &&
        smoke?.status === "assigned" && smoke?.assignedToDivision === "26 00 00" &&
        d.summary.totalScopeVoidExposure === 0 && d.summary.activeClashesCount === 2,
      { bas: { s: bas?.status, div: bas?.assignedToDivision, trade: bas?.assignedToTradeName }, smoke: { s: smoke?.status, div: smoke?.assignedToDivision }, summary: d.summary });
  }

  // ---------- MAN: manual coverage truth + /Switch/ alias collision ----------
  {
    const d1 = await detect(F.man.id);
    const vfd1 = card(d1, "clash-vfd-01");
    const disc1 = card(d1, "clash-disconnect-02");
    record("A30-02.5", "MAN: accepted VFD $1,000 reduces VFD card to $37,500 and stays 'detected' (no static $38,500 claim)",
      vfd1?.status === "detected" && vfd1?.redundantAmount === 37500 && !vfd1?.deductedAmount,
      { vfd: { s: vfd1?.status, amt: vfd1?.redundantAmount } });

    const discCollision = disc1?.redundantAmount === 7000;
    record("A30-02.6", "MAN alias collision: unrelated accepted 'Switchgear arc-flash study credit' $5,000 reduces the disconnect double-buy to $7,000 (/Switch/ matches switchgear, not unit disconnects)",
      discCollision,
      { disc: { s: disc1?.status, amt: disc1?.redundantAmount }, note: "expected $12,000 if coverage were scope-accurate; $7,000 means $5,000 of unrelated credit was treated as disconnect coverage" });

    // Escalate the same collision to full suppression.
    await c.mutation("bids:updateBidAdjustments", {
      bidId: F.man.b23.bidId,
      identifiedExclusions: [],
      valueEngineeringAlternates: [
        { description: "Switchgear package value engineering credit (manual entry)", costDeduct: 20000, isAccepted: true },
      ],
      leadTimePenalty: 0,
      coiPenalty: 0,
    });
    const d2 = await detect(F.man.id);
    const disc2 = card(d2, "clash-disconnect-02");
    const vfd2 = card(d2, "clash-vfd-01");
    record("A30-02.7", "MAN escalated: $20,000 'Switchgear ... credit' forces disconnect card to $0 and total double-buy exposure to $37,500 although the disconnect scope is fully uncovered",
      disc2?.status === "detected" && disc2?.redundantAmount === 0 &&
        d2.summary.totalDoubleBuyExposure === 37500,
      { disc: { s: disc2?.status, amt: disc2?.redundantAmount }, vfd: { amt: vfd2?.redundantAmount }, summary: d2.summary });

    // Non-accepted alternate must not count as coverage.
    await c.mutation("bids:updateBidAdjustments", {
      bidId: F.man.b23.bidId,
      identifiedExclusions: [],
      valueEngineeringAlternates: [
        { description: "Switchgear package value engineering credit (manual entry)", costDeduct: 20000, isAccepted: false },
      ],
      leadTimePenalty: 0,
      coiPenalty: 0,
    });
    const d3 = await detect(F.man.id);
    const disc3 = card(d3, "clash-disconnect-02");
    record("A30-02.8", "MAN control: identical $20,000 credit marked NOT accepted does not reduce the disconnect card ($12,000)",
      disc3?.redundantAmount === 12000,
      { disc: { s: disc3?.status, amt: disc3?.redundantAmount } });
  }

  writeEvidence("clash-truth", {
    results,
    summary: { pass: results.filter((r) => r.pass).length, total: results.length },
  });
  writeLog("clash-truth", log);
  console.log(`clash-truth: ${results.filter((r) => r.pass).length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeEvidence("clash-truth", { results: [...results, { id: "A30-02.ERR", pass: false, name: "aborted", detail: String(e?.stack ?? e) }] });
  writeLog("clash-truth", [...log, String(e?.stack ?? e)]);
  process.exit(1);
});