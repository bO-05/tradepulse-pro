/**
 * QA27-02 backend verification of the round-11 fixes on live deployment:
 *  FIX 1 (FIX-NEW-60): target-scoped credit evidence. Project has Div26-A priced /
 *          Div26-B unpriced / Div23 priced. deduct(target=Div26-B) refused, no
 *          resolution row, no audit/mutation; deduct(target=Div26-A) applies once.
 *  FIX 2 (FIX-NEW-61): known-clash allowlist. clash-fake-99 refused; only
 *          clash-vfd-01 / clash-disconnect-02 accepted. Same for
 *          assignScopeVoidToTrade with void-bas-wiring-01 / void-smoke-detectors-02.
 *  FIX 3 (FIX-NEW-62): scope-void assignment idempotency. Same voidId twice is
 *          refused; no duplicate line item / inclusion / resolution.
 *  FIX 4 (FIX-NEW-63): award/generate audit wording is generated + pending
 *          execution; execute writes its own execution record.
 */
import { client, readEvidence, writeEvidence, writeLog, call } from "./qa27-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1400)}`);
};

const VFD = "Variable Frequency Drives (VFDs) for AHUs & Pumps";
const DISCONNECT = "Rooftop Mechanical Equipment Disconnect Switches";
const BAS_VOID = "Low-Voltage 24V BAS Control & Interlock Wiring";
const SMOKE_VOID = "Duct Smoke Detector Installation & FACP Tie-In";

const detect = (projectId) => c.query("coordination:detectCrossTradeClashes", { projectId });
const bidsOf = (pkgId) => c.query("bids:listByPackage", { tradePackageId: pkgId });
const logsOf = (projectId, limit = 400) => c.query("auditLogs:listRecentLogs", { projectId, limit });

