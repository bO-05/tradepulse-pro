import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { syncAgreementForBid } from "./agreements";

export const listByPackage = query({
  args: { tradePackageId: v.id("tradePackages") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("bids")
      .withIndex("by_package", (q) => q.eq("tradePackageId", args.tradePackageId))
      .collect();
  },
});

export const listAllProjectBids = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const packages = await ctx.db
      .query("tradePackages")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const allBids = [];
    for (const pkg of packages) {
      const packageBids = await ctx.db
        .query("bids")
        .withIndex("by_package", (q) => q.eq("tradePackageId", pkg._id))
        .collect();
      for (const b of packageBids) {
        allBids.push({
          ...b,
          csiDivision: pkg.csiDivision,
          tradeName: pkg.tradeName,
        });
      }
    }
    return allBids;
  },
});

export const awardContract = mutation({
  args: {
    bidId: v.id("bids"),
    tradePackageId: v.id("tradePackages"),
  },
  handler: async (ctx, args) => {
    // Un-award all other bids in this package first
    const existingBids = await ctx.db
      .query("bids")
      .withIndex("by_package", (q) => q.eq("tradePackageId", args.tradePackageId))
      .collect();

    for (const b of existingBids) {
      if (b.isAwarded) {
        await ctx.db.patch(b._id, { isAwarded: false });
      }
    }

    // Mark this bid awarded
    await ctx.db.patch(args.bidId, { isAwarded: true });

    // Update trade package status to awarded
    await ctx.db.patch(args.tradePackageId, { status: "awarded" });

    const awardedBid = await ctx.db.get(args.bidId);
    const tradePkg = await ctx.db.get(args.tradePackageId);
    if (tradePkg && awardedBid) {
      await ctx.db.insert("auditLogs", {
        projectId: tradePkg.projectId,
        tradePackageId: tradePkg._id,
        eventType: "contract_awarded",
        title: `Subcontract Awarded: ${awardedBid.subcontractorName}`,
        description: `Awarded Division ${tradePkg.csiDivision} to ${awardedBid.subcontractorName} at leveled cost of $${awardedBid.leveledTotalCost.toLocaleString()}.`,
        actor: "Lead Project Manager / Executive",
        timestamp: Date.now(),
      });
    }

    return {
      success: true,
      awardedBid,
    };
  },
});

export const unawardContract = mutation({
  args: {
    bidId: v.id("bids"),
    tradePackageId: v.id("tradePackages"),
  },
  handler: async (ctx, args) => {
    const bid = await ctx.db.get(args.bidId);
    if (!bid) throw new Error("Bid not found");

    await ctx.db.patch(args.bidId, { isAwarded: false });
    await ctx.db.patch(args.tradePackageId, { status: "leveling" });

    // Mark any active agreements for this bid as superseded
    const packageAgreements = await ctx.db
      .query("agreements")
      .withIndex("by_package", (q) => q.eq("tradePackageId", args.tradePackageId))
      .collect();
    for (const a of packageAgreements) {
      if (a.bidId === args.bidId && a.status !== "superseded") {
        await ctx.db.patch(a._id, { status: "superseded" });
      }
    }

    const tradePkg = await ctx.db.get(args.tradePackageId);
    if (tradePkg) {
      await ctx.db.insert("auditLogs", {
        projectId: tradePkg.projectId,
        tradePackageId: tradePkg._id,
        eventType: "contract_awarded",
        title: `Subcontract Un-Awarded: ${bid.subcontractorName}`,
        description: `Reopened Division ${tradePkg.csiDivision} bid leveling matrix. Removed award flag from ${bid.subcontractorName}.`,
        actor: "Lead Project Manager",
        timestamp: Date.now(),
      });
    }

    return { success: true };
  },
});

