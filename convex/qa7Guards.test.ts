/// <reference types="vite/client" />
/**
 * QA7 independent verification harness (deterministic, no network).
 * Covers the guard fixes deployed to brainy-skunk-440; live HTTP runs are
 * executed separately by the portable QA harness (scripts/qa/) as well as the local raw harness.
 */
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { sanitizeBidLevelingOutput, applyExplicitExclusionAmounts } from "./llmRouter";

const modules = import.meta.glob("./**/*.ts");
type T = ReturnType<typeof convexTest>;

async function makeProject(t: T, title: string) {
  return await t.mutation(api.projects.createProject, {
    title,
    location: "Austin, TX",
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: 2_500_000,
    targetCompletionWeeks: 52,
    specDocumentText: "QA7 verification specification text.",
    isDemoProject: false,
  });
}

async function makePackage(t: T, projectId: any, csi = "26 00 00", budget = 1_250_000) {
  return await t.mutation(api.tradePackages.createTradePackage, {
    projectId,
    csiDivision: csi,
    tradeName: `QA7 Division ${csi}`,
    budgetEstimate: budget,
    scopeSummary: "QA7 verification scope.",
    mandatoryInclusions: ["Code compliance"],
    bidDeadline: "2026-10-31",
  });
}

async function makeContractor(t: T, tradePackageId: any, name: string) {
  return await t.mutation(api.contractors.createContractor, {
    tradePackageId,
    companyName: name,
    contactEmail: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@qa7.test`,
    phone: "+1 (512) 555-0100",
    licenseNumber: `TX-QA7-${name.length}`,
    licenseStatus: "Active / Verified",
    sourceUrl: `https://qa7.test/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    rfqStatus: "invited",
  });
}

async function makeBid(t: T, packageId: any, contractorId: any, name: string, base = 1_100_000) {
  const res: any = await t.mutation(api.bids.submitDirectBid, {
    tradePackageId: packageId,
    contractorId,
    subcontractorName: name,
    baseBidAmount: base,
  });
  return res.bidId;
}

async function insertConversation(t: T, packageId: any, contractorId: any, subject = "QA7 subject") {
  return await t.run(async (ctx) =>
    await ctx.db.insert("conversations", {
      tradePackageId: packageId,
      contractorId,
      threadId: `qa7-th-${Date.now()}-${Math.random()}`,
      inboundSubject: subject,
      inboundQuestion: "QA7 verification question?",
      autonomousReply: "QA7 verification reply.",
      confidenceScore: 0.9,
      status: "clarified",
      timestamp: Date.now(),
    })
  );
}

async function rawByPackage(t: T, table: any, packageId: any) {
  return await t.run(async (ctx) =>
    await ctx.db
      .query(table)
      .withIndex("by_package" as any, (q: any) => q.eq("tradePackageId", packageId))
      .collect()
  );
}

// ---------------------------------------------------------------- Item 1
test("QA7-1: createTradePackage rejects a nonexistent projectId and inserts nothing", async () => {
  const t = convexTest(schema, modules);
  const projectId = await makeProject(t, "QA7 Item1 Project");
  await t.run(async (ctx) => await ctx.db.delete(projectId));
  await expect(
    t.mutation(api.tradePackages.createTradePackage, {
      projectId,
      csiDivision: "28 00 00",
      tradeName: "QA7 Orphan Attempt",
      budgetEstimate: 100_000,
      scopeSummary: "Must be rejected.",
      mandatoryInclusions: ["None"],
      bidDeadline: "2026-10-31",
    })
  ).rejects.toThrow(/project not found/i);
  const all = await t.run(async (ctx) => await ctx.db.query("tradePackages").collect());
  expect(all.length).toBe(0);
});

// ---------------------------------------------------------------- Item 2
test("QA7-2a: deleteContractor refuses a contractor with a proposal and preserves bid + conversation", async () => {
  const t = convexTest(schema, modules);
  const projectId = await makeProject(t, "QA7 Item2a Project");
  const packageId = await makePackage(t, projectId);
  const contractorId = await makeContractor(t, packageId, "QA7 Bidder");
  const bidId = await makeBid(t, packageId, contractorId, "QA7 Bidder");
  const conversationId = await insertConversation(t, packageId, contractorId);

  await expect(t.mutation(api.contractors.deleteContractor, { contractorId })).rejects.toThrow(
    /proposal\(s\) on file/i
  );

  expect(await t.run(async (ctx) => await ctx.db.get(contractorId))).not.toBeNull();
  expect(await t.run(async (ctx) => await ctx.db.get(bidId))).not.toBeNull();
  expect(await t.run(async (ctx) => await ctx.db.get(conversationId))).not.toBeNull();
});

