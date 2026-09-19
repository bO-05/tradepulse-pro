/**
 * QA32-03 scope-void assignment symmetry + idempotency (backend).
 *  - assign BAS void to Div26, smoke void to Div23: exact bid base/level/inclusion/audit reconciliation
 *  - duplicate assign refused (same cost and different cost): no stacked line items, no new audit rows
 *  - cross-package duplicate assign refused: second package untouched
 *  - package deletion after assignment: no phantom card (detect honestly empties)
 *  - source scan: no public void-reversal API exists (documented asymmetry vs the credit path)
 */
import fs from "node:fs";
import path from "node:path";
import { client, readEvidence, writeEvidence, writeLog, call } from "./qa32-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1800)}`);
};
const F = readEvidence("fixtures");
const REPO = "D:/Repo/ALL HACKATHONS/Convex/Convex all gas";

const detect = (projectId) => c.query("coordination:detectCrossTradeClashes", { projectId });
const voidCard = (d, id) => d.scopeVoids.find((x) => x.id === id);
const bidById = async (pkgId, bidId) => (await c.query("bids:listByPackage", { tradePackageId: pkgId })).find((b) => b._id === bidId);
const assignRows = async (p) => (await c.query("auditLogs:listRecentLogs", { projectId: p, limit: 400 })).filter((l) => /Scope Void Assigned/.test(l.title));