export const deleteBid = mutation({
  args: {
    bidId: v.id("bids"),
  },
  handler: async (ctx, args) => {
    const bid = await ctx.db.get(args.bidId);
    if (!bid) throw new Error("Bid not found");

    const tradePkg = await ctx.db.get(bid.tradePackageId);

    // Delete or supersede any agreements associated with this bid
    const bidAgreements = await ctx.db
      .query("agreements")
      .withIndex("by_bid", (q) => q.eq("bidId", args.bidId))
      .collect();
    for (const a of bidAgreements) {
      await ctx.db.delete(a._id);
    }

    await ctx.db.delete(args.bidId);

    // Check remaining bids
    const remainingBids = await ctx.db
      .query("bids")
      .withIndex("by_package", (q) => q.eq("tradePackageId", bid.tradePackageId))
      .collect();

    if (remainingBids.length === 0 && tradePkg) {
      await ctx.db.patch(tradePkg._id, { status: "rfqs_dispatched" });
    } else if (bid.isAwarded && tradePkg) {
      await ctx.db.patch(tradePkg._id, { status: "leveling" });
    }

    if (tradePkg) {
      await ctx.db.insert("auditLogs", {
        projectId: tradePkg.projectId,
        tradePackageId: tradePkg._id,
        eventType: "bid_leveled",
        title: `Bid Removed: ${bid.subcontractorName}`,
        description: `Deleted proposal from ${bid.subcontractorName} ($${bid.baseBidAmount.toLocaleString()}) from Division ${tradePkg.csiDivision} leveling matrix.`,
        actor: "Estimator / Procurement Team",
        timestamp: Date.now(),
      });
    }

    return { success: true };
  },
});

export const updateBidLeveling = mutation({
  args: {
    bidId: v.id("bids"),
    baseBidAmount: v.optional(v.number()),
    identifiedExclusions: v.optional(
      v.array(
        v.object({
          description: v.string(),
          costImpact: v.number(),
          severity: v.string(),
          isWaived: v.optional(v.boolean()),
        })
      )
    ),
    valueEngineeringAlternates: v.optional(
      v.array(
        v.object({
          description: v.string(),
          costDeduct: v.number(),
          isAccepted: v.boolean(),
        })
      )
    ),
    leadTimePenalty: v.optional(v.number()),
    longLeadEquipmentWeeks: v.optional(v.number()),
    coiPenalty: v.optional(v.number()),
    coiComplianceStatus: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const bid = await ctx.db.get(args.bidId);
    if (!bid) throw new Error("Bid not found");

    const baseBidAmount = args.baseBidAmount ?? bid.baseBidAmount;
    const exclusions = args.identifiedExclusions ?? bid.identifiedExclusions;
    const veAlternates = args.valueEngineeringAlternates ?? bid.valueEngineeringAlternates ?? [];
    const leadTimePenalty = args.leadTimePenalty !== undefined ? args.leadTimePenalty : bid.leadTimePenalty;
    const coiPenalty = args.coiPenalty !== undefined ? args.coiPenalty : bid.coiPenalty;

    // ADR-0003 Formula:
    // Leveled Cost = Base Bid + Sum(Un-waived Exclusions) + Lead Time Penalty + COI Penalty - Sum(Accepted Alternates)
    const activeExclusionsCost = exclusions.reduce((sum, exc) => (exc.isWaived ? sum : sum + (exc.costImpact || 0)), 0);
    const acceptedAlternatesDeduct = veAlternates.reduce((sum, ve) => (ve.isAccepted ? sum + (ve.costDeduct || 0) : sum), 0);
    const leveledTotalCost = Math.max(0, baseBidAmount + activeExclusionsCost + leadTimePenalty + coiPenalty - acceptedAlternatesDeduct);

    await ctx.db.patch(args.bidId, {
      baseBidAmount,
      identifiedExclusions: exclusions,
      valueEngineeringAlternates: veAlternates,
      leadTimePenalty,
      longLeadEquipmentWeeks: args.longLeadEquipmentWeeks ?? bid.longLeadEquipmentWeeks,
      coiPenalty,
      coiComplianceStatus: args.coiComplianceStatus ?? bid.coiComplianceStatus,
      leveledTotalCost,
    });

    if (bid.isAwarded) {
      await syncAgreementForBid(ctx, bid._id);
    }

    const tradePkg = await ctx.db.get(bid.tradePackageId);
    if (tradePkg) {
      const waivedCount = exclusions.filter((e) => e.isWaived).length;
      const acceptedVeCount = veAlternates.filter((v) => v.isAccepted).length;
      await ctx.db.insert("auditLogs", {
        projectId: tradePkg.projectId,
        tradePackageId: tradePkg._id,
        eventType: "bid_leveled",
        title: `Bid Leveling Recalculated: ${bid.subcontractorName}`,
        description: `Normalized leveling recalculated. Base $${baseBidAmount.toLocaleString()} → Leveled Total: $${leveledTotalCost.toLocaleString()} (${waivedCount} exclusions waived, ${acceptedVeCount} VE alternates accepted, -$${acceptedAlternatesDeduct.toLocaleString()} deduct).`,
        actor: "Lead Cost Estimator (ADR-0003)",
        timestamp: Date.now(),
      });
    }

    return {
      success: true,
      leveledTotalCost,
    };
  },
});

