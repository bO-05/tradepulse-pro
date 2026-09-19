/**
 * QA26-08 convergence on the round-10 "credit evidence gate" (A25-01) and the
 * clash-credit / assign idempotency keying (A25-02 / A25-03):
 *  A) multi-package division: target package unpriced, sibling package priced
 *  B) alias clashId stacking on a real bid
 *  C) rotated voidId+description stacking a second scope-void line
 * Fixtures: AUDIT-QA26-MULTI-* created here; GATE fixture reused.
 */
import { client, fixtureTitle, writeEvidence, writeLog, call, sleep } from "./qa26-lib.mjs";
import { readEvidence } from "./qa26-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1400)}`);
};

const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function purgeMulti() {
  for (const p of ((await c.query("projects:listProjects", {})) || []).filter((x) => x.title.startsWith("AUDIT-QA26-MULTI"))) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try { await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA26 multi fixture purge of executed record." }); } catch {}
    }
    try { await c.mutation("projects:deleteProject", { projectId: p._id }); } catch {}
    await sleep(250);
  }
}

async function main() {
  await purgeMulti();
  const deadline = plusDays(20);

  // ---------- build MULTI: Div26-A priced, Div26-B unpriced, Div23 priced ----------
  const projectId = await c.mutation("projects:createProject", {
    title: fixtureTitle("MULTI"), location: "Austin, TX", projectType: "Class-A Commercial Mixed-Use",
    estBudget: 1500000, targetCompletionWeeks: 52,
    specDocumentText: "AUDIT-QA26-MULTI gate convergence fixture.", isDemoProject: false,
    generalContractorName: "QA26 Multi GC",
  });
  const mkPkg = (csi, name, budget) =>
    c.mutation("tradePackages:createTradePackage", {
      projectId, csiDivision: csi, tradeName: name, budgetEstimate: budget,
      scopeSummary: `${name} QA26 multi-package gate fixture.`, mandatoryInclusions: ["Fixture inclusion"],
      bidDeadline: deadline,
    });
  const p26A = await mkPkg("26 00 00", "QA26 Multi Electrical A", 800000);
  const p26B = await mkPkg("26 01 00", "QA26 Multi Electrical B", 300000);
  const p23 = await mkPkg("23 00 00", "QA26 Multi HVAC", 400000);
  const mkCtr = (pkgId, name, email, lic) =>
    c.mutation("contractors:createContractor", {
      tradePackageId: pkgId, companyName: name, contactEmail: email, phone: "+1 (206) 555-0199",
      licenseNumber: lic, licenseStatus: "Active / Verified (QA26)", sourceUrl: "https://qa26.example.invalid/license", rfqStatus: "invited",
    });
  const cA = await mkCtr(p26A, "AUDIT-QA26 Multi Electric A", "estimating@qa26-multi-a.invalid", "TX-QA26-MA");
  const cB = await mkCtr(p26B, "AUDIT-QA26 Multi Electric B", "estimating@qa26-multi-b.invalid", "TX-QA26-MB");
  const c23 = await mkCtr(p23, "AUDIT-QA26 Multi Mechanical", "estimating@qa26-multi-m.invalid", "TX-QA26-MM");
  const mkBid = (pkgId, ctrId, name, base) =>
    c.mutation("bids:submitDirectBid", { tradePackageId: pkgId, contractorId: ctrId, subcontractorName: name, baseBidAmount: base, coiComplianceStatus: "compliant", coiPenalty: 0 });
  const bidA = await mkBid(p26A, cA, "AUDIT-QA26 Multi Electric A", 750000);
  const bid23 = await mkBid(p23, c23, "AUDIT-QA26 Multi Mechanical", 380000);

  const packages = (await c.query("tradePackages:listByProject", { projectId })) || [];
  const first26 = packages.find((p) => p.csiDivision.startsWith("26"));
  const first23 = packages.find((p) => p.csiDivision.startsWith("23"));
  const detect0 = await c.query("coordination:detectCrossTradeClashes", { projectId });

  // target the UNPRICED Div26 B package while the gate sees priced sibling A
  const phantom = await call("deduct on unpriced sibling package", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId,
      clashId: "clash-vfd-01",
      tradePackageId: p26B,
      deductAmount: 38500,
      description: "Variable Frequency Drives (VFDs) for AHUs & Pumps",
    })
  );
  const bidsB = await c.query("bids:listByPackage", { tradePackageId: p26B });
  const logs1 = (await c.query("auditLogs:listRecentLogs", { projectId, limit: 200 })) || [];
  const loggedRow = logs1.find((l) => /Double-Buy Credit Logged/.test(l.title));
  const detectAfterPhantom = await c.query("coordination:detectCrossTradeClashes", { projectId });
  const vfdCard = detectAfterPhantom.doubleBuys.find((x) => x.id === "clash-vfd-01");
  record(
    "A26-08.1",
    "A25-01 convergence: deductible target package has zero bids while the project-scoped gate passes via the priced sibling -- phantom 'credit logged' resolution is written",
    phantom.ok === true && /logged/i.test(phantom.value?.note || "") && bidsB.length === 0 &&
      Boolean(loggedRow) && vfdCard?.status === "deducted",
    {
      gateSees: { first26: first26?.csiDivision, first26Bids: (await c.query("bids:listByPackage", { tradePackageId: first26?._id })).length, first23: first23?.csiDivision, detectBuyCount: detect0.doubleBuys.length },
      phantom: phantom.value ?? phantom,
      targetBids: bidsB.length,
      loggedRow: loggedRow ? { title: loggedRow.title, desc: loggedRow.description.slice(0, 140) } : null,
      cardAfter: vfdCard ? { status: vfdCard.status, deductedAmount: vfdCard.deductedAmount } : null,
    }
  );

  // late bid arrives on the target package: phantom credit is never applied, retry refused
  const lateBid = await mkBid(p26B, cB, "AUDIT-QA26 Multi Electric B", 290000);
  const retry = await call("retry deduct after late bid", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId, clashId: "clash-vfd-01", tradePackageId: p26B,
      deductAmount: 38500, description: "Variable Frequency Drives (VFDs) for AHUs & Pumps",
    })
  );
  const lateRow = (await c.query("bids:listByPackage", { tradePackageId: p26B })).find((b) => b._id === lateBid.bidId);
  record(
    "A26-08.2",
    "A25-01 impact: once a bid arrives the phantom card still claims deducted; the bid is untouched and the sanctioned retry is permanently refused",
    lateRow?.leveledTotalCost === 290000 && (lateRow?.valueEngineeringAlternates || []).length === 0 &&
      retry.ok === false && /already been applied/i.test(String(retry.data ?? "")),
    { lateBid: { base: lateRow?.baseBidAmount, leveled: lateRow?.leveledTotalCost, ve: (lateRow?.valueEngineeringAlternates || []).length }, retry: { ok: retry.ok, data: retry.data } }
  );

  // ---------- B. alias clashId stacking (A25-02) ----------
  const gateBidsBefore = await c.query("bids:listByPackage", { tradePackageId: F.gate.p23 });
  const gateRowBefore = gateBidsBefore.find((b) => /Gate Mechanical/.test(b.subcontractorName));
  const alias = await call("alias clashId deduct", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: F.gate.id,
      clashId: "clash-vfd-01-qa26-alias",
      tradePackageId: F.gate.p23,
      bidId: gateRowBefore._id,
      deductAmount: 12000,
      description: "QA26 alias redundant disconnect buyout",
    })
  );
  const gateRowAfter = (await c.query("bids:listByPackage", { tradePackageId: F.gate.p23 })).find((b) => b._id === gateRowBefore._id);
  const gateVe = gateRowAfter?.valueEngineeringAlternates || [];
  record(
    "A26-08.3",
    "A25-02 convergence: a rotated clashId with a new description stacks a second accepted credit on the same bid (leveled cost reduced again)",
    alias.ok === true && gateVe.length === 2 && gateRowAfter?.leveledTotalCost === (gateRowBefore?.leveledTotalCost ?? 0) - 12000,
    { before: { leveled: gateRowBefore?.leveledTotalCost, ve: (gateRowBefore?.valueEngineeringAlternates || []).length }, alias: { ok: alias.ok, value: alias.value ?? alias.data }, after: { leveled: gateRowAfter?.leveledTotalCost, ve: gateVe.map((v) => ({ d: v.costDeduct, desc: v.description.slice(0, 60) })) } }
  );

  // ---------- C. assign rotation (A25-03) ----------
  const elecBefore = (await c.query("bids:listByPackage", { tradePackageId: F.gate.p26 })).find((b) => /Gate Electric/.test(b.subcontractorName));
  const rotated = await call("rotated voidId assign", () =>
    c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: F.gate.id,
      voidId: "void-bas-wiring-01-qa26-alias",
      tradePackageId: F.gate.p26,
      additionalCost: 28000,
      description: "QA26 alias BAS control wiring package",
    })
  );
  const elecAfter = (await c.query("bids:listByPackage", { tradePackageId: F.gate.p26 })).find((b) => b._id === elecBefore._id);
  const voidLines = (elecAfter?.lineItems || []).filter((i) => /Assigned Scope Void/.test(i.item));
  record(
    "A26-08.4",
    "A25-03 convergence: a rotated voidId with a new description adds a second scope-void line and cost on the same bid",
    rotated.ok === true && voidLines.length === 2 && elecAfter?.baseBidAmount === (elecBefore?.baseBidAmount ?? 0) + 28000,
    { before: { base: elecBefore?.baseBidAmount, items: (elecBefore?.lineItems || []).filter((i) => /Assigned Scope Void/.test(i.item)).length }, rotated: { ok: rotated.ok, value: rotated.value ?? rotated.data }, after: { base: elecAfter?.baseBidAmount, voidLines: voidLines.map((i) => i.item) } }
  );

  writeEvidence("multi-gate-alias", { projectId, results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
  writeLog("multi-gate-alias", log);
  console.log(`multi-gate-alias: ${results.filter((r) => r.pass).length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("multi-gate-alias-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});