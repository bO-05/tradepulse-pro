import { client, readEvidence, writeEvidence, writeLog, sleep, projectSnapshot, zonedDate } from "./qa16-lib.mjs";

const c = client();
const fx = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const PA = fx.projectA;
const results = {};

async function logsFor(projectId, needle) {
  const logs = (await c.query("auditLogs:listRecentLogs", { projectId, limit: 500 })) || [];
  return logs.filter((l) => String(l.title).includes(needle) || String(l.description).includes(needle));
}

async function firePair(label, fn) {
  const started = Date.now();
  const [a, b] = await Promise.allSettled([fn(), fn()]);
  const norm = (r) =>
    r.status === "fulfilled"
      ? { ok: true, value: JSON.parse(JSON.stringify(r.value ?? null)) }
      : { ok: false, error: String(r.reason?.data ?? r.reason?.message ?? r.reason).split("\n")[0] };
  results[label] = { ms: Date.now() - started, first: norm(a), second: norm(b) };
  say(`[${label}] 1st=${JSON.stringify(results[label].first).slice(0, 160)}`);
  say(`[${label}] 2nd=${JSON.stringify(results[label].second).slice(0, 160)}`);
  await sleep(300);
}

async function main() {
  // --- award via generateAgreement double-fire (UI Award button path) ---
  await firePair("award.generateAgreement.x2", () =>
    c.mutation("agreements:generateAgreement", { bidId: PA.bids.b2, tradePackageId: PA.packages.p1 })
  );
  {
    const snap = await projectSnapshot(c, PA.id);
    const p1Agreements = snap.agreements.filter((a) => a.tradePackageId === PA.packages.p1);
    results.awardOutcome = {
      agreementRows: p1Agreements.length,
      statuses: p1Agreements.map((a) => a.status),
      awardedBids: snap.bids.filter((b) => b.tradePackageId === PA.packages.p1 && b.isAwarded).map((b) => b._id),
      awardLogs: (await logsFor(PA.id, "Subcontract")).map((l) => l.title),
    };
    say(`award outcome: rows=${p1Agreements.length} awarded=${results.awardOutcome.awardedBids.length} logs=${results.awardOutcome.awardLogs.join(" | ")}`);
  }

  const agreementId = results.awardOutcome.agreementRows ? (await c.query("agreements:getAgreementByPackage", { tradePackageId: PA.packages.p1 }))._id : null;

  // --- execute double-fire ---
  if (agreementId) {
    await firePair("execute.executeAgreement.x2", () =>
      c.mutation("agreements:executeAgreement", { agreementId })
    );
    const execLogs = await logsFor(PA.id, "Execution Status Recorded");
    results.executeOutcome = { executionLogs: execLogs.length, status: (await c.query("agreements:getAgreementByPackage", { tradePackageId: PA.packages.p1 })).status };
    say(`execute outcome: logs=${execLogs.length} status=${results.executeOutcome.status}`);
  }

  // --- void double-fire ---
  if (agreementId) {
    await firePair("void.voidExecutedAgreement.x2", () =>
      c.mutation("agreements:voidExecutedAgreement", { agreementId, reason: "AUDIT-QA16 double-fire void probe reason" })
    );
    const voidLogs = await logsFor(PA.id, "Executed Subcontract Voided");
    results.voidOutcome = { voidLogs: voidLogs.length, status: (await c.query("agreements:getAgreementByPackage", { tradePackageId: PA.packages.p1 })).status };
    say(`void outcome: logs=${voidLogs.length} status=${results.voidOutcome.status}`);
  }

  // --- direct bid double-fire (same contractor, same package) ---
  await firePair("bid.submitDirectBid.x2", () =>
    c.mutation("bids:submitDirectBid", {
      tradePackageId: PA.packages.p2,
      contractorId: PA.contractors.c3,
      subcontractorName: "AUDIT-QA16 HVAC Co",
      baseBidAmount: 785_000,
      longLeadEquipmentWeeks: 8,
      coiComplianceStatus: "compliant",
    })
  );
  {
    const snap = await projectSnapshot(c, PA.id);
    const p2Bids = snap.bids.filter((b) => b.tradePackageId === PA.packages.p2);
    const ingestLogs = await logsFor(PA.id, "Direct Bid Ingested");
    results.bidOutcome = {
      bidRows: p2Bids.length,
      revisions: p2Bids.map((b) => b.revisionNumber),
      leveled: p2Bids.map((b) => b.leveledTotalCost),
      ingestLogs: ingestLogs.length,
    };
    say(`bid outcome: rows=${p2Bids.length} revisions=${JSON.stringify(results.bidOutcome.revisions)} logs=${ingestLogs.length}`);
  }

  // --- dispatch double-fire on clean package P3 (needs a discovered contractor) ---
  await c.mutation("contractors:createContractor", {
    tradePackageId: PA.packages.p3,
    companyName: "AUDIT-QA16 Plumbing Bidder",
    contactEmail: "qa16.plumb@qa16.invalid",
    phone: "+1 (212) 555-0145",
    licenseNumber: "NY-QA16-0002",
    licenseStatus: "Active / Verified (QA16)",
    sourceUrl: "https://qa16.example.invalid/plumb",
    rfqStatus: "discovered",
  });
  await firePair("dispatch.dispatchRfqs.x2", () => c.mutation("rfq:dispatchRfqs", { tradePackageId: PA.packages.p3 }));
  {
    const dispatchLogs = await logsFor(PA.id, "RFQ Invitations Recorded");
    const p3ctrs = (await c.query("contractors:listByPackage", { tradePackageId: PA.packages.p3 })) || [];
    results.dispatchOutcome = {
      dispatchLogs: dispatchLogs.length,
      statuses: p3ctrs.map((x) => x.rfqStatus),
      dispatchedAt: p3ctrs.map((x) => x.dispatchedAt || null),
    };
    say(`dispatch outcome: logs=${dispatchLogs.length} statuses=${JSON.stringify(results.dispatchOutcome.statuses)}`);
  }

  // --- unaward double-fire (after generateAgreement re-award? P1 has voided agreement) ---
  await firePair("unaward.unawardContract.x2", () =>
    c.mutation("bids:unawardContract", { bidId: PA.bids.b2, tradePackageId: PA.packages.p1 })
  );
  {
    const unawardLogs = await logsFor(PA.id, "Subcontract Un-Awarded");
    results.unawardOutcome = { unawardLogs: unawardLogs.length };
    say(`unaward outcome: logs=${unawardLogs.length}`);
  }

  // --- assign scope void double-fire ---
  await firePair("assign.assignScopeVoidToTrade.x2", () =>
    c.mutation("coordination:assignScopeVoidToTrade", {
      projectId: PA.id,
      voidId: "qa16-void-1",
      tradePackageId: PA.packages.p1,
      additionalCost: 5_000,
      description: "AUDIT-QA16 orphaned low-voltage control wiring",
    })
  );
  {
    const assignLogs = await logsFor(PA.id, "Scope Void Assigned");
    const pkg = await c.query("tradePackages:getPackage", { tradePackageId: PA.packages.p1 });
    const bid = await c.query("bids:listByPackage", { tradePackageId: PA.packages.p1 });
    results.assignOutcome = {
      assignLogs: assignLogs.length,
      inclusionCount: (pkg.mandatoryInclusions || []).length,
      matchedItems: bid.flatMap((b) => (b.lineItems || []).filter((i) => String(i.item).includes("Assigned Scope Void"))).length,
    };
    say(`assign outcome: logs=${assignLogs.length} inclusions=${results.assignOutcome.inclusionCount} items=${results.assignOutcome.matchedItems}`);
  }

  // --- deduct credit double-fire ---
  await firePair("deduct.deductDoubleBuyCredit.x2", () =>
    c.mutation("coordination:deductDoubleBuyCredit", {
      projectId: PA.id,
      clashId: "qa16-clash-1",
      tradePackageId: PA.packages.p1,
      deductAmount: 3_000,
      description: "AUDIT-QA16 redundant VFD controller",
    })
  );
  {
    const deductLogs = await logsFor(PA.id, "Double-Buy Credit");
    results.deductOutcome = { rejections: [results["deduct.deductDoubleBuyCredit.x2"].first.ok, results["deduct.deductDoubleBuyCredit.x2"].second.ok], deductLogs: deductLogs.map((l) => l.title) };
    say(`deduct outcome: logs=${JSON.stringify(results.deductOutcome.deductLogs)}`);
  }

  // --- delete package double-fire ---
  await firePair("delete.deleteTradePackage.x2", () => c.mutation("tradePackages:deleteTradePackage", { tradePackageId: PA.packages.p4 }));
  results.deleteOutcome = { remainingP4: (await c.query("tradePackages:getPackage", { tradePackageId: PA.packages.p4 })) };

  // --- TZ contract-date check (server UTC date vs zoned local date) ---
  const tzProbe = {};
  for (const tz of ["America/New_York", "Asia/Tokyo", "Pacific/Kiritimati", "America/Adak"]) {
    tzProbe[tz] = zonedDate(new Date(), tz);
  }
  const anyAgreement = (await c.query("agreements:listAgreements", { projectId: PA.id }))[0];
  const dateLine = String(anyAgreement?.contractText || "").split("\n").find((l) => /Date:|20\d\d/.test(l)) || null;
  results.contractDateProbe = {
    utcDate: new Date().toISOString().slice(0, 10),
    zonedDates: tzProbe,
    agreementNumber: anyAgreement?.agreementNumber || null,
    dateLine,
    contractTextHasUtcDate: anyAgreement ? String(anyAgreement.contractText).includes(new Date().toISOString().slice(0, 10)) : null,
  };
  say(`contract date probe: utc=${results.contractDateProbe.utcDate} NY=${tzProbe["America/New_York"]} line="${dateLine}"`);

  writeEvidence("idempotency", results);
  writeLog("idempotency", log);
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  writeLog("idempotency-crash", [String(e && e.stack ? e.stack : e)]);
  process.exit(1);
});