export const updateBidAdjustments = mutation({
  args: {
    bidId: v.id("bids"),
    identifiedExclusions: v.array(
      v.object({
        description: v.string(),
        costImpact: v.number(),
        severity: v.string(),
        isWaived: v.optional(v.boolean()),
      })
    ),
    valueEngineeringAlternates: v.optional(
      v.array(
        v.object({
          description: v.string(),
          costDeduct: v.number(),
          isAccepted: v.boolean(),
        })
      )
    ),
    leadTimePenalty: v.optional(v.number()),
    longLeadEquipmentWeeks: v.optional(v.number()),
    coiPenalty: v.optional(v.number()),
    coiComplianceStatus: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const bid = await ctx.db.get(args.bidId);
    if (!bid) throw new Error("Bid not found");

    const exclusions = args.identifiedExclusions;
    const veAlternates = args.valueEngineeringAlternates ?? bid.valueEngineeringAlternates ?? [];
    const leadTimePenalty = args.leadTimePenalty !== undefined ? args.leadTimePenalty : bid.leadTimePenalty;
    const coiPenalty = args.coiPenalty !== undefined ? args.coiPenalty : bid.coiPenalty;

    const activeExclusionsCost = exclusions.reduce((sum, exc) => (exc.isWaived ? sum : sum + (exc.costImpact || 0)), 0);
    const acceptedAlternatesDeduct = veAlternates.reduce((sum, ve) => (ve.isAccepted ? sum + (ve.costDeduct || 0) : sum), 0);
    const leveledTotalCost = Math.max(0, bid.baseBidAmount + activeExclusionsCost + leadTimePenalty + coiPenalty - acceptedAlternatesDeduct);

    await ctx.db.patch(args.bidId, {
      identifiedExclusions: exclusions,
      valueEngineeringAlternates: veAlternates,
      leadTimePenalty,
      longLeadEquipmentWeeks: args.longLeadEquipmentWeeks ?? bid.longLeadEquipmentWeeks,
      coiPenalty,
      coiComplianceStatus: args.coiComplianceStatus ?? bid.coiComplianceStatus,
      leveledTotalCost,
    });

    if (bid.isAwarded) {
      await syncAgreementForBid(ctx, bid._id);
    }

    const tradePkg = await ctx.db.get(bid.tradePackageId);
    if (tradePkg) {
      const waivedCount = exclusions.filter((e) => e.isWaived).length;
      const acceptedVeCount = veAlternates.filter((v) => v.isAccepted).length;
      await ctx.db.insert("auditLogs", {
        projectId: tradePkg.projectId,
        tradePackageId: tradePkg._id,
        eventType: "bid_leveled",
        title: `Bid Leveling Adjusted: ${bid.subcontractorName}`,
        description: `Manual leveling adjustments applied. Leveled Total: $${leveledTotalCost.toLocaleString()} (${waivedCount} exclusions waived, ${acceptedVeCount} VE alternates accepted, -$${acceptedAlternatesDeduct.toLocaleString()} deduct).`,
        actor: "Lead Cost Estimator",
        timestamp: Date.now(),
      });
    }

    return {
      success: true,
      leveledTotalCost,
    };
  },
});