async function main() {
  // =====================================================================
  // FIX 1 - target-scoped credit evidence
  // =====================================================================
  const C = F.credit;
  const preB = await detect(C.id);
  const targetRefusal = await call("deduct target=Div26-B (unpriced)", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: C.id,
      clashId: "clash-vfd-01",
      tradePackageId: C.p26b.id,
      deductAmount: 38500,
      description: VFD,
    })
  );
  const postB = await detect(C.id);
  const postBLogs = await logsOf(C.id);
  const bBids = await bidsOf(C.p26b.id);
  const pkgB = await c.query("tradePackages:getPackage", { tradePackageId: C.p26b.id });
  const vfdAfterRefusal = postB.doubleBuys.find((x) => x.id === "clash-vfd-01");
  record(
    "FIX1.a",
    "target-scoped evidence: deduct(target=Div26-B unpriced) refused with 'target trade package has no priced proposal'; no resolution row (card still detected, no deductedAmount), no credit audit row, no bid/inclusion mutation",
    targetRefusal.ok === false &&
      /target trade package has no priced proposal/i.test(String(targetRefusal.data ?? "")) &&
      vfdAfterRefusal?.status === "detected" && vfdAfterRefusal?.deductedAmount == null &&
      !postBLogs.some((l) => /Double-Buy Credit/.test(l.title || "")) &&
      bBids.length === 0 && !(pkgB?.mandatoryInclusions || []).some((i) => /Variable Frequency|VFD/i.test(i)) &&
      preB.doubleBuys.find((x) => x.id === "clash-vfd-01")?.status === "detected",
    {
      refusal: { ok: targetRefusal.ok, data: targetRefusal.data },
      cardAfter: vfdAfterRefusal ? { status: vfdAfterRefusal.status, deductedAmount: vfdAfterRefusal.deductedAmount ?? null, resolution: vfdAfterRefusal.resolution ?? null } : null,
      auditRows: postBLogs.filter((l) => /Double-Buy Credit/.test(l.title || "")).map((l) => l.title),
      bBids: bBids.length, pkgBInclusions: pkgB?.mandatoryInclusions,
    }
  );

  const applyA = await call("deduct target=Div26-A (priced)", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: C.id,
      clashId: "clash-vfd-01",
      tradePackageId: C.p26a.id,
      bidId: C.p26a.bidId,
      deductAmount: 38500,
      description: VFD,
    })
  );
  const bidA = (await bidsOf(C.p26a.id)).find((b) => b._id === C.p26a.bidId);
  const postA = await detect(C.id);
  const postALogs = await logsOf(C.id);
  const vfdAfterApply = postA.doubleBuys.find((x) => x.id === "clash-vfd-01");
  const deductRows = postALogs.filter((l) => /Double-Buy Credit Deducted/.test(l.title || ""));
  record(
    "FIX1.b",
    "target-scoped evidence: deduct(target=Div26-A priced) applies exactly one accepted $38,500 VE credit and one Deducted audit row; card flips deducted with the real amount",
    applyA.ok === true && applyA.value?.newLeveledCost === 661500 &&
      bidA?.leveledTotalCost === 661500 &&
      (bidA?.valueEngineeringAlternates || []).length === 1 &&
      bidA?.valueEngineeringAlternates?.[0]?.costDeduct === 38500 && bidA?.valueEngineeringAlternates?.[0]?.isAccepted === true &&
      vfdAfterApply?.status === "deducted" && vfdAfterApply?.deductedAmount === 38500 &&
      deductRows.length === 1 &&
      /38,500/.test(`${deductRows[0].title || ""} ${deductRows[0].description || ""}`),
    {
      apply: applyA.value ?? { ok: applyA.ok, data: applyA.data },
      bid: bidA ? { leveled: bidA.leveledTotalCost, ve: bidA.valueEngineeringAlternates } : null,
      card: vfdAfterApply ? { status: vfdAfterApply.status, deductedAmount: vfdAfterApply.deductedAmount } : null,
      deductAudit: deductRows.map((l) => ({ title: l.title, desc: l.description.slice(0, 160) })),
    }
  );

  const dupeA = await call("deduct again target=Div26-A", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: C.id, clashId: "clash-vfd-01", tradePackageId: C.p26a.id, bidId: C.p26a.bidId,
      deductAmount: 5000, description: "QA27 duplicate stack attempt",
    })
  );
  const bidA2 = (await bidsOf(C.p26a.id)).find((b) => b._id === C.p26a.bidId);
  record(
    "FIX1.c",
    "target-scoped evidence: a second credit on the same clash is refused and leaves the bid at exactly one credit",
    dupeA.ok === false && /already been applied/i.test(String(dupeA.data ?? "")) &&
      bidA2?.leveledTotalCost === 661500 && (bidA2?.valueEngineeringAlternates || []).length === 1,
    { dupe: { ok: dupeA.ok, data: dupeA.data }, after: { leveled: bidA2?.leveledTotalCost, ve: (bidA2?.valueEngineeringAlternates || []).length } }
  );

  // =====================================================================
  // FIX 2 - known-clash allowlist
  // =====================================================================
  const K = F.clash;
  const fakeDeduct = await call("deduct clash-fake-99", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: K.id, clashId: "clash-fake-99", tradePackageId: K.p23.id, bidId: K.p23.bidId,
      deductAmount: 9999, description: "QA27 rotated phantom clash",
    })
  );
  const k23AfterFake = (await bidsOf(K.p23.id)).find((b) => b._id === K.p23.bidId);
  const kLogsAfterFake = await logsOf(K.id);
  const detectAfterFake = await detect(K.id);
  record(
    "FIX2.a",
    "known-clash allowlist: rotated clash-fake-99 refused; no VE credit, no resolution overlay, no credit audit row",
    fakeDeduct.ok === false && /unknown clash id/i.test(String(fakeDeduct.data ?? "")) &&
      k23AfterFake?.leveledTotalCost === 480000 && (k23AfterFake?.valueEngineeringAlternates || []).length === 0 &&
      detectAfterFake.doubleBuys.every((x) => x.status === "detected" && x.deductedAmount == null) &&
      !kLogsAfterFake.some((l) => /Double-Buy Credit/.test(l.title || "")),
    {
      refusal: { ok: fakeDeduct.ok, data: fakeDeduct.data },
      bid: { leveled: k23AfterFake?.leveledTotalCost, ve: (k23AfterFake?.valueEngineeringAlternates || []).length },
      cards: detectAfterFake.doubleBuys.map((x) => ({ id: x.id, status: x.status })),
    }
  );

  const realVfd = await call("deduct clash-vfd-01", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: K.id, clashId: "clash-vfd-01", tradePackageId: K.p23.id, bidId: K.p23.bidId,
      deductAmount: 38500, description: VFD,
    })
  );
  const realDisconnect = await call("deduct clash-disconnect-02", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: K.id, clashId: "clash-disconnect-02", tradePackageId: K.p26.id, bidId: K.p26.bidId,
      deductAmount: 12000, description: DISCONNECT,
    })
  );
  const k23After = (await bidsOf(K.p23.id)).find((b) => b._id === K.p23.bidId);
  const k26After = (await bidsOf(K.p26.id)).find((b) => b._id === K.p26.bidId);
  const detectAfterReal = await detect(K.id);
  record(
    "FIX2.b",
    "known-clash allowlist: clash-vfd-01 and clash-disconnect-02 are accepted exactly once each and both cards flip deducted",
    realVfd.ok === true && realDisconnect.ok === true &&
      k23After?.leveledTotalCost === 441500 && (k23After?.valueEngineeringAlternates || []).length === 1 &&
      k26After?.leveledTotalCost === 748000 && (k26After?.valueEngineeringAlternates || []).length === 1 &&
      detectAfterReal.doubleBuys.find((x) => x.id === "clash-vfd-01")?.status === "deducted" &&
      detectAfterReal.doubleBuys.find((x) => x.id === "clash-disconnect-02")?.status === "deducted",
    {
      vfd: { ok: realVfd.ok, value: realVfd.value ?? realVfd.data },
      disconnect: { ok: realDisconnect.ok, value: realDisconnect.value ?? realDisconnect.data },
      k23: { leveled: k23After?.leveledTotalCost }, k26: { leveled: k26After?.leveledTotalCost },
      cards: detectAfterReal.doubleBuys.map((x) => ({ id: x.id, status: x.status, deducted: x.deductedAmount ?? null })),
    }
  );

  const fakeVoid = await call("assign void-fake-99", () =>
    c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: K.id, voidId: "void-fake-99", tradePackageId: K.p26.id, bidId: K.p26.bidId,
      additionalCost: 7000, description: "QA27 phantom void",
    })
  );
  const k26PkgAfterFakeVoid = await c.query("tradePackages:getPackage", { tradePackageId: K.p26.id });
  const k26BidAfterFakeVoid = (await bidsOf(K.p26.id)).find((b) => b._id === K.p26.bidId);
  record(
    "FIX2.c",
    "known-void allowlist: void-fake-99 refused; no inclusion, no line item, no resolution",
    fakeVoid.ok === false && /unknown scope void id/i.test(String(fakeVoid.data ?? "")) &&
      !(k26PkgAfterFakeVoid?.mandatoryInclusions || []).includes("QA27 phantom void") &&
      !(k26BidAfterFakeVoid?.lineItems || []).some((i) => /QA27 phantom void/.test(i.item || "")),
    { refusal: { ok: fakeVoid.ok, data: fakeVoid.data }, inclusions: k26PkgAfterFakeVoid?.mandatoryInclusions }
  );

  const assignBas = await call("assign void-bas-wiring-01", () =>
    c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: K.id, voidId: "void-bas-wiring-01", tradePackageId: K.p26.id, bidId: K.p26.bidId,
      additionalCost: 28000, description: BAS_VOID,
    })
  );
  const assignSmoke = await call("assign void-smoke-detectors-02", () =>
    c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: K.id, voidId: "void-smoke-detectors-02", tradePackageId: K.p23.id, bidId: K.p23.bidId,
      additionalCost: 18500, description: SMOKE_VOID,
    })
  );
  const detectAfterVoids = await detect(K.id);
  record(
    "FIX2.d",
    "known-void allowlist: void-bas-wiring-01 and void-smoke-detectors-02 are accepted; both cards flip assigned",
    assignBas.ok === true && assignSmoke.ok === true &&
      detectAfterVoids.scopeVoids.find((x) => x.id === "void-bas-wiring-01")?.status === "assigned" &&
      detectAfterVoids.scopeVoids.find((x) => x.id === "void-smoke-detectors-02")?.status === "assigned",
    {
      bas: { ok: assignBas.ok, value: assignBas.value ?? assignBas.data },
      smoke: { ok: assignSmoke.ok, value: assignSmoke.value ?? assignSmoke.data },
      cards: detectAfterVoids.scopeVoids.map((x) => ({ id: x.id, status: x.status })),
    }
  );

  // =====================================================================
  // FIX 3 - scope-void assignment idempotency
  // =====================================================================
  const k26BidBeforeReassign = (await bidsOf(K.p26.id)).find((b) => b._id === K.p26.bidId);
  const k26PkgBeforeReassign = await c.query("tradePackages:getPackage", { tradePackageId: K.p26.id });
  const reassign = await call("assign void-bas-wiring-01 again", () =>
    c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: K.id, voidId: "void-bas-wiring-01", tradePackageId: K.p26.id, bidId: K.p26.bidId,
      additionalCost: 28000, description: BAS_VOID,
    })
  );
  const k26BidAfterReassign = (await bidsOf(K.p26.id)).find((b) => b._id === K.p26.bidId);
  const k26PkgAfterReassign = await c.query("tradePackages:getPackage", { tradePackageId: K.p26.id });
  const kLogs = await logsOf(K.id);
  const basItems = (k26BidAfterReassign?.lineItems || []).filter((i) => (i.item || "") === `Assigned Scope Void: ${BAS_VOID}`);
  const basInclusions = (k26PkgAfterReassign?.mandatoryInclusions || []).filter((i) => i === BAS_VOID);
  const basAssignRows = kLogs.filter((l) => (l.title || "") === `Scope Void Assigned: ${BAS_VOID}`);
  record(
    "FIX3.a",
    "assign idempotency: same voidId twice is refused readably; exactly one line item, one inclusion, one assign audit row and one cost bump",
    reassign.ok === false && /already been assigned/i.test(String(reassign.data ?? "")) &&
      basItems.length === 1 && basInclusions.length === 1 && basAssignRows.length === 1 &&
      k26BidAfterReassign?.baseBidAmount === k26BidBeforeReassign?.baseBidAmount &&
      k26BidAfterReassign?.leveledTotalCost === k26BidBeforeReassign?.leveledTotalCost &&
      k26PkgAfterReassign?.mandatoryInclusions?.length === k26PkgBeforeReassign?.mandatoryInclusions?.length,
    {
      refusal: { ok: reassign.ok, data: reassign.data },
      basItems: basItems.length, basInclusions: basInclusions.length, basAssignRows: basAssignRows.length,
      baseBefore: k26BidBeforeReassign?.baseBidAmount, baseAfter: k26BidAfterReassign?.baseBidAmount,
      leveledBefore: k26BidBeforeReassign?.leveledTotalCost, leveledAfter: k26BidAfterReassign?.leveledTotalCost,
      inclusionsBefore: (k26PkgBeforeReassign?.mandatoryInclusions || []).length,
      inclusionsAfter: (k26PkgAfterReassign?.mandatoryInclusions || []).length,
    }
  );

  // =====================================================================
  // FIX 4 - award/generate and execute audit wording
  // =====================================================================
  const W = F.award;
  const gen = await c.mutation("agreements:generateAgreement", { bidId: W.p26.bidId, tradePackageId: W.p26.id });
  const logsAfterGen = await logsOf(W.id);
  const awardRow = logsAfterGen.find((l) => /AIA A401 Subcontract Agreement Awarded/.test(l.title || ""));
  record(
    "FIX4.a",
    "audit wording: generation row says the agreement was generated / pending external execution and never claims an executed subcontract",
    gen.status === "generated" && gen.executedAt == null && Boolean(awardRow) &&
      /generated/i.test(awardRow.description || "") &&
      /pending external execution/i.test(awardRow.description || "") &&
      !/Executed subcontract agreement/i.test(awardRow.description || ""),
    {
      agreement: { number: gen.agreementNumber, status: gen.status, executedAt: gen.executedAt ?? null },
      audit: awardRow ? { title: awardRow.title, description: awardRow.description, eventType: awardRow.eventType } : null,
    }
  );

  const exec = await c.mutation("agreements:executeAgreement", { agreementId: gen._id });
  const agrsAfterExec = (await c.query("agreements:listAgreements", { projectId: W.id })) || [];
  const genAfter = agrsAfterExec.find((a) => a._id === gen._id);
  const logsAfterExec = await logsOf(W.id);
  const execRows = logsAfterExec.filter(
    (l) => (l.title || "") === "AIA A401 Execution Status Recorded" && (l.description || "").includes(gen.agreementNumber)
  );
  const awardRowAfter = logsAfterExec.find((l) => /AIA A401 Subcontract Agreement Awarded/.test(l.title || ""));
  record(
    "FIX4.b",
    "audit wording: execute writes its own execution record (status recorded + external signature verification remains required) and leaves the generation row unchanged",
    exec.success === true && genAfter?.status === "executed" && typeof genAfter?.executedAt === "number" &&
      execRows.length === 1 &&
      /execution status recorded/i.test(execRows[0].description || "") &&
      /external signature verification remains required/i.test(execRows[0].description || "") &&
      awardRowAfter?.description === awardRow?.description,
    {
      exec: exec.value ?? exec,
      agreement: genAfter ? { number: genAfter.agreementNumber, status: genAfter.status, executedAt: genAfter.executedAt } : null,
      execAudit: execRows.map((l) => ({ title: l.title, description: l.description })),
      genRowUnchanged: awardRowAfter?.description === awardRow?.description,
    }
  );

  writeEvidence("fixes", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
  writeLog("fixes", log);
  console.log(`fixes: ${results.filter((r) => r.pass).length}/${results.length}`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("fixes-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});