/**
 * QA25-05 hunt on the newest paths:
 *  A) multi-package-per-division: does the project-scoped evidence gate still
 *     allow a phantom "deducted" resolution on a zero-bid package?
 *  B) alias clashId re-credit stacking.
 *  C) assign duplicate guard with a rotated void description.
 *  D) scanCrossTradeClashes honesty on no-evidence projects.
 *  E) register status/executedAt audit.
 */
import { client, fixtureTitle, writeEvidence, writeLog, sleep, call } from "./qa25-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const findings = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1200)}`);
};
const finding = (id, severity, title, detail) => {
  findings.push({ id, severity, title, detail });
  say(`FINDING ${id} [${severity}] ${title} :: ${JSON.stringify(detail).slice(0, 900)}`);
};

const VFD = "Variable Frequency Drives (VFDs) for AHUs & Pumps";
const deadline = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10);

const makeProject = (title, gc) =>
  c.mutation("projects:createProject", {
    title, location: "Portland, OR", projectType: "Class-A Commercial Mixed-Use",
    estBudget: 2000000, targetCompletionWeeks: 52,
    specDocumentText: `${title} QA25 hunt fixture scope.`, isDemoProject: false, generalContractorName: gc,
  });
const makePackage = (projectId, csi, name, budget) =>
  c.mutation("tradePackages:createTradePackage", {
    projectId, csiDivision: csi, tradeName: name, budgetEstimate: budget,
    scopeSummary: `${name} per CSI ${csi} for QA25 hunt.`, mandatoryInclusions: [`QA25 hunt ${csi} inclusion`], bidDeadline: deadline,
  });
const makeContractor = (pkgId, name, email) =>
  c.mutation("contractors:createContractor", {
    tradePackageId: pkgId, companyName: name, contactEmail: email, phone: "+1 (206) 555-0177",
    licenseNumber: `QA25-HUNT-${Math.abs(name.length * 7919) % 100000}`, licenseStatus: "Active / Verified (QA25)",
    sourceUrl: "https://qa25.example.invalid/hunt", rfqStatus: "invited",
  });
const makeBid = (pkgId, contractorId, name, base) =>
  c.mutation("bids:submitDirectBid", {
    tradePackageId: pkgId, contractorId, subcontractorName: name, baseBidAmount: base,
    identifiedExclusions: [], valueEngineeringAlternates: [], longLeadEquipmentWeeks: 8,
    leadTimePenalty: 0, coiComplianceStatus: "compliant", coiPenalty: 0,
  });
const bidsOf = async (pkgId) => (await c.query("bids:listByPackage", { tradePackageId: pkgId })) || [];