export const submitDirectBid = mutation({
  args: {
    tradePackageId: v.id("tradePackages"),
    contractorId: v.id("contractors"),
    subcontractorName: v.string(),
    baseBidAmount: v.number(),
    lineItems: v.optional(
      v.array(
        v.object({
          item: v.string(),
          unit: v.string(),
          quantity: v.number(),
          unitCost: v.number(),
          totalCost: v.number(),
        })
      )
    ),
    identifiedExclusions: v.optional(
      v.array(
        v.object({
          canonicalCode: v.optional(v.string()),
          description: v.string(),
          costImpact: v.number(),
          severity: v.string(),
          isWaived: v.optional(v.boolean()),
        })
      )
    ),
    valueEngineeringAlternates: v.optional(
      v.array(
        v.object({
          description: v.string(),
          costDeduct: v.number(),
          isAccepted: v.boolean(),
        })
      )
    ),
    longLeadEquipmentWeeks: v.optional(v.number()),
    leadTimePenalty: v.optional(v.number()),
    coiComplianceStatus: v.optional(v.string()),
    coiPenalty: v.optional(v.number()),
    leveledTotalCost: v.optional(v.number()),
    rawProposalText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. Mark contractor as bid_received
    await ctx.db.patch(args.contractorId, { rfqStatus: "bid_received" });

    // 2. Set trade package status to leveling
    await ctx.db.patch(args.tradePackageId, { status: "leveling" });

    // 3. Remove any previous bid from this contractor for this package
    const existing = await ctx.db
      .query("bids")
      .withIndex("by_contractor", (q) => q.eq("contractorId", args.contractorId))
      .filter((q) => q.eq(q.field("tradePackageId"), args.tradePackageId))
      .first();

    const lineItems = args.lineItems ?? [
      {
        item: "Base Commercial Package Scope",
        unit: "LS",
        quantity: 1,
        unitCost: args.baseBidAmount,
        totalCost: args.baseBidAmount,
      },
    ];
    const exclusions = args.identifiedExclusions ?? [];
    const veAlternates = args.valueEngineeringAlternates ?? [];
    const leadWeeks = args.longLeadEquipmentWeeks ?? 12;
    const leadPenalty = args.leadTimePenalty ?? 0;
    const coiStatus = args.coiComplianceStatus ?? "compliant";
    const coiPenalty = args.coiPenalty ?? 0;

    // ADR-0003 Formula:
    // Leveled Cost = Base Bid + Sum(Active Exclusions) + Lead Penalty + COI Penalty - Sum(Accepted VE Alternates)
    const activeExclusionsCost = exclusions.reduce(
      (sum, exc) => (exc.isWaived ? sum : sum + exc.costImpact),
      0
    );
    const acceptedVeDeduct = veAlternates.reduce(
      (sum, ve) => (ve.isAccepted ? sum + ve.costDeduct : sum),
      0
    );
    const computedLeveledTotal = Math.max(
      0,
      args.leveledTotalCost !== undefined
        ? args.leveledTotalCost
        : args.baseBidAmount + activeExclusionsCost + leadPenalty + coiPenalty - acceptedVeDeduct
    );

    // 3. Update existing bid in-place or insert new to preserve agreement references
    let bidId: any;
    if (existing) {
      bidId = existing._id;
      await ctx.db.patch(existing._id, {
        subcontractorName: args.subcontractorName,
        baseBidAmount: args.baseBidAmount,
        lineItems,
        identifiedExclusions: exclusions,
        valueEngineeringAlternates: veAlternates,
        longLeadEquipmentWeeks: leadWeeks,
        leadTimePenalty: leadPenalty,
        coiComplianceStatus: coiStatus,
        coiPenalty,
        leveledTotalCost: computedLeveledTotal,
        receivedAt: Date.now(),
      });
    } else {
      bidId = await ctx.db.insert("bids", {
        tradePackageId: args.tradePackageId,
        contractorId: args.contractorId,
        subcontractorName: args.subcontractorName,
        baseBidAmount: args.baseBidAmount,
        lineItems,
        identifiedExclusions: exclusions,
        valueEngineeringAlternates: veAlternates,
        longLeadEquipmentWeeks: leadWeeks,
        leadTimePenalty: leadPenalty,
        coiComplianceStatus: coiStatus,
        coiPenalty,
        leveledTotalCost: computedLeveledTotal,
        isAwarded: false,
        receivedAt: Date.now(),
      });
    }

    const tradePkg = await ctx.db.get(args.tradePackageId);
    if (tradePkg) {
      await ctx.db.insert("auditLogs", {
        projectId: tradePkg.projectId,
        tradePackageId: tradePkg._id,
        eventType: "quote_received",
        title: `Direct Bid Ingested: ${args.subcontractorName}`,
        description: `Direct proposal ingested for Division ${tradePkg.csiDivision}: Base $${args.baseBidAmount.toLocaleString()} → Leveled $${computedLeveledTotal.toLocaleString()} (${exclusions.length} exclusions, ${veAlternates.length} VE alternates).`,
        actor: "General Contractor / Estimator",
        timestamp: Date.now(),
      });
    }

    return {
      success: true,
      bidId,
      subcontractorName: args.subcontractorName,
      baseBidAmount: args.baseBidAmount,
      leveledTotalCost: computedLeveledTotal,
    };
  },
});