test("QA7-2b: deleteContractor refuses an executed subcontract and preserves bid + agreement + conversation", async () => {
  const t = convexTest(schema, modules);
  const projectId = await makeProject(t, "QA7 Item2b Project");
  const packageId = await makePackage(t, projectId);
  const contractorId = await makeContractor(t, packageId, "QA7 Executed");
  const bidId = await makeBid(t, packageId, contractorId, "QA7 Executed");
  const agreement: any = await t.mutation(api.agreements.generateAgreement, { bidId, tradePackageId: packageId });
  await t.mutation(api.agreements.executeAgreement, { agreementId: agreement._id });
  const conversationId = await insertConversation(t, packageId, contractorId, "QA7 executed thread");

  await expect(t.mutation(api.contractors.deleteContractor, { contractorId })).rejects.toThrow(
    /executed subcontract/i
  );

  const stored: any = await t.run(async (ctx) => await ctx.db.get(agreement._id));
  expect(stored?.status).toBe("executed");
  expect(await t.run(async (ctx) => await ctx.db.get(bidId))).not.toBeNull();
  expect(await t.run(async (ctx) => await ctx.db.get(conversationId))).not.toBeNull();
});

test("QA7-2c: deleteContractor succeeds when no bids exist and cascades its conversations only", async () => {
  const t = convexTest(schema, modules);
  const projectId = await makeProject(t, "QA7 Item2c Project");
  const packageId = await makePackage(t, projectId);
  const cleanId = await makeContractor(t, packageId, "QA7 Clean");
  const bidderId = await makeContractor(t, packageId, "QA7 Keep");
  const bidId = await makeBid(t, packageId, bidderId, "QA7 Keep");
  const cleanConvo = await insertConversation(t, packageId, cleanId, "QA7 clean thread");
  const keepConvo = await insertConversation(t, packageId, bidderId, "QA7 keep thread");

  const result: any = await t.mutation(api.contractors.deleteContractor, { contractorId: cleanId });
  expect(result.success).toBe(true);

  expect(await t.run(async (ctx) => await ctx.db.get(cleanId))).toBeNull();
  expect(await t.run(async (ctx) => await ctx.db.get(cleanConvo))).toBeNull();
  expect(await t.run(async (ctx) => await ctx.db.get(bidderId))).not.toBeNull();
  expect(await t.run(async (ctx) => await ctx.db.get(bidId))).not.toBeNull();
  expect(await t.run(async (ctx) => await ctx.db.get(keepConvo))).not.toBeNull();
});

// ---------------------------------------------------------------- Item 3
test("QA7-3a: deleteTradePackage refuses an executed subcontract and preserves children", async () => {
  const t = convexTest(schema, modules);
  const projectId = await makeProject(t, "QA7 Item3a Project");
  const packageId = await makePackage(t, projectId);
  const contractorId = await makeContractor(t, packageId, "QA7 Package Guard");
  const bidId = await makeBid(t, packageId, contractorId, "QA7 Package Guard");
  const agreement: any = await t.mutation(api.agreements.generateAgreement, { bidId, tradePackageId: packageId });
  await t.mutation(api.agreements.executeAgreement, { agreementId: agreement._id });

  await expect(t.mutation(api.tradePackages.deleteTradePackage, { tradePackageId: packageId })).rejects.toThrow(
    /executed subcontract/i
  );

  expect(await t.run(async (ctx) => await ctx.db.get(packageId))).not.toBeNull();
  expect(await t.run(async (ctx) => await ctx.db.get(bidId))).not.toBeNull();
  expect(await t.run(async (ctx) => await ctx.db.get(agreement._id))).not.toBeNull();
  expect(await t.run(async (ctx) => await ctx.db.get(contractorId))).not.toBeNull();
});