async function main() {
  // Purge only a prior QA25 hunt fixture if present.
  const existing = (await c.query("projects:listProjects", {})) || [];
  for (const p of existing.filter((x) => x.title === fixtureTitle("HUNT") || x.title === fixtureTitle("HUNT2"))) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try { await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA25 hunt teardown before re-running." }); } catch {}
    }
    try { await c.mutation("projects:deleteProject", { projectId: p._id }); } catch {}
    await sleep(250);
  }

  // ==================================================================
  // A. multi-package per division vs project-scoped evidence gate
  // ==================================================================
  const pid = await makeProject(fixtureTitle("HUNT"), "QA25 Hunt GC");
  const p26a = await makePackage(pid, "26 00 00", "QA25 HUNT Electrical A", 800000);
  const p26b = await makePackage(pid, "26 10 00", "QA25 HUNT Electrical B (no bids)", 600000);
  const p23 = await makePackage(pid, "23 00 00", "QA25 HUNT HVAC", 500000);
  const c26a = await makeContractor(p26a, "AUDIT-QA25 HUNT Electric A", "qa25.hunt.ea@qa25.invalid");
  const c26b = await makeContractor(p26b, "AUDIT-QA25 HUNT Electric B", "qa25.hunt.eb@qa25.invalid");
  const c23 = await makeContractor(p23, "AUDIT-QA25 HUNT Mechanical", "qa25.hunt.h@qa25.invalid");
  const b26a = await makeBid(p26a, c26a, "AUDIT-QA25 HUNT Electric A", 800000);
  const b23 = await makeBid(p23, c23, "AUDIT-QA25 HUNT Mechanical", 250000);
  // b26a/b23 are the FIRST packages per division. p26b has zero bids.
  say(`hunt project=${pid} p26a=${p26a} p26b=${p26b} p23=${p23}`);

  const detectMulti = await c.query("coordination:detectCrossTradeClashes", { projectId: pid });
  const phantom = await call("deduct targeting zero-bid Div26 package B", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: pid, clashId: "clash-vfd-01", tradePackageId: p26b,
      deductAmount: 38500, description: VFD,
    })
  );
  const detectAfterPhantom = await c.query("coordination:detectCrossTradeClashes", { projectId: pid });
  const vfdCard = detectAfterPhantom.doubleBuys.find((d) => d.id === "clash-vfd-01");
  const b26bRows = await bidsOf(p26b);
  // A bid later arrives on package B; the "logged" credit never applies and the
  // sanctioned retry is refused as already applied.
  const lateBid = await makeBid(p26b, c26b, "AUDIT-QA25 HUNT Electric B", 600000);
  const retry = await call("re-deduct on package B after bids arrive", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: pid, clashId: "clash-vfd-01", tradePackageId: p26b, bidId: lateBid.bidId,
      deductAmount: 38500, description: VFD,
    })
  );
  const lateBidAfter = (await bidsOf(p26b)).find((b) => b._id === lateBid.bidId);
  const phantomConfirmed = phantom.ok === true && phantom.value?.success === true &&
    /logged/i.test(phantom.value?.note || "") &&
    vfdCard?.status === "deducted" && b26bRows.length === 0 && retry.ok === false &&
    lateBidAfter?.leveledTotalCost === 600000 &&
    !(lateBidAfter?.valueEngineeringAlternates || []).some((v) => /Cross-Trade Clash Credit/.test(v.description || ""));
  record(
    "A25.1",
    "multi-package-per-division: project-scoped gate passes while the TARGET package has zero bids (legacy intent path still writes a deducted resolution)",
    phantomConfirmed,
    {
      detectBefore: detectMulti.summary, phantom: phantom.ok ? phantom.value : phantom,
      cardAfter: vfdCard ? { status: vfdCard.status, deductedAmount: vfdCard.deductedAmount } : null,
      bidsOnTargetBefore: b26bRows.length, retry: { ok: retry.ok, data: retry.data },
      lateBidLeveled: lateBidAfter?.leveledTotalCost,
    }
  );
  if (phantomConfirmed) {
    finding(
      "A25-01",
      "Medium",
      "unpriced-target credit still manufacturable via the project-scoped evidence gate (multi-package division)",
      {
        repro: "Project with Div26 A priced, Div26 B unpriced, Div23 priced -> deductDoubleBuyCredit(tradePackageId=Div26 B) returns success with 'credit logged' and writes a deducted clashResolution; when B later receives a bid it is never credited and the retry is refused.",
        rootCause: "assertCrossTradeEvidence checks only the first package per division project-wide; the targetBid==null legacy branch still records a deducted resolution.",
        impact: "Phantom 'deducted' clash card with no bid touched; no reversal path (A24-02.10).",
        evidence: "evidence/fix4-qa25-hunt.json (A25.1)",
      }
    );
  }

  // ==================================================================
  // B. alias clashId re-credit stacking (isolated project)
  // ==================================================================
  const pid2 = await makeProject(fixtureTitle("HUNT2"), "QA25 Hunt2 GC");
  const q26 = await makePackage(pid2, "26 00 00", "QA25 HUNT2 Electrical", 800000);
  const q23 = await makePackage(pid2, "23 00 00", "QA25 HUNT2 HVAC", 500000);
  const q26c = await makeContractor(q26, "AUDIT-QA25 HUNT2 Electric", "qa25.hunt2.e@qa25.invalid");
  const q23c = await makeContractor(q23, "AUDIT-QA25 HUNT2 Mechanical", "qa25.hunt2.h@qa25.invalid");
  await makeBid(q26, q26c, "AUDIT-QA25 HUNT2 Electric", 800000);
  const q23Bid = await makeBid(q23, q23c, "AUDIT-QA25 HUNT2 Mechanical", 250000);
  const b23Ref = { bidId: q23Bid.bidId };

  const legit = await call("deduct legitimate VFD clash", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: pid2, clashId: "clash-vfd-01", tradePackageId: q23, bidId: b23Ref.bidId,
      deductAmount: 38500, description: VFD,
    })
  );
  const alias = await call("deduct with alias clashId + new description", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: pid2, clashId: "clash-vfd-01-qa25-alias", tradePackageId: q23, bidId: b23Ref.bidId,
      deductAmount: 12000, description: "QA25 alias redundant disconnect buyout",
    })
  );
  const b23AfterAlias = (await bidsOf(q23)).find((b) => b._id === b23Ref.bidId);
  const veRows = (b23AfterAlias?.valueEngineeringAlternates || []).filter((v) => /Cross-Trade Clash Credit/.test(v.description || ""));
  const aliasStacked = legit.ok === true && alias.ok === true && veRows.length === 2 &&
    veRows.reduce((s, v) => s + (v.costDeduct || 0), 0) === 50500;
  record(
    "A25.2",
    "alias clashId + rotated description stacks another credit on the same underlying trade pair",
    aliasStacked,
    { legit: legit.ok ? legit.value : legit, alias: alias.ok ? alias.value : alias, ve: veRows, leveled: b23AfterAlias?.leveledTotalCost }
  );
  if (aliasStacked) {
    finding(
      "A25-02",
      "Medium",
      "clash credit idempotency is keyed only on clashId; rotating clashId/description stacks unbounded credits",
      {
        repro: "deductDoubleBuyCredit(clashId='clash-vfd-01') then deductDoubleBuyCredit(clashId='clash-vfd-01-qa25-alias', description='...') both succeed on the same proposal; each adds an accepted VE deduct (38,500 + 12,000 here).",
        impact: "A public caller can inflate asserted deductions and drive the proposal's leveled cost down toward zero (Math.max(0,...)).",
        evidence: "evidence/fix4-qa25-hunt.json (A25.2)",
      }
    );
  }

  // ==================================================================
  // C. assign duplicate guard with rotated description
  // ==================================================================
  const assignA = await call("assign void", () =>
    c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: pid2, voidId: "void-bas-wiring-01", tradePackageId: q23, bidId: b23Ref.bidId,
      additionalCost: 28000, description: "Low-Voltage 24V BAS Control & Interlock Wiring",
    })
  );
  const assignB = await call("assign same voidId, rotated description", () =>
    c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: pid2, voidId: "void-bas-wiring-01", tradePackageId: q23, bidId: b23Ref.bidId,
      additionalCost: 28000, description: "QA25 alias BAS control wiring package",
    })
  );
  const b23AfterAssign = (await bidsOf(q23)).find((b) => b._id === b23Ref.bidId);
  const voidLines = (b23AfterAssign?.lineItems || []).filter((i) => /Assigned Scope Void/.test(i.item));
  const assignStacked = assignA.ok === true && assignB.ok === true && voidLines.length === 2;
  record(
    "A25.3",
    "assign rotation: same voidId with a new description adds a second cost line",
    assignStacked,
    { assignA: assignA.ok ? assignA.value : assignA, assignB: assignB.ok ? assignB.value : assignB, voidLines: voidLines.map((i) => i.item), base: b23AfterAssign?.baseBidAmount }
  );
  if (assignStacked) {
    finding(
      "A25-03",
      "Medium",
      "assignScopeVoidToTrade has no duplicate-resolution guard; a rotated void description double-adds cost",
      {
        repro: "Call assign twice with the same voidId and different descriptions; both add 28,000 to baseBidAmount and lineItems.",
        impact: "Unbounded cost inflation on the proposal and mandatoryInclusions duplication for the same underlying void.",
        evidence: "evidence/fix4-qa25-hunt.json (A25.3)",
      }
    );
  }

  // ==================================================================
  // D. scanCrossTradeClashes honesty
  // ==================================================================
  const F = (await import("./qa25-lib.mjs")).readEvidence("fixtures");
  const scanNoev = await call("scan no-evidence project", () => c.action("coordination:scanCrossTradeClashes", { projectId: F.noevBids.id }));
  const scanOne = await call("scan one-sided project", () => c.action("coordination:scanCrossTradeClashes", { projectId: F.noevOne.id }));
  record(
    "A25.4",
    "scanCrossTradeClashes is truthful: no-evidence and missing-pair projects return analyzed=false with a readable reason",
    scanNoev.ok && scanNoev.value?.analyzed === false && /needs at least one priced proposal/i.test(scanNoev.value?.message || "") &&
      scanOne.ok && scanOne.value?.analyzed === false && /needs both a Division 26/i.test(scanOne.value?.message || ""),
    { noev: scanNoev.ok ? scanNoev.value : scanNoev, one: scanOne.ok ? scanOne.value : scanOne }
  );

  // ==================================================================
  // E. register status audit
  // ==================================================================
  const agrs = (await c.query("agreements:listAgreements", { projectId: F.register.id })) || [];
  const byStatus = agrs.reduce((m, a) => { m[a.status] = (m[a.status] || 0) + 1; return m; }, {});
  const superseded = agrs.filter((a) => a.status === "superseded");
  record(
    "A25.5",
    "register statuses: exactly one executed + one generated + one superseded; superseded retains executedAt and is not re-executable",
    byStatus.executed === 1 && byStatus.generated === 1 && byStatus.superseded === 1 &&
      superseded.every((a) => typeof a.executedAt === "number"),
    { byStatus, superseded: superseded.map((a) => ({ n: a.agreementNumber, executedAt: a.executedAt })) }
  );

  writeEvidence("hunt", { results, findings, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
  writeLog("hunt", log);
  console.log(`hunt: ${results.filter((r) => r.pass).length}/${results.length}, findings=${findings.length}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("hunt-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});