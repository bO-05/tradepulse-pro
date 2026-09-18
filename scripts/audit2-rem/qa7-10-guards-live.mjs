/**
 * QA7 live guards verification on prod (brainy-skunk-440) via public HTTP API.
 * Fixture: AUDIT-QA7-guards-2026-09-18 (created here, deleted here).
 * Evidence: evidence/fix4-qa7-10-guards-live.json
 */
import { client, call, expectOk, expectReject, writeEvidence, fixtureName, cliDump } from "./qa7-lib.mjs";

const c = client();
const prefix = fixtureName("guards");
const out = { ranAt: new Date().toISOString(), url: "https://brainy-skunk-440.convex.cloud", fixture: { title: prefix }, items: {}, cleanup: {} };
const ids = { packages: {}, contractors: {}, bids: {}, agreements: {} };

const guard = async (label, fn) => {
  const entry = await call(label, fn);
  return entry;
};

let projectId;
try {
  // ---------------------------------------------------------------- setup
  projectId = await c.mutation("projects:createProject", {
    title: prefix,
    location: "Austin, TX",
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: 5_000_000,
    targetCompletionWeeks: 52,
    specDocumentText: "QA7 guards fixture.",
    isDemoProject: false,
  });
  out.fixture.projectId = projectId;

  const mkPackage = async (csi, name, budget = 1_250_000) => {
    const id = await c.mutation("tradePackages:createTradePackage", {
      projectId,
      csiDivision: csi,
      tradeName: name,
      budgetEstimate: budget,
      scopeSummary: `QA7 ${name} scope.`,
      mandatoryInclusions: ["Code compliance"],
      bidDeadline: "2026-10-31",
    });
    ids.packages[csi] = id;
    return id;
  };
  const mkContractor = async (packageId, name, tag) => {
    const id = await c.mutation("contractors:createContractor", {
      tradePackageId: packageId,
      companyName: name,
      contactEmail: `${tag}@qa7.test`,
      phone: "+1 (512) 555-0100",
      licenseNumber: `TX-QA7-${tag.toUpperCase()}`,
      licenseStatus: "Active / Verified",
      sourceUrl: `https://qa7.test/${tag}`,
      rfqStatus: "invited",
    });
    ids.contractors[tag] = id;
    return id;
  };
  const mkBid = async (packageId, contractorId, name, base = 1_100_000) => {
    const res = await c.mutation("bids:submitDirectBid", {
      tradePackageId: packageId,
      contractorId,
      subcontractorName: name,
      baseBidAmount: base,
    });
    return res.bidId;
  };

  const p26 = await mkPackage("26 00 00", "QA7 Electrical");
  const p23 = await mkPackage("23 00 00", "QA7 Mechanical");
  const p22 = await mkPackage("22 00 00", "QA7 Plumbing Cascade");
  const p03 = await mkPackage("03 00 00", "QA7 Concrete Protected");
  const p05 = await mkPackage("05 00 00", "QA7 Adjustments");

  const ca = await mkContractor(p26, "QA7 Clean Co", "clean");
  const cb = await mkContractor(p26, "QA7 Bidder Co", "bidder");
  const cc = await mkContractor(p26, "QA7 Generated Co", "generated");
  const bB = await mkBid(p26, cb, "QA7 Bidder Co", 1_050_000);
  ids.bids.bB = bB;
  const bC = await mkBid(p26, cc, "QA7 Generated Co", 1_080_000);
  ids.bids.bC = bC;
  const agreementC = await c.mutation("agreements:generateAgreement", { bidId: bC, tradePackageId: p26 });
  ids.agreements.C = agreementC._id;

  // P23: executed agreement on bid B1; superseded agreement on bid B2
  const d1 = await mkContractor(p23, "QA7 Executed Co", "executed");
  const d2 = await mkContractor(p23, "QA7 Challenger Co", "challenger");
  const b1 = await mkBid(p23, d1, "QA7 Executed Co", 1_150_000);
  const b2 = await mkBid(p23, d2, "QA7 Challenger Co", 1_120_000);
  ids.bids.b1 = b1;
  ids.bids.b2 = b2;
  const ag2 = await c.mutation("agreements:generateAgreement", { bidId: b2, tradePackageId: p23 });
  const ag1 = await c.mutation("agreements:generateAgreement", { bidId: b1, tradePackageId: p23 });
  ids.agreements.B2 = ag2._id;
  ids.agreements.B1 = ag1._id;
  await c.mutation("agreements:executeAgreement", { agreementId: ag1._id });

  // P22: cascade package
  const e1 = await mkContractor(p22, "QA7 Cascade Co", "cascade");
  const bE = await mkBid(p22, e1, "QA7 Cascade Co", 1_000_000);
  ids.bids.bE = bE;
  const agE = await c.mutation("agreements:generateAgreement", { bidId: bE, tradePackageId: p22 });
  ids.agreements.E = agE._id;

  // P03: protected package (executed)
  const f1 = await mkContractor(p03, "QA7 Protected Co", "protected");
  const bF = await mkBid(p03, f1, "QA7 Protected Co", 1_010_000);
  ids.bids.bF = bF;
  const agF = await c.mutation("agreements:generateAgreement", { bidId: bF, tradePackageId: p03 });
  ids.agreements.F = agF._id;
  await c.mutation("agreements:executeAgreement", { agreementId: agF._id });

  // P05: adjustments
  const g1 = await mkContractor(p05, "QA7 Adjust Co", "adjust");
  const g2 = await mkContractor(p05, "QA7 Probe Co", "probe");
  const bG1 = await mkBid(p05, g1, "QA7 Adjust Co", 1_000_000);
  const bG2 = await mkBid(p05, g2, "QA7 Probe Co", 1_000_000);
  ids.bids.bG1 = bG1;
  ids.bids.bG2 = bG2;

  out.fixture.ids = JSON.parse(JSON.stringify(ids));

  // ---------------------------------------------------------------- Item 1
  // A real project id whose row is deleted: the handler-level guard must fire.
  const ghostProjectId = await c.mutation("projects:createProject", {
    title: `${prefix}-ghost`,
    location: "Austin, TX",
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: 1_000_000,
    targetCompletionWeeks: 12,
    specDocumentText: "QA7 ghost fixture.",
    isDemoProject: false,
  });
  await c.mutation("projects:deleteProject", { projectId: ghostProjectId });
  const item1Attempt = await guard("item1 createTradePackage nonexistent project", () =>
    c.mutation("tradePackages:createTradePackage", {
      projectId: ghostProjectId,
      csiDivision: "28 00 00",
      tradeName: "QA7 Orphan Attempt",
      budgetEstimate: 100_000,
      scopeSummary: "Must be rejected.",
      mandatoryInclusions: ["None"],
      bidDeadline: "2026-10-31",
    })
  );
  // Malformed id (bad checksum) must fail argument validation before any write.
  const malformedId = ghostProjectId.slice(0, -1) + (ghostProjectId.endsWith("a") ? "b" : "a");
  const item1Malformed = await guard("item1 createTradePackage malformed id", () =>
    c.mutation("tradePackages:createTradePackage", {
      projectId: malformedId,
      csiDivision: "28 00 00",
      tradeName: "QA7 Orphan Attempt 2",
      budgetEstimate: 100_000,
      scopeSummary: "Must be rejected.",
      mandatoryInclusions: ["None"],
      bidDeadline: "2026-10-31",
    })
  );
  await new Promise((r) => setTimeout(r, 800));
  const pkgScan = cliDump("tradePackages");
  const orphans = pkgScan.filter((p) => p.projectId === ghostProjectId || p.projectId === malformedId);
  out.items.item1 = {
    ghostProjectId,
    attempt: expectReject(item1Attempt, /project not found/i, "nonexistent projectId rejected"),
    malformed: {
      malformedId,
      rejected: !item1Malformed.ok,
      errorName: item1Malformed.name,
      clientVisibleData: item1Malformed.data,
    },
    orphanPackagesAfter: orphans.map((p) => p._id),
    orphanCount: orphans.length,
  };

  // ---------------------------------------------------------------- Item 2
  const delClean = await guard("item2 delete clean contractor", () =>
    c.mutation("contractors:deleteContractor", { contractorId: ca })
  );
  const delWithBid = await guard("item2 delete contractor with bid", () =>
    c.mutation("contractors:deleteContractor", { contractorId: cb })
  );
  const delGenerated = await guard("item2 delete contractor with generated agreement", () =>
    c.mutation("contractors:deleteContractor", { contractorId: cc })
  );
  const delExecuted = await guard("item2 delete contractor with executed agreement", () =>
    c.mutation("contractors:deleteContractor", { contractorId: d1 })
  );
  const stateAfter2 = {
    cleanGone: (await c.query("contractors:listByPackage", { tradePackageId: p26 })).every((x) => x._id !== ca),
    bidderStillThere: (await c.query("contractors:listByPackage", { tradePackageId: p26 })).some((x) => x._id === cb),
    generatedStillThere: (await c.query("contractors:listByPackage", { tradePackageId: p26 })).some((x) => x._id === cc),
    executedStillThere: (await c.query("contractors:listByPackage", { tradePackageId: p23 })).some((x) => x._id === d1),
    bidsStillThere: (await c.query("bids:listByPackage", { tradePackageId: p26 })).map((b) => b._id),
    agreementsStillThere: (await c.query("agreements:listAgreements", { projectId })).map((a) => `${a._id}:${a.status}`),
  };
  out.items.item2 = {
    cleanDelete: expectOk(delClean, "no-bid contractor deleted"),
    withBid: expectReject(delWithBid, /proposal\(s\) on file/i, "bid contractor rejected"),
    withGenerated: expectReject(delGenerated, /proposal\(s\) on file/i, "generated-agreement contractor rejected"),
    withExecuted: expectReject(delExecuted, /executed subcontract/i, "executed-agreement contractor rejected"),
    stateAfter: stateAfter2,
  };

  // ---------------------------------------------------------------- Item 3
  const delProtected = await guard("item3 delete package with executed", () =>
    c.mutation("tradePackages:deleteTradePackage", { tradePackageId: p03 })
  );
  const protectedState = {
    packageStillThere: (await c.query("tradePackages:getPackage", { tradePackageId: p03 })) !== null,
    bidStillThere: (await c.query("bids:listByPackage", { tradePackageId: p03 })).some((b) => b._id === bF),
    agreementStillThere: (await c.query("agreements:getAgreementByPackage", { tradePackageId: p03 }))?.status,
    contractorStillThere: (await c.query("contractors:listByPackage", { tradePackageId: p03 })).some((x) => x._id === f1),
  };
  const delCascade = await guard("item3 delete package without executed (cascade)", () =>
    c.mutation("tradePackages:deleteTradePackage", { tradePackageId: p22 })
  );
  await new Promise((r) => setTimeout(r, 800));
  const cascadeState = {
    packageGone: (await c.query("tradePackages:getPackage", { tradePackageId: p22 })) === null,
    bidsGone: (await c.query("bids:listByPackage", { tradePackageId: p22 })).length === 0,
    contractorsGone: (await c.query("contractors:listByPackage", { tradePackageId: p22 })).length === 0,
    agreementGone: (await c.query("agreements:getAgreementByPackage", { tradePackageId: p22 })) === null,
    orphanRows: {
      bids: cliDump("bids").filter((r) => r.tradePackageId === p22).length,
      contractors: cliDump("contractors").filter((r) => r.tradePackageId === p22).length,
      agreements: cliDump("agreements").filter((r) => r.tradePackageId === p22).length,
      conversations: cliDump("conversations").filter((r) => r.tradePackageId === p22).length,
    },
  };
  out.items.item3 = {
    protectedDelete: expectReject(delProtected, /executed subcontract/i, "executed package rejected"),
    protectedState,
    cascadeDelete: expectOk(delCascade, "cascade package deleted"),
    cascadeState,
  };

  // ---------------------------------------------------------------- Item 4
  const genOther = await guard("item4 generateAgreement other bid vs executed", () =>
    c.mutation("agreements:generateAgreement", { bidId: b2, tradePackageId: p23 })
  );
  const awardOther = await guard("item4 awardContract other bid vs executed", () =>
    c.mutation("bids:awardContract", { bidId: b2, tradePackageId: p23 })
  );
  const genSame = await guard("item4 regenerate same executed bid", () =>
    c.mutation("agreements:generateAgreement", { bidId: b1, tradePackageId: p23 })
  );
  const agreements23 = await c.query("agreements:listAgreements", { projectId });
  const item4State = {
    executedCount: agreements23.filter((a) => a.tradePackageId === p23 && a.status === "executed").length,
    winnerAwarded: (await c.query("bids:listByPackage", { tradePackageId: p23 })).find((b) => b._id === b1)?.isAwarded,
    challengerAwarded: (await c.query("bids:listByPackage", { tradePackageId: p23 })).find((b) => b._id === b2)?.isAwarded,
    packageStatus: (await c.query("tradePackages:getPackage", { tradePackageId: p23 }))?.status,
  };
  out.items.item4 = {
    generateOther: expectReject(genOther, /executed subcontract/i, "generate other bid rejected (ConvexError)"),
    awardOther: expectReject(awardOther, /executed subcontract/i, "award other bid rejected (ConvexError)"),
    regenerateSame: {
      ...expectReject(genSame, null, "same executed bid regenerated rejected"),
      note:
        genSame.name === "Error"
          ? "Plain Error: rejection confirmed live, but Convex redacts the message from HTTP clients; convex-test asserts /immutable/i on the server text."
          : "ConvexError message surfaced to client.",
      serverMessageVerifiedBy: "convex/qa7Guards.test.ts#QA7-4",
    },
    stateAfter: item4State,
  };

  // ---------------------------------------------------------------- Item 8
  const badCoi = await guard("item8 updateBidAdjustments bad COI", () =>
    c.mutation("bids:updateBidAdjustments", {
      bidId: bG1,
      identifiedExclusions: [],
      coiComplianceStatus: "totally-fine",
    })
  );
  const negExc = await guard("item8 updateBidAdjustments negative exclusion", () =>
    c.mutation("bids:updateBidAdjustments", {
      bidId: bG1,
      identifiedExclusions: [{ description: "Negative credit", costImpact: -50_000, severity: "critical" }],
    })
  );
  const negVe = await guard("item8 updateBidAdjustments negative VE", () =>
    c.mutation("bids:updateBidAdjustments", {
      bidId: bG1,
      identifiedExclusions: [],
      valueEngineeringAlternates: [{ description: "Negative deduct", costDeduct: -1, isAccepted: true }],
    })
  );
  const normal = await guard("item8 updateBidAdjustments normal", () =>
    c.mutation("bids:updateBidAdjustments", {
      bidId: bG1,
      identifiedExclusions: [
        { description: "Crane hoisting", costImpact: 12_000, severity: "moderate" },
        { description: "Waived cleanup", costImpact: 5_000, severity: "minor", isWaived: true },
      ],
      valueEngineeringAlternates: [
        { description: "LED alternate", costDeduct: 3_000, isAccepted: true },
        { description: "Not taken", costDeduct: 1_000, isAccepted: false },
      ],
      leadTimePenalty: 2_500,
      coiPenalty: 1_500,
      coiComplianceStatus: "deficiency_detected",
      longLeadEquipmentWeeks: 14,
    })
  );
  const expectedNormal = 1_000_000 + 12_000 + 2_500 + 1_500 - 3_000; // 1,013,000
  const storedG1 = (await c.query("bids:listByPackage", { tradePackageId: p05 })).find((b) => b._id === bG1);
  const probeCoi = await guard("PROBE updateBidLeveling bad COI (guard bypass)", () =>
    c.mutation("bids:updateBidLeveling", { bidId: bG2, coiComplianceStatus: "totally-fine" })
  );
  const probeNeg = await guard("PROBE updateBidLeveling negative exclusion (guard bypass)", () =>
    c.mutation("bids:updateBidLeveling", {
      bidId: bG2,
      identifiedExclusions: [{ description: "Negative scope credit", costImpact: -400_000, severity: "minor" }],
    })
  );
  const storedG2 = (await c.query("bids:listByPackage", { tradePackageId: p05 })).find((b) => b._id === bG2);
  const probeDirect = await guard("PROBE submitDirectBid negative exclusion + bad COI (guard bypass)", () =>
    c.mutation("bids:submitDirectBid", {
      tradePackageId: p05,
      contractorId: g2,
      subcontractorName: "QA7 Probe Co",
      baseBidAmount: 1_000_000,
      coiComplianceStatus: "totally-fine",
      identifiedExclusions: [{ description: "Negative scope credit", costImpact: -300_000, severity: "minor" }],
    })
  );
  const storedG2b = (await c.query("bids:listByPackage", { tradePackageId: p05 })).find((b) => b._id === bG2);
  out.items.item8 = {
    badCoi: expectReject(badCoi, /COI status/i, "invalid COI rejected"),
    negativeExclusion: expectReject(negExc, /zero or positive/i, "negative exclusion rejected"),
    negativeVe: expectReject(negVe, /zero or positive/i, "negative VE rejected"),
    normal: expectOk(normal, "normal adjustments applied"),
    normalMath: {
      expected: expectedNormal,
      returned: normal.ok ? normal.value?.leveledTotalCost : null,
      stored: storedG1?.leveledTotalCost,
      coiStored: storedG1?.coiComplianceStatus,
      match: normal.ok && normal.value?.leveledTotalCost === expectedNormal && storedG1?.leveledTotalCost === expectedNormal,
    },
    bypassProbes: {
      updateBidLevelingBadCoi: { result: probeCoi.ok ? "ACCEPTED" : "rejected", storedCoi: storedG2?.coiComplianceStatus },
      updateBidLevelingNegativeExclusion: { result: probeNeg.ok ? "ACCEPTED" : "rejected", storedLeveled: storedG2?.leveledTotalCost },
      submitDirectBidNegativeExclusionBadCoi: { result: probeDirect.ok ? "ACCEPTED" : "rejected", storedLeveled: storedG2b?.leveledTotalCost, storedCoi: storedG2b?.coiComplianceStatus },
    },
  };
} catch (err) {
  out.fatal = { message: err?.message ?? String(err) };
  console.error("FATAL", err);
} finally {
  // ---------------------------------------------------------------- cleanup
  // Sweep every project matching this fixture's title prefix (absorbs any
  // duplicate created by a lost-response retry).
  const allProjects = await c.query("projects:listProjects", {});
  const matches = allProjects.filter((p) => p.title === prefix || p.title.startsWith(prefix));
  const cleanupResults = [];
  for (const p of matches) {
    cleanupResults.push(await call(`cleanup deleteProject ${p._id}`, () => c.mutation("projects:deleteProject", { projectId: p._id })));
  }
  await new Promise((r) => setTimeout(r, 1200));
  const fixtureContractorIds = Object.values(ids.contractors);
  const fixtureBidIds = Object.values(ids.bids);
  const leftoverProjects = (await c.query("projects:listProjects", {})).filter((p) => p.title.startsWith(prefix));
  out.cleanup = {
    deletedProjects: cleanupResults.map((r) => `${r.label}:${r.ok ? "ok" : r.data ?? r.message}`),
    leftoverProjects: leftoverProjects.map((p) => p._id),
    tableRows: {
      packages: cliDump("tradePackages").filter((r) => matches.some((p) => p._id === r.projectId)).length,
      contractors: cliDump("contractors").filter((r) => fixtureContractorIds.includes(r._id)).length,
      bids: cliDump("bids").filter((r) => fixtureBidIds.includes(r._id)).length,
      agreements: cliDump("agreements").filter((r) => matches.some((p) => p._id === r.projectId)).length,
      auditLogs: cliDump("auditLogs").filter((r) => matches.some((p) => p._id === r.projectId)).length,
      clashResolutions: cliDump("clashResolutions").filter((r) => matches.some((p) => p._id === r.projectId)).length,
    },
  };
  writeEvidence("10-guards-live", out);
  const failed = Object.values(out.items).flatMap((i) => Object.values(i)).filter((v) => v && v.ok === false);
  console.log(`\nQA7-10 done. failedChecks=${failed.length} leftoverProjects=${JSON.stringify(out.cleanup.leftoverProjects)} tableRows=${JSON.stringify(out.cleanup.tableRows)}`);
  if (failed.length) console.log(failed.map((f) => `  FAIL ${f.label}: ${f.observed}`).join("\n"));
}