import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Live Reactive Activity Audit Stream:
 * Provides a real-time WebSocket audit log of all project procurement activities
 * (RFQ dispatch, pre-bid RFI clarification, quote submission, leveling, contracts, file uploads, crons).
 */
export const listRecentLogs = query({
  args: {
    projectId: v.optional(v.id("projects")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxLimit = args.limit ?? 50;

    if (args.projectId) {
      return await ctx.db
        .query("auditLogs")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId!))
        .order("desc")
        .take(maxLimit);
    }

    return await ctx.db
      .query("auditLogs")
      .order("desc")
      .take(maxLimit);
  },
});

export const recordLog = mutation({
  args: {
    projectId: v.id("projects"),
    tradePackageId: v.optional(v.id("tradePackages")),
    eventType: v.string(),
    title: v.string(),
    description: v.string(),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("auditLogs", {
      ...args,
      timestamp: Date.now(),
    });
  },
});

export const recordLogInternal = internalMutation({
  args: {
    projectId: v.id("projects"),
    tradePackageId: v.optional(v.id("tradePackages")),
    eventType: v.string(),
    title: v.string(),
    description: v.string(),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("auditLogs", {
      ...args,
      timestamp: Date.now(),
    });
  },
});