export const insertParsedBid = internalMutation({
  args: {
    tradePackageId: v.id("tradePackages"),
    contractorId: v.id("contractors"),
    subcontractorName: v.string(),
    baseBidAmount: v.number(),
    lineItems: v.array(
      v.object({
        item: v.string(),
        unit: v.string(),
        quantity: v.number(),
        unitCost: v.number(),
        totalCost: v.number(),
      })
    ),
    identifiedExclusions: v.array(
      v.object({
        canonicalCode: v.optional(v.string()),
        description: v.string(),
        costImpact: v.number(),
        severity: v.string(),
        isWaived: v.optional(v.boolean()),
      })
    ),
    valueEngineeringAlternates: v.optional(
      v.array(
        v.object({
          description: v.string(),
          costDeduct: v.number(),
          isAccepted: v.boolean(),
        })
      )
    ),
    longLeadEquipmentWeeks: v.number(),
    leadTimePenalty: v.number(),
    coiComplianceStatus: v.string(),
    coiPenalty: v.number(),
    leveledTotalCost: v.number(),
  },
  handler: async (ctx, args) => {
    // 1. Mark contractor as bid_received
    await ctx.db.patch(args.contractorId, { rfqStatus: "bid_received" });

    // 2. Set trade package status to leveling
    await ctx.db.patch(args.tradePackageId, { status: "leveling" });

    // 3. Remove any previous bid from this contractor for this package to keep clean latest bid
    const existing = await ctx.db
      .query("bids")
      .withIndex("by_contractor", (q) => q.eq("contractorId", args.contractorId))
      .filter((q) => q.eq(q.field("tradePackageId"), args.tradePackageId))
      .first();

    // 4. Calculate deterministic leveled cost with VE alternates & waived exclusions
    const activeExclusionsCost = args.identifiedExclusions.reduce(
      (sum, exc) => (exc.isWaived ? sum : sum + exc.costImpact),
      0
    );
    const acceptedVeDeduct = (args.valueEngineeringAlternates || []).reduce(
      (sum, ve) => (ve.isAccepted ? sum + ve.costDeduct : sum),
      0
    );
    const computedLeveledTotal = Math.max(
      0,
      args.baseBidAmount +
      activeExclusionsCost +
      args.leadTimePenalty +
      args.coiPenalty -
      acceptedVeDeduct
    );

    // 5. Update existing bid in-place or insert new to preserve agreement references
    let bidId: any;
    if (existing) {
      bidId = existing._id;
      await ctx.db.patch(existing._id, {
        subcontractorName: args.subcontractorName,
        baseBidAmount: args.baseBidAmount,
        lineItems: args.lineItems,
        identifiedExclusions: args.identifiedExclusions,
        valueEngineeringAlternates: args.valueEngineeringAlternates ?? [],
        longLeadEquipmentWeeks: args.longLeadEquipmentWeeks,
        leadTimePenalty: args.leadTimePenalty,
        coiComplianceStatus: args.coiComplianceStatus,
        coiPenalty: args.coiPenalty,
        leveledTotalCost: computedLeveledTotal,
        receivedAt: Date.now(),
      });
      if (existing.isAwarded) {
        await syncAgreementForBid(ctx, existing._id);
      }
    } else {
      bidId = await ctx.db.insert("bids", {
        tradePackageId: args.tradePackageId,
        contractorId: args.contractorId,
        subcontractorName: args.subcontractorName,
        baseBidAmount: args.baseBidAmount,
        lineItems: args.lineItems,
        identifiedExclusions: args.identifiedExclusions,
        valueEngineeringAlternates: args.valueEngineeringAlternates ?? [],
        longLeadEquipmentWeeks: args.longLeadEquipmentWeeks,
        leadTimePenalty: args.leadTimePenalty,
        coiComplianceStatus: args.coiComplianceStatus,
        coiPenalty: args.coiPenalty,
        leveledTotalCost: computedLeveledTotal,
        isAwarded: false,
        receivedAt: Date.now(),
      });
    }

    const tradePkg = await ctx.db.get(args.tradePackageId);
    if (tradePkg) {
      const exclusionsCount = args.identifiedExclusions.length;
      await ctx.db.insert("auditLogs", {
        projectId: tradePkg.projectId,
        tradePackageId: tradePkg._id,
        eventType: "bid_leveled",
        title: `Forensic Bid Leveled: ${args.subcontractorName}`,
        description: `Normalized proposal: Base $${args.baseBidAmount.toLocaleString()} → Leveled $${computedLeveledTotal.toLocaleString()} (${exclusionsCount} exclusions totaling +$${activeExclusionsCost.toLocaleString()}).`,
        actor: "Forensic Leveling Engine (ADR-0003)",
        timestamp: Date.now(),
      });
    }

    return bidId;
  },
});
