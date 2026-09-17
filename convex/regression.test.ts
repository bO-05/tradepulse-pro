/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function createProject(t: ReturnType<typeof convexTest>, title = "Regression Project") {
  return await t.mutation(api.projects.createProject, {
    title,
    location: "Austin, TX",
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: 2_500_000,
    targetCompletionWeeks: 52,
    specDocumentText: "Regression specification text.",
    isDemoProject: false,
  });
}

async function createPackage(t: ReturnType<typeof convexTest>, projectId: any) {
  return await t.mutation(api.tradePackages.createTradePackage, {
    projectId,
    csiDivision: "26 00 00",
    tradeName: "Electrical & Lighting Systems",
    budgetEstimate: 1_250_000,
    scopeSummary: "Switchgear, distribution, and branch power.",
    mandatoryInclusions: ["Crane hoisting", "Seismic bracing"],
    bidDeadline: "2026-10-31",
  });
}

async function createContractor(t: ReturnType<typeof convexTest>, tradePackageId: any) {
  return await t.mutation(api.contractors.createContractor, {
    tradePackageId,
    companyName: "Regression Electric LLC",
    contactEmail: "estimating@regression-electric.test",
    phone: "+1 (512) 555-0177",
    licenseNumber: "TX-REG-0001",
    licenseStatus: "Active / Verified",
    sourceUrl: "https://regression-electric.test",
    rfqStatus: "invited",
  });
}

test("F1: created project persists in listProjects", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t, "F1 Persistence Project");
  const projects = await t.query(api.projects.listProjects, {});
  expect(projects.some((p) => p._id === projectId && p.title === "F1 Persistence Project")).toBe(true);
});

test("F3/F4: saveFileRecord accepts real storage ids and persists records", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t, "F4 Upload Project");
  const storageId = await t.run(async (ctx) =>
    await ctx.storage.store(new Blob(["spec body for regression"], { type: "text/plain" }))
  );
  const fileId = await t.mutation(api.files.saveFileRecord, {
    projectId,
    storageId,
    fileName: "26_00_00_Regression_Spec.txt",
    fileType: "spec",
    fileSize: 25,
    uploadedBy: "Regression Test",
    contentType: "text/plain",
  });
  expect(fileId).toBeTruthy();
  const files = await t.query(api.files.listFilesByProject, { projectId });
  expect(files.some((f) => f._id === fileId && f.fileName === "26_00_00_Regression_Spec.txt")).toBe(true);
});

test("F3: legal addendum generates and persists a file record with zero pending RFIs", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t, "F3 Addendum Project");
  const result: any = await t.action(api.files.generatePreBidAddendum, { projectId });
  expect(result.success).toBe(true);
  expect(result.storageId).toBeTruthy();
  const files = await t.query(api.files.listFilesByProject, { projectId });
  expect(files.some((f) => f.fileType === "addendum")).toBe(true);
});

test("F9: invalid CSI divisions are rejected and valid ones accepted", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t, "F9 CSI Project");
  await expect(
    t.mutation(api.tradePackages.createTradePackage, {
      projectId,
      csiDivision: "99 99 99",
      tradeName: "Invalid Division",
      budgetEstimate: 100_000,
      scopeSummary: "Should be rejected.",
      mandatoryInclusions: ["None"],
      bidDeadline: "2026-10-31",
    })
  ).rejects.toThrow();
  const pkgId = await createPackage(t, projectId);
  expect(pkgId).toBeTruthy();
});

test("F9: implausible bid amounts are rejected; revisions increment", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t, "Bid Floor Project");
  const packageId = await createPackage(t, projectId);
  const contractorId = await createContractor(t, packageId);

  await expect(
    t.mutation(api.bids.submitDirectBid, {
      tradePackageId: packageId,
      contractorId,
      subcontractorName: "Regression Electric LLC",
      baseBidAmount: 1,
    })
  ).rejects.toThrow();

  await expect(
    t.mutation(api.bids.submitDirectBid, {
      tradePackageId: packageId,
      contractorId,
      subcontractorName: "Regression Electric LLC",
      baseBidAmount: 999_999_999,
    })
  ).rejects.toThrow();

  await t.mutation(api.bids.submitDirectBid, {
    tradePackageId: packageId,
    contractorId,
    subcontractorName: "Regression Electric LLC",
    baseBidAmount: 1_100_000,
  });
  await t.mutation(api.bids.submitDirectBid, {
    tradePackageId: packageId,
    contractorId,
    subcontractorName: "Regression Electric LLC",
    baseBidAmount: 1_150_000,
  });

  const bids = await t.query(api.bids.listByPackage, { tradePackageId: packageId });
  const bid = bids.find((b) => b.contractorId === contractorId);
  expect(bid?.revisionNumber).toBe(2);
  expect(bid?.lastRevisedAt).toBeTypeOf("number");
});

