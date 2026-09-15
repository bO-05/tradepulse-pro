import { query, mutation, internalMutation, internalQuery, action } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import {
  normalizeCsiDivision,
  validateBidDeadline,
  validateCsiDivision,
  validatePositiveAmount,
  validateProjectText,
} from "./validation";

export const listByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tradePackages")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const getPackage = query({
  args: { tradePackageId: v.id("tradePackages") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.tradePackageId);
  },
});

export const getPackageInternal = internalQuery({
  args: { tradePackageId: v.id("tradePackages") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.tradePackageId);
  },
});

export const createTradePackage = mutation({
  args: {
    projectId: v.id("projects"),
    csiDivision: v.string(),
    tradeName: v.string(),
    budgetEstimate: v.number(),
    scopeSummary: v.string(),
    mandatoryInclusions: v.array(v.string()),
    bidDeadline: v.string(),
    agentMailbox: v.optional(v.string()),
    agentMailboxId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const csiDivision = validateCsiDivision(args.csiDivision);
    const tradeName = validateProjectText(args.tradeName, "Trade package name");
    const scopeSummary = validateProjectText(args.scopeSummary, "Scope summary");
    const budgetEstimate = validatePositiveAmount(args.budgetEstimate, "Budget estimate");
    const bidDeadline = validateBidDeadline(args.bidDeadline);
    const existing = await ctx.db
      .query("tradePackages")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    if (existing.some((pkg) => normalizeCsiDivision(pkg.csiDivision) === csiDivision)) {
      throw new Error(`CSI Division ${csiDivision} already exists in this project. Use the existing package or choose a different division.`);
    }

    const pkgId = await ctx.db.insert("tradePackages", {
      projectId: args.projectId,
      csiDivision,
      tradeName,
      budgetEstimate,
      scopeSummary,
      mandatoryInclusions: args.mandatoryInclusions,
      bidDeadline,
      agentMailbox: args.agentMailbox ?? `trade-${csiDivision.replace(/\s+/g, "")}@agentmail.to`,
      agentMailboxId: args.agentMailboxId ?? `inbox_${Date.now()}`,
      status: "draft",
    });

    await ctx.db.insert("auditLogs", {
      projectId: args.projectId,
      tradePackageId: pkgId,
      eventType: "rfq_dispatched",
      title: `CSI Trade Package Scoped: Division ${csiDivision}`,
      description: `Created ${tradeName} package ($${budgetEstimate.toLocaleString()} budget, ${args.mandatoryInclusions.length} mandatory inclusions).`,
      actor: "Lead Estimator / GC Procurement",
      timestamp: Date.now(),
    });

    return pkgId;
  },
});

export const updateMailbox = internalMutation({
  args: {
    tradePackageId: v.id("tradePackages"),
    agentMailbox: v.string(),
    agentMailboxId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.tradePackageId, {
      agentMailbox: args.agentMailbox,
      agentMailboxId: args.agentMailboxId,
    });
  },
});

export const updateStatus = mutation({
  args: {
    tradePackageId: v.id("tradePackages"),
    status: v.union(
      v.literal("draft"),
      v.literal("rfqs_dispatched"),
      v.literal("leveling"),
      v.literal("awarded")
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.tradePackageId, { status: args.status });
  },
});

