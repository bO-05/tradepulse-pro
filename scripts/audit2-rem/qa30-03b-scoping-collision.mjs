/**
 * QA30-03b scoping refusals + the deduct description-filter collision:
 *  1) foreign package / foreign bid / ghost bid are refused (messages may be server-masked).
 *  2) an accepted manual alternate whose description CONTAINS the clash title is silently
 *     deleted by deductDoubleBuyCredit's description filter, losing its credit value.
 */
import { client, readEvidence, writeEvidence, writeLog, call } from "./qa30-lib.mjs";

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
const bidById = async (pkgId, bidId) => (await c.query("bids:listByPackage", { tradePackageId: pkgId })).find((b) => b._id === bidId);

async function main() {
  // ---------- 1) scoping ----------
  const foreignPkg = await call("foreign-pkg", () => c.mutation("coordination:deductDoubleBuyCredit", {
    projectId: F.base.id, clashId: "clash-disconnect-02", tradePackageId: F.nobid.p03, deductAmount: 100, description: "Foreign package probe",
  }));
  const foreignBid = await call("foreign-bid", () => c.mutation("coordination:deductDoubleBuyCredit", {
    projectId: F.base.id, clashId: "clash-disconnect-02", tradePackageId: F.base.p23, deductAmount: 100, description: "Foreign bid probe", bidId: F.man.b26.bidId,
  }));
  const ghostBid = await call("ghost-bid", () => c.mutation("coordination:deductDoubleBuyCredit", {
    projectId: F.base.id, clashId: "clash-disconnect-02", tradePackageId: F.base.p23, deductAmount: 100, description: "Ghost bid probe", bidId: "j0000000000000000000000000000000",
  }));
  const dAfter = await detect(F.base.id);
  record("A30-03b.1", "scoping refusals: foreign package, foreign bid and ghost bid are all refused; disconnect card still detected",
    !foreignPkg.ok && !foreignBid.ok && !ghostBid.ok &&
      card(dAfter, "clash-disconnect-02")?.status === "detected" && card(dAfter, "clash-disconnect-02")?.redundantAmount === 12000,
    { foreignPkg: foreignPkg.data ?? foreignPkg.message, foreignBid: foreignBid.data ?? foreignBid.message, ghostBid: ghostBid.data ?? ghostBid.message });

  // ---------- 2) description-filter collision ----------
  const BEFORE_DESC = "Rooftop Mechanical Equipment Disconnect Switches — negotiated factory credit";
  const upd = await c.mutation("bids:updateBidAdjustments", {
    bidId: F.base.b23.bidId,
    identifiedExclusions: [],
    valueEngineeringAlternates: [
      { description: "Cross-Trade Clash Credit: Deduct redundant Variable Frequency Drives (VFDs) for AHUs & Pumps", costDeduct: 38500, isAccepted: true },
      { description: BEFORE_DESC, costDeduct: 500, isAccepted: true },
    ],
    leadTimePenalty: 0,
    coiPenalty: 0,
  });
  const dPre = await detect(F.base.id);
  const discPre = card(dPre, "clash-disconnect-02");
  const ded = await call("collision-deduct", () => c.mutation("coordination:deductDoubleBuyCredit", {
    projectId: F.base.id, clashId: "clash-disconnect-02", tradePackageId: F.base.p23, deductAmount: 11500,
    description: "Rooftop Mechanical Equipment Disconnect Switches",
  }));
  const bAfter = await bidById(F.base.p23, F.base.b23.bidId);
  const veAfter = bAfter?.valueEngineeringAlternates || [];
  const manualSurvived = veAfter.some((v) => v.description === BEFORE_DESC);
  const collisionSurvived = veAfter.some((v) => /Cross-Trade Clash Credit: Deduct redundant Rooftop Mechanical/.test(v.description));
  record("A30-03b.2", "collision: the accepted $500 manual alternate containing the clash title is silently removed by the deduct filter; retry amount/leveled math excludes it",
    discPre?.redundantAmount === 11500 && ded.ok &&
      !manualSurvived && collisionSurvived && bAfter?.leveledTotalCost === 430000 &&
      upd.leveledTotalCost === 441000,
    {
      manualBefore: BEFORE_DESC, redundantBefore: discPre?.redundantAmount, leveledBefore: upd.leveledTotalCost,
      result: ded.value ?? ded.data, manualSurvived, veAfter: veAfter.map((v) => ({ d: v.description.slice(0, 70), amt: v.costDeduct })),
      leveledAfter: bAfter?.leveledTotalCost, note: "with the manual alternate preserved the leveled total would be $429,500; the filter deletes it and leaves $430,000",
    });
  const dFinal = await detect(F.base.id);
  record("A30-03b.3", "collision overlay: card reports the persisted $11,500 credit while total accepted VE is $50,000 (manual $500 gone)",
    card(dFinal, "clash-disconnect-02")?.deductedAmount === 11500 &&
      (bAfter?.valueEngineeringAlternates || []).filter((v) => v.isAccepted).reduce((s, v) => s + v.costDeduct, 0) === 50000,
    { card: card(dFinal, "clash-disconnect-02")?.deductedAmount, acceptedVeTotal: (bAfter?.valueEngineeringAlternates || []).filter((v) => v.isAccepted).reduce((s, v) => s + v.costDeduct, 0) });

  // ---------- 3) zero-cost scope-void assignment (symmetry probe, no UI path) ----------
  const zeroAssign = await call("zero-assign", () => c.mutation("coordination:assignScopeVoidToTrade", {
    projectId: F.base.id, voidId: "void-smoke-detectors-02", tradePackageId: F.base.p26, additionalCost: 0,
    description: "Duct Smoke Detector Installation & FACP Tie-In",
  }));
  const b26 = await bidById(F.base.p26, F.base.b26.bidId);
  const dZero = await detect(F.base.id);
  record("A30-03b.4", "zero-cost assign is still accepted (marks void assigned with $0, no bid cost) unlike zero-value deduct which round-12 now refuses",
    zeroAssign.ok === true && b26?.baseBidAmount === 828000 &&
      dZero.scopeVoids.find((v) => v.id === "void-smoke-detectors-02")?.status === "assigned",
    { result: zeroAssign.value ?? zeroAssign.data, base: b26?.baseBidAmount, note: "UI always sends the estimated void cost; direct mutation only" });

  writeEvidence("scoping-collision", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
  writeLog("scoping-collision", log);
  console.log(`scoping-collision: ${results.filter((r) => r.pass).length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeEvidence("scoping-collision", { results: [...results, { id: "A30-03b.ERR", pass: false, name: "aborted", detail: String(e?.stack ?? e) }] });
  writeLog("scoping-collision", [...log, String(e?.stack ?? e)]);
  process.exit(1);
});