test("F5: executed agreements block bid changes", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t, "Executed Agreement Project");
  const packageId = await createPackage(t, projectId);
  const contractorId = await createContractor(t, packageId);
  await t.mutation(api.bids.submitDirectBid, {
    tradePackageId: packageId,
    contractorId,
    subcontractorName: "Regression Electric LLC",
    baseBidAmount: 1_200_000,
  });
  const bids = await t.query(api.bids.listByPackage, { tradePackageId: packageId });
  const bid = bids.find((b) => b.contractorId === contractorId);

  await t.run(async (ctx) => {
    await ctx.db.patch(bid!._id, { isAwarded: true });
    await ctx.db.insert("agreements", {
      bidId: bid!._id,
      tradePackageId: packageId,
      projectId,
      contractorId,
      agreementNumber: "A401-REGRESSION",
      documentTitle: "AIA Document A401 - 2017 Standard Form of Agreement",
      subcontractorName: "Regression Electric LLC",
      generalContractorName: "Austin Commercial, LP",
      projectTitle: "Executed Agreement Project",
      projectLocation: "Austin, TX",
      csiDivision: "26 00 00",
      tradeName: "Electrical & Lighting Systems",
      scopeSummary: "Regression scope",
      mandatoryInclusions: ["Crane hoisting"],
      status: "executed",
      contractSum: 1_200_000,
      retainagePercent: 5,
      liquidatedDamagesDaily: 1000,
      contractText: "Regression agreement text",
      createdAt: Date.now(),
      executedAt: Date.now(),
    });
  });

  await expect(
    t.mutation(api.bids.submitDirectBid, {
      tradePackageId: packageId,
      contractorId,
      subcontractorName: "Regression Electric LLC",
      baseBidAmount: 1_250_000,
    })
  ).rejects.toThrow(/immutable/i);
});

test("Clash guard: projects without both trade packages return no clashes", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t, "Clash Guard Project");
  const empty = await t.query(api.coordination.detectCrossTradeClashes, { projectId });
  expect(empty.doubleBuys).toEqual([]);
  expect(empty.scopeVoids).toEqual([]);
  expect(empty.summary.activeClashesCount).toBe(0);
});

test("Clash guard: both packages but zero bids return no clashes (no priced evidence)", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t, "Zero Bid Clash Project");
  await createPackage(t, projectId);
  const hvacId = await t.mutation(api.tradePackages.createTradePackage, {
    projectId,
    csiDivision: "23 00 00",
    tradeName: "HVAC & Mechanical Systems",
    budgetEstimate: 1_500_000,
    scopeSummary: "Rooftop units and distribution.",
    mandatoryInclusions: ["TAB report"],
    bidDeadline: "2026-10-31",
  });
  expect(hvacId).toBeTruthy();
  const zeroBid = await t.query(api.coordination.detectCrossTradeClashes, { projectId });
  expect(zeroBid.doubleBuys).toEqual([]);
  expect(zeroBid.scopeVoids).toEqual([]);
  expect(zeroBid.summary.activeClashesCount).toBe(0);
});

test("B1: clash credit before bids is persisted as a resolution", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t, "Clash Resolution Project");
  const packageId = await createPackage(t, projectId);
  const result = await t.mutation(api.coordination.deductDoubleBuyCredit, {
    projectId,
    clashId: "clash-vfd-01",
    tradePackageId: packageId,
    deductAmount: 38_500,
    description: "VFD double-buy",
  });
  expect(result.success).toBe(true);
  const resolutions = await t.run(async (ctx) =>
    await ctx.db
      .query("clashResolutions")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect()
  );
  expect(resolutions.length).toBe(1);
  expect(resolutions[0].clashId).toBe("clash-vfd-01");
  expect(resolutions[0].status).toBe("deducted");
});

test("Guest RFI: submission without a contractor id succeeds (no v.id failure)", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t, "Guest RFI Project");
  const packageId = await createPackage(t, projectId);
  const result = await t.mutation(api.simulation.submitCustomRfi, {
    tradePackageId: packageId,
    subject: "Guest regression question",
    question: "Does the base scope include crane hoisting for the main equipment?",
  });
  expect(result.success).toBe(true);
});

test("RFQ dispatch with zero discovered contractors is rejected and leaves the package undispached", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t, "Zero Recipient RFQ Project");
  const packageId = await createPackage(t, projectId);

  await expect(t.mutation(api.rfq.dispatchRfqs, { tradePackageId: packageId })).rejects.toThrow(
    /No contractors have been discovered/i
  );

  const pkg = await t.query(api.tradePackages.getPackage, { tradePackageId: packageId });
  expect(pkg?.status).toBe("draft");

  const logs = await t.query(api.auditLogs.listRecentLogs, { projectId });
  expect(logs.some((l) => l.eventType === "rfq_dispatched")).toBe(false);
});

test("RFQ dispatch with discovered contractors marks them invited", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t, "Recipient RFQ Project");
  const packageId = await createPackage(t, projectId);
  const contractorId = await createContractor(t, packageId);
  await t.run(async (ctx) => await ctx.db.patch(contractorId, { rfqStatus: "discovered" }));

  const result: any = await t.mutation(api.rfq.dispatchRfqs, { tradePackageId: packageId });
  expect(result.success).toBe(true);
  expect(result.dispatchedCount).toBe(1);

  const contractors = await t.query(api.contractors.listByPackage, { tradePackageId: packageId });
  expect(contractors.find((c) => c._id === contractorId)?.rfqStatus).toBe("invited");
  const pkg = await t.query(api.tradePackages.getPackage, { tradePackageId: packageId });
  expect(pkg?.status).toBe("rfqs_dispatched");
});