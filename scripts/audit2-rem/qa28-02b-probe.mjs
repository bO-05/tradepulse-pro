/**
 * QA28-02b focused probes:
 *  1) corrected scan reconciliation (open-card totals only)
 *  2) root-cause of the CRED BAS-void hidden state (mandatoryInclusions substring "bas")
 *  3) OVER audit row text vs persisted leveled cost (oversized credit)
 *  4) exact refusal surface for scoping guards (readable vs generic Server Error)
 */
import { client, readEvidence, writeEvidence, writeLog, call } from "./qa28-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1600)}`);
};

async function main() {
  // 1) CRED: derives open-only totals exactly as the scan does
  const detect = await c.query("coordination:detectCrossTradeClashes", { projectId: F.cred.id });
  const openBuys = detect.doubleBuys.filter((d) => d.status === "detected");
  const openVoids = detect.scopeVoids.filter((v) => v.status === "open");
  const scan = await c.action("coordination:scanCrossTradeClashes", { projectId: F.cred.id });
  const buyTotal = openBuys.reduce((s, d) => s + d.redundantAmount, 0);
  const voidTotal = openVoids.reduce((s, v) => s + v.estimatedVoidCost, 0);
  record("A28-02b.1", "scan message reconciles exactly with the OPEN cards (0 double-buys already deducted; 1 open void $18,500; BAS card already claimed 'assigned' by detector)",
    scan.analyzed === true && scan.message === `Cross-trade scan complete: ${openBuys.length} double-buy item(s) worth $${buyTotal.toLocaleString()} and ${openVoids.length} open scope void(s) worth $${voidTotal.toLocaleString()}.`,
    { message: scan.message, buys: detect.doubleBuys.map((d) => ({ id: d.id, status: d.status, deductedAmount: d.deductedAmount ?? null })), voids: detect.scopeVoids.map((v) => ({ id: v.id, status: v.status, assignedTo: v.assignedToTradeName ?? null, cost: v.estimatedVoidCost })) });

  // 2) root cause: CRED p26 mandatory inclusion wording contains "bas" inside "baseline"
  const credPkgs = (await c.query("tradePackages:listByProject", { projectId: F.cred.id })) || [];
  const p26 = credPkgs.find((p) => p.csiDivision.startsWith("26"));
  const p23 = credPkgs.find((p) => p.csiDivision.startsWith("23"));
  const basVoid = detect.scopeVoids.find((v) => v.id === "void-bas-wiring-01");
  record("A28-02b.2", "root cause: mandatory inclusion text containing the substring 'bas' (e.g. 'baseline') marks the critical BAS control-wiring void as assigned/covered",
    (p26?.mandatoryInclusions || []).some((i) => i.toLowerCase().includes("bas")) &&
      basVoid?.status === "assigned" && /26/.test(basVoid?.assignedToDivision || ""),
    { inclusion: p26?.mandatoryInclusions, void: basVoid ? { status: basVoid.status, assignedToDivision: basVoid.assignedToDivision, assignedToTradeName: basVoid.assignedToTradeName, estimatedVoidCost: basVoid.estimatedVoidCost } : null, hvacInclusions: p23?.mandatoryInclusions });

  // 3) OVER audit row vs persisted cost
  const overLogs = (await c.query("auditLogs:listRecentLogs", { projectId: F.over.id, limit: 300 })) || [];
  const overRow = overLogs.find((l) => /Double-Buy Credit Deducted/.test(l.title));
  const overBids = (await c.query("bids:listByPackage", { tradePackageId: F.over.p23 })) || [];
  const overBid = overBids.find((b) => /OVER Mechanical/.test(b.subcontractorName));
  record("A28-02b.3", "OVER audit row says the normalized leveled cost was updated to -$500,000 while the persisted bid is $0 (oversized credit)",
    Boolean(overRow) && /\$-?500,000|\$-500,000|-\$500,000/.test(overRow.description) && overBid?.leveledTotalCost === 0,
    { audit: overRow ? { title: overRow.title, description: overRow.description } : null, persistedLeveled: overBid?.leveledTotalCost, base: overBid?.baseBidAmount, ve: (overBid?.valueEngineeringAlternates || []).map((v) => v.costDeduct) });

  // 4) refusal surface for the three scoping guards (message vs generic Server Error)
  const crossPkg = await call("foreign package", () =>
    c.mutation("coordination:deductDoubleBuyCredit", { projectId: F.cred.id, clashId: "clash-vfd-01", tradePackageId: F.zero.p23, deductAmount: 100, description: "probe" }));
  const crossBid = await call("foreign bid", () =>
    c.mutation("coordination:deductDoubleBuyCredit", { projectId: F.cred.id, clashId: "clash-vfd-01", tradePackageId: F.cred.p23, bidId: F.award.bids.a.bidId, deductAmount: 100, description: "probe" }));
  record("A28-02b.4", "scoping refusals are thrown as plain Errors, so callers/UI see an opaque '[Request ID] Server Error' instead of the specific guard text",
    crossPkg.ok === false && crossPkg.message.includes("Server Error") && crossPkg.data == null &&
      crossBid.ok === false && crossBid.message.includes("Server Error") && crossBid.data == null,
    { crossPkg: { message: crossPkg.message, data: crossPkg.data }, crossBid: { message: crossBid.message, data: crossBid.data } });

  writeEvidence("probe", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
  writeLog("probe", log);
  console.log(`probe: ${results.filter((r) => r.pass).length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("probe-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});