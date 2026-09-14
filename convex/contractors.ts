import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const listByPackage = query({
  args: { tradePackageId: v.id("tradePackages") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("contractors")
      .withIndex("by_package", (q) => q.eq("tradePackageId", args.tradePackageId))
      .collect();
  },
});

export const listByPackageInternal = internalQuery({
  args: { tradePackageId: v.id("tradePackages") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("contractors")
      .withIndex("by_package", (q) => q.eq("tradePackageId", args.tradePackageId))
      .collect();
  },
});

export const getContractorInternal = internalQuery({
  args: { contractorId: v.id("contractors") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.contractorId);
  },
});

export const createContractor = mutation({
  args: {
    tradePackageId: v.id("tradePackages"),
    companyName: v.string(),
    contactEmail: v.string(),
    phone: v.optional(v.string()),
    licenseNumber: v.string(),
    licenseStatus: v.string(),
    sourceUrl: v.string(),
    rfqStatus: v.union(
      v.literal("discovered"),
      v.literal("invited"),
      v.literal("rfi_submitted"),
      v.literal("bid_received")
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("contractors", {
      ...args,
      dispatchedAt: args.rfqStatus === "invited" ? Date.now() : undefined,
    });
  },
});

export const createContractorInternal = internalMutation({
  args: {
    tradePackageId: v.id("tradePackages"),
    companyName: v.string(),
    contactEmail: v.string(),
    phone: v.optional(v.string()),
    licenseNumber: v.string(),
    licenseStatus: v.string(),
    sourceUrl: v.string(),
    rfqStatus: v.union(
      v.literal("discovered"),
      v.literal("invited"),
      v.literal("rfi_submitted"),
      v.literal("bid_received")
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("contractors", {
      ...args,
      dispatchedAt: args.rfqStatus === "invited" ? Date.now() : undefined,
    });
  },
});

export const updateRfqStatus = mutation({
  args: {
    contractorId: v.id("contractors"),
    rfqStatus: v.union(
      v.literal("discovered"),
      v.literal("invited"),
      v.literal("rfi_submitted"),
      v.literal("bid_received")
    ),
  },
  handler: async (ctx, args) => {
    const patchData: { rfqStatus: any; dispatchedAt?: number } = {
      rfqStatus: args.rfqStatus,
    };
    if (args.rfqStatus === "invited") {
      patchData.dispatchedAt = Date.now();
    }
    await ctx.db.patch(args.contractorId, patchData);
  },
});

export const updateRfqStatusInternal = internalMutation({
  args: {
    contractorId: v.id("contractors"),
    rfqStatus: v.union(
      v.literal("discovered"),
      v.literal("invited"),
      v.literal("rfi_submitted"),
      v.literal("bid_received")
    ),
  },
  handler: async (ctx, args) => {
    const patchData: { rfqStatus: any; dispatchedAt?: number } = {
      rfqStatus: args.rfqStatus,
    };
    if (args.rfqStatus === "invited") {
      patchData.dispatchedAt = Date.now();
    }
    await ctx.db.patch(args.contractorId, patchData);
  },
});

export const updateContractor = mutation({
  args: {
    contractorId: v.id("contractors"),
    companyName: v.string(),
    contactEmail: v.string(),
    phone: v.optional(v.string()),
    licenseNumber: v.string(),
    licenseStatus: v.string(),
    sourceUrl: v.string(),
    rfqStatus: v.optional(
      v.union(
        v.literal("discovered"),
        v.literal("invited"),
        v.literal("rfi_submitted"),
        v.literal("bid_received")
      )
    ),
  },
  handler: async (ctx, args) => {
    const { contractorId, ...fields } = args;
    await ctx.db.patch(contractorId, fields);
    return { success: true };
  },
});

export const deleteContractor = mutation({
  args: {
    contractorId: v.id("contractors"),
  },
  handler: async (ctx, args) => {
    const contractor = await ctx.db.get(args.contractorId);
    if (!contractor) throw new Error("Contractor not found");

    const tradePkg = await ctx.db.get(contractor.tradePackageId);

    // Cascade delete any agreements and bids associated with this contractor
    const contractorBids = await ctx.db
      .query("bids")
      .withIndex("by_contractor", (q) => q.eq("contractorId", args.contractorId))
      .collect();

    for (const b of contractorBids) {
      const agreements = await ctx.db
        .query("agreements")
        .withIndex("by_bid", (q) => q.eq("bidId", b._id))
        .collect();
      for (const a of agreements) {
        await ctx.db.delete(a._id);
      }
      await ctx.db.delete(b._id);
    }

    // Cascade delete any conversations associated with this contractor
    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_contractor", (q) => q.eq("contractorId", args.contractorId))
      .collect();
    for (const c of conversations) {
      await ctx.db.delete(c._id);
    }

    await ctx.db.delete(args.contractorId);

    if (tradePkg) {
      await ctx.db.insert("auditLogs", {
        projectId: tradePkg.projectId,
        tradePackageId: tradePkg._id,
        eventType: "compliance_audit",
        title: `Contractor Removed: ${contractor.companyName}`,
        description: `Removed contractor ${contractor.companyName} (${contractor.licenseNumber}) and cascaded cleanup of associated bids and RFIs.`,
        actor: "Procurement Manager",
        timestamp: Date.now(),
      });
    }

    return { success: true };
  },
});

export const listByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const packages = await ctx.db
      .query("tradePackages")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const allContractors = [];
    for (const pkg of packages) {
      const contractors = await ctx.db
        .query("contractors")
        .withIndex("by_package", (q) => q.eq("tradePackageId", pkg._id))
        .collect();
      for (const c of contractors) {
        allContractors.push({
          ...c,
          csiDivision: pkg.csiDivision,
          tradeName: pkg.tradeName,
        });
      }
    }
    return allContractors;
  },
});

export const batchInsertContractors = internalMutation({
  args: {
    tradePackageId: v.id("tradePackages"),
    contractors: v.array(
      v.object({
        companyName: v.string(),
        contactEmail: v.string(),
        phone: v.optional(v.string()),
        licenseNumber: v.string(),
        licenseStatus: v.string(),
        sourceUrl: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const ids = [];
    for (const c of args.contractors) {
      // Check if contractor already exists in package by email
      const existing = await ctx.db
        .query("contractors")
        .withIndex("by_package", (q) => q.eq("tradePackageId", args.tradePackageId))
        .filter((q) => q.eq(q.field("contactEmail"), c.contactEmail))
        .first();

      if (!existing) {
        const id = await ctx.db.insert("contractors", {
          ...c,
          tradePackageId: args.tradePackageId,
          rfqStatus: "discovered",
        });
        ids.push(id);
      }
    }
    return ids;
  },
});