async function main() {
  const { id, p26, p23, b26, b23 } = F.void;

  const asg26 = await call("void-assign-bas", () => c.mutation("coordination:assignScopeVoidToTrade", {
    projectId: id, voidId: "void-bas-wiring-01", tradePackageId: p26, additionalCost: 28000, description: "Low-Voltage 24V BAS Control & Interlock Wiring",
  }));
  const b26a = await bidById(p26, b26.bidId);
  const p26a = (await c.query("tradePackages:listByProject", { projectId: id })).find((p) => p._id === p26);
  const d1 = await detect(id);
  record("A32-VOID.1", "assign BAS void to Div26: base 800,000 -> 828,000, exactly one Assigned Scope Void line item, inclusion present, card assigned, one audit row",
    asg26.ok && b26a?.baseBidAmount === 828000 && b26a?.leveledTotalCost === 828000 &&
      (b26a?.lineItems || []).filter((i) => /Assigned Scope Void:/.test(i.item)).length === 1 &&
      (b26a?.lineItems || []).find((i) => /Assigned Scope Void:/.test(i.item))?.totalCost === 28000 &&
      (p26a?.mandatoryInclusions || []).filter((i) => /BAS Control/.test(i)).length === 1 &&
      voidCard(d1, "void-bas-wiring-01")?.status === "assigned" && voidCard(d1, "void-bas-wiring-01")?.assignedToDivision === "26 00 00" &&
      (await assignRows(id)).length === 1,
    { result: asg26.value ?? asg26.data, base: b26a?.baseBidAmount, items: (b26a?.lineItems || []).map((i) => i.item), incl: p26a?.mandatoryInclusions, card: voidCard(d1, "void-bas-wiring-01") });

  const dupeSame = await call("void-dupe-same", () => c.mutation("coordination:assignScopeVoidToTrade", {
    projectId: id, voidId: "void-bas-wiring-01", tradePackageId: p26, additionalCost: 28000, description: "Low-Voltage 24V BAS Control & Interlock Wiring",
  }));
  const dupeCross = await call("void-dupe-cross-pkg", () => c.mutation("coordination:assignScopeVoidToTrade", {
    projectId: id, voidId: "void-bas-wiring-01", tradePackageId: p23, additionalCost: 28000, description: "Low-Voltage 24V BAS Control & Interlock Wiring",
  }));
  const b26b = await bidById(p26, b26.bidId);
  const b23a = await bidById(p23, b23.bidId);
  const p23a = (await c.query("tradePackages:listByProject", { projectId: id })).find((p) => p._id === p23);
  record("A32-VOID.2", "duplicate assign refused on the same and on the other package; bases, line items, inclusions and audit rows unchanged (single assignment persisted)",
    !dupeSame.ok && /already been assigned/.test(dupeSame.data || "") &&
      !dupeCross.ok && /already been assigned/.test(dupeCross.data || "") &&
      b26b?.baseBidAmount === 828000 && (b26b?.lineItems || []).filter((i) => /Assigned Scope Void:/.test(i.item)).length === 1 &&
      b23a?.baseBidAmount === 480000 && (b23a?.lineItems || []).filter((i) => /Assigned Scope Void:/.test(i.item)).length === 0 &&
      (p23a?.mandatoryInclusions || []).every((i) => !/BAS Control/.test(i)) &&
      (await assignRows(id)).length === 1,
    { dupeSame: dupeSame.data, dupeCross: dupeCross.data, b26: b26b?.baseBidAmount, b23: b23a?.baseBidAmount, incl23: p23a?.mandatoryInclusions });

  const asg23 = await call("void-assign-smoke", () => c.mutation("coordination:assignScopeVoidToTrade", {
    projectId: id, voidId: "void-smoke-detectors-02", tradePackageId: p23, additionalCost: 18500, description: "Duct Smoke Detector Installation & FACP Tie-In",
  }));
  const b23b = await bidById(p23, b23.bidId);
  const p23b = (await c.query("tradePackages:listByProject", { projectId: id })).find((p) => p._id === p23);
  const d2 = await detect(id);
  record("A32-VOID.3", "assign smoke void to Div23: 480,000 -> 498,500, one line item, inclusion, card assigned; both void cards assigned and KPI exposure reconciles to 0",
    asg23.ok && b23b?.baseBidAmount === 498500 && b23b?.leveledTotalCost === 498500 &&
      (b23b?.lineItems || []).filter((i) => /Assigned Scope Void:/.test(i.item)).length === 1 &&
      (p23b?.mandatoryInclusions || []).some((i) => /Smoke Detector/.test(i)) &&
      voidCard(d2, "void-bas-wiring-01")?.status === "assigned" && voidCard(d2, "void-smoke-detectors-02")?.status === "assigned" &&
      d2.summary.totalScopeVoidExposure === 0 && d2.summary.activeClashesCount === 2 && (await assignRows(id)).length === 2,
    { result: asg23.value ?? asg23.data, base: b23b?.baseBidAmount, card: voidCard(d2, "void-smoke-detectors-02"), summary: d2.summary });

  const srcFiles = fs.readdirSync(path.join(REPO, "convex")).filter((f) => f.endsWith(".ts") && !/\.test\.|_generated/.test(f));
  const reversalHits = [];
  for (const f of srcFiles) {
    const text = fs.readFileSync(path.join(REPO, "convex", f), "utf8");
    for (const m of text.matchAll(/export const (\w*(reverse|unassign|remove)\w*)/gi)) reversalHits.push(`convex/${f}:${m[1]}`);
  }
  record("A32-VOID.4", "symmetry scan: the only reversal API is the double-buy credit one; no scope-void reversal/unassign export exists (mandatoryInclusions are immutable after creation, so the assigned card cannot go stale through public mutations)",
    reversalHits.some((h) => /reverseDoubleBuyCredit/.test(h)) && !reversalHits.some((h) => /void/i.test(h)),
    { reversalExports: reversalHits });

  // package deletion after assignment: detect must not keep a phantom assigned card
  const b23del = (await c.query("bids:listByPackage", { tradePackageId: p23 })).find((b) => b._id === b23.bidId);
  const del = await call("void-delete-hvac", () => c.mutation("tradePackages:deleteTradePackage", { tradePackageId: p23 }));
  const d3 = await detect(id);
  record("A32-VOID.5", "deleting the assigned HVAC package cascades cleanly: detect returns an honest empty state (no assigned card without backing scope)",
    del.ok && d3.scopeVoids.length === 0 && d3.doubleBuys.length === 0 && d3.summary.activeClashesCount === 0,
    { delete: del.ok, after: { voids: d3.scopeVoids.length, buys: d3.doubleBuys.length, summary: d3.summary }, deletedBidBase: b23del?.baseBidAmount });

  writeEvidence("void-symmetry", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
  writeLog("void-symmetry", log);
  console.log(`void-symmetry: ${results.filter((r) => r.pass).length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeEvidence("void-symmetry", { results: [...results, { id: "A32-03.ERR", pass: false, name: "aborted", detail: String(e?.stack ?? e) }] });
  writeLog("void-symmetry", [...log, String(e?.stack ?? e)]);
  process.exit(1);
});