test("QA7-3b: deleteTradePackage cascades bids/agreements/contractors/conversations when no executed contract", async () => {
  const t = convexTest(schema, modules);
  const projectId = await makeProject(t, "QA7 Item3b Project");
  const packageId = await makePackage(t, projectId);
  const contractorId = await makeContractor(t, packageId, "QA7 Cascade");
  const bidId = await makeBid(t, packageId, contractorId, "QA7 Cascade");
  const agreement: any = await t.mutation(api.agreements.generateAgreement, { bidId, tradePackageId: packageId });
  const conversationId = await insertConversation(t, packageId, contractorId);

  const result: any = await t.mutation(api.tradePackages.deleteTradePackage, { tradePackageId: packageId });
  expect(result.success).toBe(true);

  expect(await t.run(async (ctx) => await ctx.db.get(packageId))).toBeNull();
  expect(await t.run(async (ctx) => await ctx.db.get(bidId))).toBeNull();
  expect(await t.run(async (ctx) => await ctx.db.get(agreement._id))).toBeNull();
  expect(await t.run(async (ctx) => await ctx.db.get(contractorId))).toBeNull();
  expect(await t.run(async (ctx) => await ctx.db.get(conversationId))).toBeNull();
});

// ---------------------------------------------------------------- Item 4
test("QA7-4: executed agreement cannot be superseded; same-bid regeneration rejects with immutability", async () => {
  const t = convexTest(schema, modules);
  const projectId = await makeProject(t, "QA7 Item4 Project");
  const packageId = await makePackage(t, projectId);
  const firstContractor = await makeContractor(t, packageId, "QA7 Winner");
  const secondContractor = await makeContractor(t, packageId, "QA7 Challenger");
  const firstBid = await makeBid(t, packageId, firstContractor, "QA7 Winner");
  const secondBid = await makeBid(t, packageId, secondContractor, "QA7 Challenger", 950_000);
  // Award the challenger, then re-award the winner and execute: the challenger
  // keeps a superseded agreement, which is the only publicly reachable state
  // that lets awardContract reach its executed-agreement guard.
  const secondAgreement: any = await t.mutation(api.agreements.generateAgreement, {
    bidId: secondBid,
    tradePackageId: packageId,
  });
  const firstAgreement: any = await t.mutation(api.agreements.generateAgreement, {
    bidId: firstBid,
    tradePackageId: packageId,
  });
  await t.mutation(api.agreements.executeAgreement, { agreementId: firstAgreement._id });

  await expect(
    t.mutation(api.agreements.generateAgreement, { bidId: secondBid, tradePackageId: packageId })
  ).rejects.toThrow(/executed subcontract/i);
  await expect(
    t.mutation(api.bids.awardContract, { bidId: secondBid, tradePackageId: packageId })
  ).rejects.toThrow(/executed subcontract/i);
  await expect(
    t.mutation(api.agreements.generateAgreement, { bidId: firstBid, tradePackageId: packageId })
  ).rejects.toThrow(/immutable/i);

  const agreements: any[] = await rawByPackage(t, "agreements", packageId);
  expect(agreements.filter((a: any) => a.status === "executed").length).toBe(1);
  expect(agreements.find((a: any) => a._id === secondAgreement._id)?.status).toBe("superseded");
  expect(await t.run(async (ctx) => ((await ctx.db.get(firstBid)) as any)?.isAwarded)).toBe(true);
  expect(await t.run(async (ctx) => ((await ctx.db.get(secondBid)) as any)?.isAwarded)).toBe(false);
});

