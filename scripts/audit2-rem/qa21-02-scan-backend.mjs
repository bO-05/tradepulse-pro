/**
 * QA21-02: backend scanCrossTradeClashes staged verification (A19-02) + partial-bid hunt.
 * Uses its own AUDIT-QA21-STAGED project (both packages) so the shared fixtures stay clean.
 *  - STAGED (both pkgs, no bids)      -> analyzed:false, no invented text
 *  - STAGED + Div 26 bid only         -> analyzed:false (action) BUT engine baseline (A21-01)
 *  - FULL   (fixture with 1 bid each) -> analyzed:true, message === engine-derived summary
 */
import { client, readEvidence, writeEvidence, writeLog, purgeQa21, findProjectByTitle, fixtureTitle, plusDays, sleep } from "./qa21-lib.mjs";

const F = readEvidence("01-fixtures");
const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 900)}`);
};

const usd = (n) => `$${Number(n || 0).toLocaleString("en-US")}`;

function summaryFromDetect(detected) {
  const buys = (detected?.doubleBuys || []).filter((d) => d.status === "detected");
  const voids = (detected?.scopeVoids || []).filter((v) => v.status === "open");
  const buyAmount = buys.reduce((s, d) => s + (d.redundantAmount || 0), 0);
  const voidAmount = voids.reduce((s, v) => s + (v.estimatedVoidCost || 0), 0);
  return {
    buys: buys.length,
    voids: voids.length,
    buyAmount,
    voidAmount,
    message:
      buys.length + voids.length === 0
        ? "Cross-trade scan complete: no double-buys or scope voids detected between Division 26 and Division 23."
        : `Cross-trade scan complete: ${buys.length} double-buy item(s) worth ${usd(buyAmount)} and ${voids.length} open scope void(s) worth ${usd(voidAmount)}.`,
  };
}

async function scan(c, projectId) {
  const t0 = Date.now();
  const res = await c.action("coordination:scanCrossTradeClashes", { projectId });
  return { res, elapsedMs: Date.now() - t0 };
}

async function makeStaged() {
  const STAGED = fixtureTitle("STAGED");
  const existing = await findProjectByTitle(c, STAGED);
  if (existing) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: existing._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA21 staged reset before re-creating the fixture." }).catch(() => {});
    }
    await c.mutation("projects:deleteProject", { projectId: existing._id });
    say(`recreated STAGED (deleted stale ${existing._id})`);
    await sleep(400);
  }
  const projectId = await c.mutation("projects:createProject", {
    title: STAGED,
    location: "Portland, OR",
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: 1_600_000,
    targetCompletionWeeks: 52,
    specDocumentText: `${STAGED} staged scan fixture.`,
    isDemoProject: false,
    generalContractorName: "QA21 Staged GC, LLC",
  });
  const deadline = plusDays(21);
  const elecPackageId = await c.mutation("tradePackages:createTradePackage", {
    projectId, csiDivision: "26 00 00", tradeName: "QA21 STAGED Electrical", budgetEstimate: 550_000,
    scopeSummary: "QA21 staged electrical scope.", mandatoryInclusions: ["QA21 staged inclusion"], bidDeadline: deadline,
  });
  const hvacPackageId = await c.mutation("tradePackages:createTradePackage", {
    projectId, csiDivision: "23 00 00", tradeName: "QA21 STAGED HVAC", budgetEstimate: 420_000,
    scopeSummary: "QA21 staged HVAC scope.", mandatoryInclusions: ["QA21 staged inclusion"], bidDeadline: deadline,
  });
  say(`created STAGED ${projectId} elec=${elecPackageId} hvac=${hvacPackageId}`);
  return { title: STAGED, id: projectId, elecPackageId, hvacPackageId };
}

async function makeContractor(pkgId, name, email) {
  return await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId,
    companyName: name,
    contactEmail: email,
    phone: "+1 (206) 555-0144",
    licenseNumber: `QA21-STAGED-${Date.now().toString().slice(-5)}`,
    licenseStatus: "Active / Verified (QA21)",
    sourceUrl: "https://qa21.example.invalid/license",
    rfqStatus: "invited",
  });
}

async function makeBid(pkgId, contractorId, name, base) {
  return await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkgId,
    contractorId,
    subcontractorName: name,
    baseBidAmount: base,
    identifiedExclusions: [],
    valueEngineeringAlternates: [],
    longLeadEquipmentWeeks: 6,
    leadTimePenalty: 0,
    coiComplianceStatus: "compliant",
    coiPenalty: 0,
  });
}

async function main() {
  const out = {};
  const staged = await makeStaged();

  // ---------- STAGED: zero proposals ----------
  const zeroDetected = await c.query("coordination:detectCrossTradeClashes", { projectId: staged.id });
  const zero = await scan(c, staged.id);
  out.stagedNoBids = { res: zero.res, elapsedMs: zero.elapsedMs, detected: zeroDetected };
  record(
    "A19-02.nobids-analyzed-false",
    "no-bid project: analyzed:false + priced-proposal prerequisite + no analysis text",
    zero.res?.success === false &&
      zero.res?.analyzed === false &&
      /at least one priced proposal in both Division 26 and Division 23/i.test(zero.res?.message || "") &&
      zero.res?.analysis === undefined,
    { res: zero.res, elapsedMs: zero.elapsedMs }
  );
  record(
    "A19-02.nobids-engine-empty",
    "no-bid project: detectCrossTradeClashes has no double-buys/voids",
    (zeroDetected?.doubleBuys || []).length === 0 && (zeroDetected?.scopeVoids || []).length === 0,
    { totalRedundantAmount: zeroDetected?.totalRedundantAmount, totalVoidExposure: zeroDetected?.totalVoidExposure }
  );

  // ---------- STAGED + Div 26 bid only (partial-priced hunt) ----------
  const elecContractor = await makeContractor(staged.elecPackageId, "AUDIT-QA21 STAGED Elec", "qa21.staged.elec@qa21.invalid");
  const elecBid = await makeBid(staged.elecPackageId, elecContractor, "AUDIT-QA21 STAGED Elec", 360_000);
  const partial = await scan(c, staged.id);
  const partialDetected = await c.query("coordination:detectCrossTradeClashes", { projectId: staged.id });
  out.stagedPartial = { res: partial.res, elapsedMs: partial.elapsedMs, detected: partialDetected, elecBidId: elecBid };
  record(
    "A19-02.partial-one-side-analyzed-false",
    "one-sided priced proposals: scan action refuses with analyzed:false + prerequisite message",
    partial.res?.success === false &&
      partial.res?.analyzed === false &&
      /at least one priced proposal in both Division 26 and Division 23/i.test(partial.res?.message || "") &&
      partial.res?.analysis === undefined,
    { res: partial.res, elapsedMs: partial.elapsedMs }
  );
  // HUNT A21-01: the action is guarded, but the query that feeds the Coordination
  // KPI/clash cards still fabricates the benchmark clash set when only ONE side has
  // priced proposals (the engine guard is "both sides empty" only).
  record(
    "A21-01.partial-engine-baseline",
    "HUNT: detectCrossTradeClashes still returns the static benchmark clash set on a one-sided priced project",
    (partialDetected?.doubleBuys || []).filter((d) => d.status === "detected").length === 0 &&
      (partialDetected?.scopeVoids || []).filter((v) => v.status === "open").length === 0,
    {
      doubleBuys: (partialDetected?.doubleBuys || []).map((d) => ({ id: d.id, status: d.status, redundantAmount: d.redundantAmount })),
      scopeVoids: (partialDetected?.scopeVoids || []).map((v) => ({ id: v.id, status: v.status, estimatedVoidCost: v.estimatedVoidCost })),
      note: "Scan refuses (analyzed:false), but the query display source still claims 2 double-buys ($50,500) and 2 scope voids ($46,500) with zero HVAC proposals.",
    }
  );

  // ---------- FULL fixture: both packages, one bid each ----------
  const fullBefore = await c.query("coordination:detectCrossTradeClashes", { projectId: F.full.id });
  const full = await scan(c, F.full.id);
  const fullAfter = await c.query("coordination:detectCrossTradeClashes", { projectId: F.full.id });
  const fullSummary = summaryFromDetect(fullAfter);
  out.full = { res: full.res, elapsedMs: full.elapsedMs, detectedBefore: fullBefore, detectedAfter: fullAfter, summary: fullSummary };
  record(
    "A19-02.full-analyzed-true",
    "FULL fixture: analyzed:true + exact engine summary (2 buys $50,500 / 2 voids $46,500)",
    full.res?.success === true &&
      full.res?.analyzed === true &&
      full.res?.message === fullSummary.message &&
      fullSummary.buys === 2 &&
      fullSummary.buyAmount === 50500 &&
      fullSummary.voids === 2 &&
      fullSummary.voidAmount === 46500,
    { res: full.res, summary: fullSummary, elapsedMs: full.elapsedMs }
  );
  record(
    "A19-02.full-no-analysis-field",
    "FULL fixture: action returns no raw model text (analysis removed)",
    full.res?.analysis === undefined && full.res?.reasoning === undefined,
    { keys: Object.keys(full.res || {}) }
  );
  record(
    "A19-02.full-state-stable",
    "scan does not mutate clash/package/bid state",
    JSON.stringify(fullBefore?.doubleBuys) === JSON.stringify(fullAfter?.doubleBuys) &&
      JSON.stringify(fullBefore?.scopeVoids) === JSON.stringify(fullAfter?.scopeVoids),
    { beforeTotal: fullBefore?.totalRedundantAmount, afterTotal: fullAfter?.totalRedundantAmount }
  );

  const outAll = {
    ...out,
    staged: { id: staged.id, elecBidId: elecBid, leftInOneSidedState: true },
    results,
    summary: { pass: results.filter((r) => r.pass).length, total: results.length },
  };
  writeEvidence("02-scan-backend", outAll);
  writeLog("02-scan-backend", log);
  console.log(`scan backend: ${results.filter((r) => r.pass).length}/${results.length}`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("02-scan-backend-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});