export const createTradePackageInternal = internalMutation({
  args: {
    projectId: v.id("projects"),
    csiDivision: v.string(),
    tradeName: v.string(),
    budgetEstimate: v.number(),
    scopeSummary: v.string(),
    mandatoryInclusions: v.array(v.string()),
    bidDeadline: v.string(),
  },
  handler: async (ctx, args) => {
    const csiDivision = validateCsiDivision(args.csiDivision);
    const tradeName = validateProjectText(args.tradeName, "Trade package name");
    const scopeSummary = validateProjectText(args.scopeSummary, "Scope summary");
    const budgetEstimate = validatePositiveAmount(args.budgetEstimate, "Budget estimate");
    const bidDeadline = validateBidDeadline(args.bidDeadline);
    const existing = await ctx.db
      .query("tradePackages")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const duplicate = existing.find((pkg) => normalizeCsiDivision(pkg.csiDivision) === csiDivision);
    if (duplicate) {
      return duplicate._id;
    }

    const pkgId = await ctx.db.insert("tradePackages", {
      projectId: args.projectId,
      csiDivision,
      tradeName,
      budgetEstimate,
      scopeSummary,
      mandatoryInclusions: args.mandatoryInclusions,
      bidDeadline,
      agentMailbox: `trade-${csiDivision.replace(/\s+/g, "")}@agentmail.to`,
      agentMailboxId: `inbox_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      status: "draft",
    });

    await ctx.db.insert("auditLogs", {
      projectId: args.projectId,
      tradePackageId: pkgId,
      eventType: "rfq_dispatched",
      title: `AI Auto-Scoped Trade Package: Division ${csiDivision}`,
      description: `Auto-scoped ${tradeName} ($${budgetEstimate.toLocaleString()} budget) via AI specification deconstruction.`,
      actor: "Autonomous AI Spec Scoping Agent",
      timestamp: Date.now(),
    });

    return pkgId;
  },
});

export const generateTradePackagesFromSpec = action({
  args: {
    projectId: v.id("projects"),
    specDocumentTextOverride: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<any> => {
    let specText: string = args.specDocumentTextOverride || "";
    if (!specText) {
      const project: any = await ctx.runQuery(internal.projects.getProjectInternal, {
        projectId: args.projectId,
      });
      specText = project?.specDocumentText || "Commercial MEP specifications";
    }

    const reasoningResult: any = await ctx.runAction(internal.llmRouter.executeReasoning, {
      taskType: "spec_generation",
      prompt: specText,
      systemPrompt:
        "You are TradePulse Pro, an expert construction cost engineer and CSI MasterFormat specialist. Analyze the building specifications and deconstruct them into discrete commercial trade packages with CSI division numbers, trade titles, budget estimates, and mandatory inclusions.",
    });

    const parsed = reasoningResult.parsedJson;
    const pkgs = (Array.isArray(parsed?.packages) && parsed.packages.length > 0)
      ? parsed.packages
      : (Array.isArray(parsed) && parsed.length > 0)
      ? parsed
      : [
          {
            csiDivision: "26 00 00",
            tradeName: "Electrical & Lighting Systems",
            budgetEstimate: 1250000,
            scopeSummary: "Main switchgear, emergency lighting, and seismic bracing.",
            mandatoryInclusions: ["Crane hoisting", "Seismic bracing", "UL 1479 firestopping"],
            bidDeadline: "2026-10-01",
          },
        ];

    const createdIds: string[] = [];
    for (const pkg of pkgs) {
      const pkgId: any = await ctx.runMutation(
        internal.tradePackages.createTradePackageInternal,
        {
          projectId: args.projectId,
          csiDivision: pkg.csiDivision,
          tradeName: pkg.tradeName,
          budgetEstimate: pkg.budgetEstimate,
          scopeSummary: pkg.scopeSummary,
          mandatoryInclusions: pkg.mandatoryInclusions,
          bidDeadline: pkg.bidDeadline,
        }
      );
      createdIds.push(pkgId);

      // Provision dynamic AgentMail mailbox for this auto-scoped package
      try {
        const prefix = `trade-${pkg.csiDivision.replace(/\s+/g, "").toLowerCase()}`;
        await ctx.runAction(api.rfqActions.provisionPackageInbox, {
          tradePackageId: pkgId,
          usernamePrefix: prefix,
        });
      } catch (inboxErr) {
        console.warn("Dynamic inbox provisioning note:", inboxErr);
      }
    }

    return {
      success: true,
      packagesCount: createdIds.length,
      packageIds: createdIds,
      packages: pkgs,
    };
  },
});

export const deleteTradePackage = mutation({
  args: {
    tradePackageId: v.id("tradePackages"),
  },
  handler: async (ctx, args) => {
    const pkg = await ctx.db.get(args.tradePackageId);
    if (!pkg) throw new Error("Trade package not found");

    // 1. Delete all bids and their agreements
    const bids = await ctx.db
      .query("bids")
      .withIndex("by_package", (q) => q.eq("tradePackageId", args.tradePackageId))
      .collect();
    for (const b of bids) {
      const agreements = await ctx.db
        .query("agreements")
        .withIndex("by_bid", (q) => q.eq("bidId", b._id))
        .collect();
      for (const a of agreements) {
        await ctx.db.delete(a._id);
      }
      await ctx.db.delete(b._id);
    }

    // 2. Delete all contractors
    const contractors = await ctx.db
      .query("contractors")
      .withIndex("by_package", (q) => q.eq("tradePackageId", args.tradePackageId))
      .collect();
    for (const c of contractors) {
      await ctx.db.delete(c._id);
    }

    // 3. Delete all conversations
    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_package", (q) => q.eq("tradePackageId", args.tradePackageId))
      .collect();
    for (const c of conversations) {
      await ctx.db.delete(c._id);
    }

    // 4. Delete package files and their storage blobs.
    const files = await ctx.db
      .query("projectFiles")
      .withIndex("by_package", (q) => q.eq("tradePackageId", args.tradePackageId))
      .collect();
    for (const file of files) {
      if (!file.storageId.startsWith("http") && !file.storageId.startsWith("/")) {
        try {
          await ctx.storage.delete(file.storageId as any);
        } catch {
          // Keep deletion idempotent for legacy/external storage identifiers.
        }
      }
      await ctx.db.delete(file._id);
    }

    // 5. Delete all agreements for this package
    const packageAgreements = await ctx.db
      .query("agreements")
      .withIndex("by_package", (q) => q.eq("tradePackageId", args.tradePackageId))
      .collect();
    for (const a of packageAgreements) {
      await ctx.db.delete(a._id);
    }

    // 6. Delete the trade package itself
    await ctx.db.delete(args.tradePackageId);

    // Audit log
    await ctx.db.insert("auditLogs", {
      projectId: pkg.projectId,
      eventType: "compliance_audit",
      title: `Trade Package Removed: Division ${pkg.csiDivision}`,
      description: `Deleted CSI Division ${pkg.csiDivision} (${pkg.tradeName}) package and cascaded cleanup of associated bids, contractors, and agreements.`,
      actor: "Lead Estimator / GC Procurement",
      timestamp: Date.now(),
    });

    return { success: true };
  },
});