// ---------------------------------------------------------------- Item 6
test("QA7-6: deadline monitor leaves zero-bid packages open, advances bid packages, and flags once", async () => {
  const t = convexTest(schema, modules);
  const projectId = await makeProject(t, "QA7 Item6 Project");
  const emptyPackage = await makePackage(t, projectId, "26 00 00");
  const bidPackage = await makePackage(t, projectId, "23 00 00");
  const contractorId = await makeContractor(t, bidPackage, "QA7 Cron Bidder");
  await makeBid(t, bidPackage, contractorId, "QA7 Cron Bidder");

  await t.run(async (ctx) => {
    await ctx.db.patch(emptyPackage, { bidDeadline: "2020-01-01", status: "rfqs_dispatched" });
    await ctx.db.patch(bidPackage, { bidDeadline: "2020-01-01", status: "rfqs_dispatched" });
  });

  // Internal scheduled cron: idempotent no-bids flag
  await t.mutation(internal.crons.monitorBidDeadlines, {});
  await t.mutation(internal.crons.monitorBidDeadlines, {});

  const emptyAfter = await t.run(async (ctx) => await ctx.db.get(emptyPackage));
  expect(emptyAfter?.status).toBe("rfqs_dispatched");
  const emptyLogs = await rawByPackage(t, "auditLogs", emptyPackage);
  expect(emptyLogs.filter((l: any) => l.title.startsWith("Deadline passed with no bids")).length).toBe(1);
  const bidAfter = await t.run(async (ctx) => await ctx.db.get(bidPackage));
  expect(bidAfter?.status).toBe("leveling");

  // Public manual trigger: same safety, no duplicate no-bids rows
  await t.run(async (ctx) => {
    await ctx.db.patch(emptyPackage, { bidDeadline: "2020-01-01", status: "rfqs_dispatched" });
    await ctx.db.patch(bidPackage, { bidDeadline: "2020-01-01", status: "rfqs_dispatched" });
  });
  const first: any = await t.mutation(api.crons.runDeadlineMonitorNow, { projectId });
  const second: any = await t.mutation(api.crons.runDeadlineMonitorNow, { projectId });
  expect(first.monitoredCount).toBe(2);
  expect(first.transitionedCount).toBe(1);
  // Second run: the bid package is already leveling, so nothing re-transitions.
  expect(second.transitionedCount).toBe(0);
  expect((await t.run(async (ctx) => await ctx.db.get(emptyPackage)))?.status).toBe("rfqs_dispatched");
  expect((await t.run(async (ctx) => await ctx.db.get(bidPackage)))?.status).toBe("leveling");
  const emptyLogs2 = await rawByPackage(t, "auditLogs", emptyPackage);
  expect(emptyLogs2.filter((l: any) => l.title.startsWith("Deadline passed with no bids")).length).toBe(1);
});

// ---------------------------------------------------------------- Item 7
test("QA7-7: deleteProject removes clashResolutions and every project child", async () => {
  const t = convexTest(schema, modules);
  const projectId = await makeProject(t, "QA7 Item7 Project");
  const packageId = await makePackage(t, projectId);
  const contractorId = await makeContractor(t, packageId, "QA7 Clash");
  const bidId = await makeBid(t, packageId, contractorId, "QA7 Clash");
  await t.mutation(api.agreements.generateAgreement, { bidId, tradePackageId: packageId });
  await insertConversation(t, packageId, contractorId, "QA7 clash thread");
  // A21-01: cross-trade credits require priced proposals on both sides.
  const hvacPackageId = await makePackage(t, projectId, "23 00 00", 1_200_000);
  const hvacContractorId = await makeContractor(t, hvacPackageId, "QA7 Clash HVAC");
  await makeBid(t, hvacPackageId, hvacContractorId, "QA7 Clash HVAC", 1_150_000);
  await t.mutation(api.coordination.deductDoubleBuyCredit, {
    projectId,
    clashId: "clash-vfd-01",
    tradePackageId: packageId,
    deductAmount: 1_500,
    description: "QA7 orphan probe",
  });
  expect(
    await t.run(async (ctx) =>
      await ctx.db.query("clashResolutions").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect()
    )
  ).toHaveLength(1);

  const result: any = await t.mutation(api.projects.deleteProject, { projectId });
  expect(result.success).toBe(true);

  const remaining = await t.run(async (ctx) => ({
    clash: await ctx.db.query("clashResolutions").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect(),
    projects: await ctx.db.query("projects").withIndex("by_demo", (q) => q.eq("isDemoProject", false)).collect(),
    packages: await ctx.db.query("tradePackages").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect(),
    contractors: await ctx.db.query("contractors").collect(),
    bids: await ctx.db.query("bids").collect(),
    agreements: await ctx.db.query("agreements").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect(),
    conversations: await ctx.db.query("conversations").collect(),
    logs: await ctx.db.query("auditLogs").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect(),
  }));
  expect(remaining.clash).toHaveLength(0);
  expect(remaining.projects.some((p: any) => p._id === projectId)).toBe(false);
  expect(remaining.packages).toHaveLength(0);
  expect(remaining.contractors).toHaveLength(0);
  expect(remaining.bids).toHaveLength(0);
  expect(remaining.agreements).toHaveLength(0);
  expect(remaining.conversations).toHaveLength(0);
  expect(remaining.logs).toHaveLength(0);
});

