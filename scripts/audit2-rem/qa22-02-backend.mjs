/**
 * QA22-02 backend regression + round-8 verification (fixtures AUDIT-QA22-*).
 * Classes: F1 pending->clarified, executed immutability, readable errors,
 * deadline local-day rule, clash credit idempotency, void lifecycle,
 * scan guard truthfulness, addendum file provenance.
 */
import { client, readEvidence, writeEvidence, writeLog, projectSnapshot, sleep, call } from "./qa22-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const S = F.state;
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 900)}`);
};

async function poll(fn, predicate, timeoutMs = 150000, stepMs = 2500) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (predicate(last)) return last;
    await sleep(stepMs);
  }
  return last;
}

async function violationScan(projectId) {
  const snap = await projectSnapshot(c, projectId);
  const out = [];
  const activeByPkg = new Map();
  for (const a of snap.agreements) {
    if (a.status !== "superseded") activeByPkg.set(a.tradePackageId, (activeByPkg.get(a.tradePackageId) || 0) + 1);
  }
  for (const [pkgId, n] of activeByPkg) if (n > 1) out.push({ kind: "two_active_agreements", pkgId, n });
  for (const a of snap.agreements) {
    const bid = snap.bids.find((b) => b._id === a.bidId);
    if (a.status === "executed" && bid && !bid.isAwarded) out.push({ kind: "executed_bid_not_awarded", agreement: a.agreementNumber });
    const pkg = snap.packages.find((x) => x._id === a.tradePackageId);
    if (a.status === "generated" && pkg && pkg.status !== "awarded") out.push({ kind: "generated_agreement_pkg_not_awarded", agreement: a.agreementNumber });
  }
  for (const pkg of snap.packages) {
    const pkgBids = snap.bids.filter((b) => b.tradePackageId === pkg._id);
    if (pkgBids.filter((b) => b.isAwarded).length > 1) out.push({ kind: "two_awarded_bids", pkg: pkg.csiDivision });
  }
  return out;
}

async function main() {
  const pre = await projectSnapshot(c, S.id);
  record(
    "A22-02.0",
    "fixture baseline: 4 packages, 5 bids, deceptive trio present",
    pre.packages.length === 4 && pre.bids.length === 5 &&
      pre.bids.some((b) => b.leveledTotalCost === 817000) && pre.bids.some((b) => b.leveledTotalCost === 890000),
    { pkgs: pre.packages.map((p) => `${p.csiDivision}:${p.status}:${p.bidDeadline}`), bids: pre.bids.map((b) => ({ base: b.bidBase ?? b.baseBidAmount, leveled: b.leveledTotalCost, awarded: b.isAwarded })) }
  );

  // ---------- F1: pending -> clarified, retry semantics ----------
  const rfiSub = await c.mutation("simulation:submitCustomRfi", {
    tradePackageId: S.s1,
    contractorId: S.contractors.s1A,
    subject: "QA22 conduit spec clarification",
    question: "Confirm whether the QA22 scope requires rigid galvanized conduit for the parking deck feeders or if EMT is acceptable per spec section 26 05 33.",
  });
  const immediately = await c.query("rfq:listConversations", { tradePackageId: S.s1 });
  const pendingRow = (immediately || []).find((x) => x._id === rfiSub.conversationId);
  const firstStatus = pendingRow?.status ?? null;
  const progress = await poll(
    () => c.query("rfq:listConversations", { tradePackageId: S.s1 }).then((r) => (r || []).find((x) => x._id === rfiSub.conversationId)),
    (row) => row && ["clarified", "escalated_to_pm", "failed_analysis"].includes(row.status),
    150000
  );
  const retryAfterDone = await call("retry after analysis", () => c.mutation("simulation:retryRfiAnalysis", { conversationId: rfiSub.conversationId }));
  record(
    "A22-02.1",
    "F1: RFI persisted pending before analysis, reaches terminal state, text preserved, retry idempotent",
    ["pending_analysis", "clarified", "escalated_to_pm"].includes(firstStatus) &&
      progress && ["clarified", "escalated_to_pm"].includes(progress.status) &&
      progress.inboundQuestion.includes("rigid galvanized conduit") &&
      retryAfterDone.ok && retryAfterDone.value?.success === false,
    { firstStatus, finalStatus: progress?.status, retry: retryAfterDone.value ?? retryAfterDone, questionLen: progress?.inboundQuestion?.length }
  );

  // ---------- FIX-51 + addendum certification gate ----------
  let addendum = null;
  const clarified = progress?.status === "clarified";
  if (clarified) {
    // direct call before PM certification: backend guard must refuse (generic
    // "Server Error" is expected because the UI pre-checks; captured as detail)
    const uncertified = await call("generate before certification", () => c.action("rfq:generatePreBidAddendum", { projectId: S.id, tradePackageId: S.s1 }));
    await c.mutation("rfq:reviewEscalatedRfi", { conversationId: rfiSub.conversationId, status: "clarified", reviewNote: "QA22 PM certification for addendum provenance test." });
    await sleep(800);
    const gen = await call("generate after certification", () => c.action("rfq:generatePreBidAddendum", { projectId: S.id, tradePackageId: S.s1 }));
    const files = await c.query("files:listFilesByProject", { projectId: S.id });
    const addendumFile = (files || []).find((f) => f.fileType === "addendum" && f.uploadedBy);
    addendum = {
      uncertified: { ok: uncertified.ok, data: uncertified.data ?? uncertified.message },
      genOk: gen.ok, err: gen.ok ? null : gen.data ?? gen.message,
      file: addendumFile ? { name: addendumFile.fileName, uploadedBy: addendumFile.uploadedBy } : null,
    };
  }
  record(
    "A22-02.2",
    "FIX-51: certified addendum files with Pre-Bid Clarification Engine provenance; uncertified direct call is refused",
    clarified
      ? Boolean(addendum?.genOk && /Pre-Bid Clarification Engine/.test(addendum.file?.uploadedBy || "") && addendum.uncertified.ok === false)
      : true,
    { clarified, addendum }
  );

  // ---------- Deadline rule (A14/A17): local-day + 12h slack ----------
  // fresh past-deadline package WITH a bid to prove the positive transition
  const pastPkg = await c.mutation("tradePackages:createTradePackage", {
    projectId: S.id, csiDivision: "31 00 00", tradeName: "QA22 Past Deadline w/ Bid", budgetEstimate: 90000,
    scopeSummary: "QA22 past-deadline positive control.", mandatoryInclusions: ["Erosion control"], bidDeadline: F.deadlines.minus1,
  });
  const pastCtr = await c.mutation("contractors:createContractor", {
    tradePackageId: pastPkg, companyName: "AUDIT-QA22 Past Deadline Co", contactEmail: "estimating@qa22-past.invalid",
    licenseNumber: "TX-QA22-PD", licenseStatus: "Active / Verified (QA22)", sourceUrl: "https://qa22.example.invalid/pd", rfqStatus: "invited",
  });
  await c.mutation("bids:submitDirectBid", { tradePackageId: pastPkg, contractorId: pastCtr, subcontractorName: "AUDIT-QA22 Past Deadline Co", baseBidAmount: 88000, coiComplianceStatus: "compliant" });
  await c.mutation("tradePackages:updateStatus", { tradePackageId: S.s3, status: "rfqs_dispatched" });
  await c.mutation("tradePackages:updateStatus", { tradePackageId: S.s4, status: "rfqs_dispatched" });
  await c.mutation("tradePackages:updateStatus", { tradePackageId: pastPkg, status: "rfqs_dispatched" });

  await c.mutation("crons:runDeadlineMonitorNow", { projectId: S.id });
  await c.mutation("crons:runDeadlineMonitorNow", { projectId: S.id });
  const s3After = (await c.query("tradePackages:getPackage", { tradePackageId: S.s3 })).status;
  const s4After = (await c.query("tradePackages:getPackage", { tradePackageId: S.s4 })).status;
  const pastAfter = (await c.query("tradePackages:getPackage", { tradePackageId: pastPkg })).status;
  const deadlineEnd = Date.parse(`${F.deadlines.minus1}T23:59:59.999Z`) + 12 * 60 * 60 * 1000;
  const shouldClose = Date.now() >= deadlineEnd;
  const logs = (await c.query("auditLogs:listRecentLogs", { projectId: S.id, limit: 500 })) || [];
  record(
    "A22-02.3",
    "deadline local-day: today's package stays open until slack; yesterday's with bids closes exactly per end-of-day+12h rule",
    s3After === "rfqs_dispatched" &&
      (pastAfter === "leveling") === shouldClose &&
      (s4After === "rfqs_dispatched") &&
      logs.filter((l) => l.title === "Manual Trigger: Bid Deadline Monitor Executed").length >= 2,
    {
      s3: `rfqs_dispatched->${s3After} (today ${F.deadlines.todayLocal})`,
      s4ZeroBids: `rfqs_dispatched->${s4After} (flagged=${logs.some((l) => l.title.startsWith("Deadline passed with no bids: QA22 Concrete"))})`,
      pastWithBid: `rfqs_dispatched->${pastAfter} (shouldClose=${shouldClose})`,
      deadlineEndISO: new Date(deadlineEnd).toISOString(), nowISO: new Date().toISOString(),
    }
  );

  // ---------- scan guard: SCAN (Div26 only) must refuse without fabricating ----------
  const scanRes = await call("scan on Div26-only", () => c.action("coordination:scanCrossTradeClashes", { projectId: F.scan.id }));
  const scanValue = scanRes.value || {};
  const fabricated = /50,500|38,500|12,000|46,500|28,000|18,500/.test(JSON.stringify(scanValue));
  record(
    "A22-02.4",
    "FIX-50: Div26-only clash scan refuses truthfully, no fabricated double-buy totals",
    scanRes.ok && scanValue.success === false && scanValue.analyzed === false && /needs both a Division 26/.test(scanValue.message || "") && !fabricated,
    { scanValue, fabricated }
  );

  // ---------- clash credit idempotency (on s2 HVAC to keep s1 intact) ----------
  const clashArgs = { projectId: S.id, clashId: "QA22-CLASH-HVAC", tradePackageId: S.s2, deductAmount: 25000, description: "QA22 redundant VFD double-buy" };
  const credit1 = await call("credit#1", () => c.mutation("coordination:deductDoubleBuyCredit", clashArgs));
  const credit2 = await call("credit#2", () => c.mutation("coordination:deductDoubleBuyCredit", clashArgs));
  const s2Bid = (await c.query("bids:listByPackage", { tradePackageId: S.s2 }))[0];
  const veCount = (s2Bid?.valueEngineeringAlternates || []).filter((v) => /QA22 redundant VFD/.test(v.description)).length;
  record(
    "A22-02.5",
    "clash credit applied exactly once and reflected once in the bid's VE list",
    credit1.ok && !credit2.ok && /already been applied/.test(credit2.data || credit2.message || "") && veCount === 1 && s2Bid.leveledTotalCost === 470000 - 25000,
    { credit1: credit1.ok, credit2: { ok: credit2.ok, data: credit2.data }, veCount, leveled: s2Bid?.leveledTotalCost }
  );

  // ---------- scan with both trades: message must equal computed numbers ----------
  const scanBoth = await call("scan with both trades", () => c.action("coordination:scanCrossTradeClashes", { projectId: S.id }));
  const detected = await c.query("coordination:detectCrossTradeClashes", { projectId: S.id });
  const buys = (detected?.doubleBuys || []).filter((d) => d.status === "detected");
  const voids = (detected?.scopeVoids || []).filter((v) => v.status === "open");
  const expectedMsg = buys.length + voids.length === 0
    ? "no double-buys or scope voids"
    : `${buys.length} double-buy`;
  const msg = scanBoth.value?.message || "";
  record(
    "A22-02.6",
    "FIX-50: both-trade scan message derives from persisted clash data (computed count matches query)",
    scanBoth.ok && scanBoth.value?.analyzed === true && msg.includes(expectedMsg),
    { msg, expectedMsg, buys: buys.length, voids: voids.length, ok: scanBoth.ok, err: scanBoth.ok ? null : scanBoth.data ?? scanBoth.message }
  );

  // ---------- Executed immutability (EXEC fixture) ----------
  const agr = await c.mutation("agreements:generateAgreement", { bidId: F.exec.bid.bidId, tradePackageId: F.exec.pkg });
  await c.mutation("agreements:executeAgreement", { agreementId: agr._id });
  const execSnap = await projectSnapshot(c, F.exec.id);
  const bidBefore = execSnap.bids.find((b) => b._id === F.exec.bid.bidId);
  const guards = {
    deleteBid: await call("deleteBid", () => c.mutation("bids:deleteBid", { bidId: F.exec.bid.bidId })),
    reviseBid: await call("submitDirectBid revision", () => c.mutation("bids:submitDirectBid", { tradePackageId: F.exec.pkg, contractorId: F.exec.contractor, subcontractorName: "AUDIT-QA22 Exec Electric", baseBidAmount: 560000 })),
    deletePackage: await call("deleteTradePackage", () => c.mutation("tradePackages:deleteTradePackage", { tradePackageId: F.exec.pkg })),
    deleteProject: await call("deleteProject", () => c.mutation("projects:deleteProject", { projectId: F.exec.id })),
    unaward: await call("unawardContract", () => c.mutation("bids:unawardContract", { bidId: F.exec.bid.bidId, tradePackageId: F.exec.pkg })),
    adjust: await call("updateBidAdjustments", () => c.mutation("bids:updateBidAdjustments", { bidId: F.exec.bid.bidId, identifiedExclusions: [{ description: "QA22 tamper", costImpact: 5000, severity: "minor" }] })),
    deduct: await call("deductDoubleBuyCredit", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: F.exec.id, clashId: "QA22-EXEC-CLASH", tradePackageId: F.exec.pkg, deductAmount: 1000, description: "QA22 exec tamper" })),
    fullCycle: await call("runFullProcurementCycle", () => c.mutation("simulation:runFullProcurementCycle", { projectId: F.exec.id, tradePackageId: F.exec.pkg })),
  };
  const allRefused = Object.values(guards).every((g) => !g.ok);
  const readable = Object.values(guards).every((g) => /Executed|immutable|executed|Cannot|refus|amendment/i.test(String(g.data ?? g.message ?? "")));
  const afterSnap = await projectSnapshot(c, F.exec.id);
  record(
    "A22-02.7",
    "executed immutability: 8 mutations refused; refused errors are readable (ConvexError data, not generic Server Error)",
    allRefused && readable &&
      JSON.stringify(afterSnap.bids.find((b) => b._id === F.exec.bid.bidId)?.valueEngineeringAlternates || []) === JSON.stringify(bidBefore?.valueEngineeringAlternates || []) &&
      afterSnap.bids.length === execSnap.bids.length,
    { refusals: Object.fromEntries(Object.entries(guards).map(([k, v]) => [k, { ok: v.ok, data: v.data }])) }
  );

  // ---------- void lifecycle ----------
  const shortVoid = await call("void short reason", () => c.mutation("agreements:voidExecutedAgreement", { agreementId: agr._id, reason: "oops" }));
  const void1 = await call("void#1", () => c.mutation("agreements:voidExecutedAgreement", { agreementId: agr._id, reason: "QA22 test: recorded in error, external amendment pending." }));
  const void2 = await call("void#2", () => c.mutation("agreements:voidExecutedAgreement", { agreementId: agr._id, reason: "QA22 test: second void must refuse." }));
  const execAfterVoid = await call("execute superseded", () => c.mutation("agreements:executeAgreement", { agreementId: agr._id }));
  const snapV = await projectSnapshot(c, F.exec.id);
  const aV = snapV.agreements.find((a) => a._id === agr._id);
  record(
    "A22-02.8",
    "void flow: short/double/execute-after all refuse; supersede unawards and reopens package",
    !shortVoid.ok && void1.ok && !void2.ok && !execAfterVoid.ok && aV?.status === "superseded" &&
      snapV.bids.find((b) => b._id === F.exec.bid.bidId)?.isAwarded === false &&
      snapV.packages.find((p) => p._id === F.exec.pkg)?.status === "leveling",
    { short: { ok: shortVoid.ok, data: shortVoid.data }, v1: void1.ok, v2: { ok: void2.ok, data: void2.data }, execAfter: { ok: execAfterVoid.ok, data: execAfterVoid.data }, status: aV?.status }
  );

  // ---------- CSV stored names verbatim (UI export check happens in qa22-03) ----------
  const csvBids = await c.query("bids:listByPackage", { tradePackageId: F.csv.pkg });
  record(
    "A22-02.9",
    "CSV fixture stores formula-prefixed bidder names verbatim for the export neutralization test",
    csvBids.length === 2 && csvBids.some((b) => b.subcontractorName === "=1+1") && csvBids.some((b) => b.subcontractorName === "@SUM(1+1)"),
    { names: csvBids.map((b) => b.subcontractorName) }
  );

  const violations = await violationScan(S.id);
  record("A22-02.10", "final integrity scan on STATE is clean", violations.length === 0, { violations });

  writeEvidence("backend", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
  writeLog("backend", log);
  console.log(`backend: ${results.filter((r) => r.pass).length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("backend-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});