// ---------------------------------------------------------------- Item 8
test("QA7-8: updateBidAdjustments validates inputs, rejects negatives, and recomputes exactly", async () => {
  const t = convexTest(schema, modules);
  const projectId = await makeProject(t, "QA7 Item8 Project");
  const packageId = await makePackage(t, projectId);
  const contractorId = await makeContractor(t, packageId, "QA7 Adjust");
  const bidId = await makeBid(t, packageId, contractorId, "QA7 Adjust", 1_000_000);

  await expect(
    t.mutation(api.bids.updateBidAdjustments, {
      bidId,
      identifiedExclusions: [],
      coiComplianceStatus: "totally-fine",
    })
  ).rejects.toThrow(/COI status/i);
  await expect(
    t.mutation(api.bids.updateBidAdjustments, {
      bidId,
      identifiedExclusions: [{ description: "Negative credit", costImpact: -50_000, severity: "critical" }],
    })
  ).rejects.toThrow(/zero or positive/i);
  await expect(
    t.mutation(api.bids.updateBidAdjustments, {
      bidId,
      identifiedExclusions: [],
      valueEngineeringAlternates: [{ description: "Negative deduct", costDeduct: -1, isAccepted: true }],
    })
  ).rejects.toThrow(/zero or positive/i);

  const result: any = await t.mutation(api.bids.updateBidAdjustments, {
    bidId,
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
  });
  const expected = 1_000_000 + 12_000 + 2_500 + 1_500 - 3_000;
  expect(result.leveledTotalCost).toBe(expected);
  const stored: any = await t.run(async (ctx) => await ctx.db.get(bidId));
  expect(stored.leveledTotalCost).toBe(expected);
  expect(stored.coiComplianceStatus).toBe("deficiency_detected");
  expect(stored.baseBidAmount).toBe(1_000_000);
  expect(stored.revisionNumber).toBe(1);
});

// ------------------------------------------------- A6-05r / A6-54 (critical)
test("A6-05r: insertParsedBid derives the schedule penalty from weeks + division baseline and ignores any supplied dollar amount", async () => {
  const t = convexTest(schema, modules);
  const projectId = await makeProject(t, "A6 LeadTime Project");
  const packageId = await makePackage(t, projectId, "22 00 00", 3_000_000);
  const contractorId = await makeContractor(t, packageId, "A6 Plumbing Bidder");

  // The producer tries to understate the penalty as $0; the engine must recompute.
  await t.mutation(internal.bids.insertParsedBid, {
    tradePackageId: packageId,
    contractorId,
    subcontractorName: "A6 Plumbing Bidder",
    baseBidAmount: 837_450,
    lineItems: [],
    identifiedExclusions: [],
    valueEngineeringAlternates: [],
    longLeadEquipmentWeeks: 17,
    leadTimePenalty: 0,
    coiComplianceStatus: "compliant",
    coiPenalty: 0,
    leveledTotalCost: 0,
  });
  const bids: any = await rawByPackage(t, "bids", packageId);
  expect(bids.length).toBe(1);
  expect(bids[0].leadTimeTargetWeeks).toBe(16);
  expect(bids[0].leadTimePenalty).toBe(6_000);
  expect(bids[0].leveledTotalCost).toBe(837_450 + 6_000);

  // An explicit GC target wins (17 wks vs a 12-wk target is 5 × $6,000).
  await t.mutation(internal.bids.insertParsedBid, {
    tradePackageId: packageId,
    contractorId,
    subcontractorName: "A6 Plumbing Bidder",
    baseBidAmount: 837_450,
    lineItems: [],
    identifiedExclusions: [],
    valueEngineeringAlternates: [],
    longLeadEquipmentWeeks: 17,
    leadTimePenalty: 123,
    leadTimeTargetWeeks: 12,
    coiComplianceStatus: "compliant",
    coiPenalty: 0,
    leveledTotalCost: 0,
  });
  const bids2: any = await rawByPackage(t, "bids", packageId);
  expect(bids2[0].leadTimeTargetWeeks).toBe(12);
  expect(bids2[0].leadTimePenalty).toBe(30_000);
  expect(bids2[0].leveledTotalCost).toBe(837_450 + 30_000);
});

test("A6-05r: the extraction sanitizer recomputes penalties deterministically per division and drops model arithmetic", async () => {
  const input = {
    baseBidAmount: 500_000,
    longLeadEquipmentWeeks: 16,
    leadTimePenalty: 999_999, // adversarial model value must be ignored
    coiComplianceStatus: "compliant",
    coiPenalty: 0,
    identifiedExclusions: [],
  };
  const div26 = sanitizeBidLevelingOutput({ ...input }, { division: "26 00 00" });
  expect(div26.leadTimeTargetWeeks).toBe(12);
  expect(div26.leadTimePenalty).toBe(24_000);
  expect(div26.leveledTotalCost).toBe(524_000);

  const div26Again = sanitizeBidLevelingOutput({ ...input }, { division: "26 00 00" });
  expect(div26Again.leadTimePenalty).toBe(div26.leadTimePenalty);
  expect(div26Again.leveledTotalCost).toBe(div26.leveledTotalCost);

  const div22 = sanitizeBidLevelingOutput(
    { ...input, longLeadEquipmentWeeks: 17, leadTimePenalty: 0 },
    { division: "22 11 23" }
  );
  expect(div22.leadTimeTargetWeeks).toBe(16);
  expect(div22.leadTimePenalty).toBe(6_000);
  expect(div22.leveledTotalCost).toBe(506_000);
});

test("A6-54 class: stated exclusion amounts win over ASPE/RSMeans benchmarks", () => {
  const exclusions = [
    { description: "Rooftop crane pick and rigging to cooling tower deck excluded (GC crane required)", costImpact: 48_000 },
    { description: "UL 1479 floor and wall through-penetration rated firestopping excluded (by others)", costImpact: 22_000 },
    { description: "IBC Section 1613 engineered structural seismic bracing excluded (by others)", costImpact: 55_000 },
  ];
  const text =
    "Exclusions: crane rigging and hoisting excluded ($18,600); firestopping excluded ($9,950); seismic bracing excluded ($7,400).";
  const priced = applyExplicitExclusionAmounts(exclusions, text);
  expect(priced.map((e) => e.costImpact)).toEqual([18_600, 9_950, 7_400]);
  // Unpriced exclusions keep the benchmark values (and nothing is invented).
  const unpriced = applyExplicitExclusionAmounts(
    [{ description: "Crane rigging and hoisting excluded", costImpact: 48_000 }],
    "Crane rigging and hoisting excluded (by others)."
  );
  expect(unpriced[0].costImpact).toBe(48_000);
  expect(applyExplicitExclusionAmounts([], text)).toEqual([]);
});

test("A7CONV-A-01: an included booster pump is not priced as an exclusion just because 'excluded' appears elsewhere", async () => {
  const t = convexTest(schema, modules);
  const res: any = await t.action(internal.llmRouter.executeReasoning, {
    taskType: "bid_leveling",
    division: "22 00 00",
    prompt: [
      "PROPOSAL",
      "Subcontractor: Cascade Mechanical Contractors LLC",
      "Base Bid Price: $613,777.13",
      "Scope: complete Division 22 plumbing scope including a triplex booster pump system with factory certified startup.",
      "Exclusions: crane rigging and hoisting excluded ($18,600); firestopping excluded ($9,950); seismic bracing excluded ($7,400).",
      "Lead time: 17 weeks.",
      "Insurance: umbrella liability endorsement excluded.",
    ].join("\n"),
  });
  const exclusions = res.parsedJson?.identifiedExclusions || [];
  const text = JSON.stringify(exclusions);
  // The included booster-pump scope must not be fabricated into an exclusion.
  expect(text).not.toMatch(/BOOSTER/i);
  // Stated amounts still win over benchmarks.
  const impacts = exclusions.map((e: any) => e.costImpact);
  expect(impacts).toEqual(expect.arrayContaining([18_600, 9_950, 7_400]));
});