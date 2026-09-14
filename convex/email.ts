import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

export const onMessageReceived = internalMutation({
  args: {
    message: v.any(),
    thread: v.any(),
    eventId: v.string(),
  },
  handler: async (ctx, args) => {
    const threadId = args.message.thread_id ?? args.message.id ?? "";
    const rawFrom = args.message.from?.email ?? args.message.from ?? "";
    const angleMatch = typeof rawFrom === "string" ? rawFrom.match(/<([^>]+)>/) : null;
    const fromEmail = (angleMatch ? angleMatch[1] : (typeof rawFrom === "string" ? rawFrom : "")).trim();
    const explicitName = args.message.from?.name || (angleMatch ? rawFrom.replace(/<[^>]+>/, "").trim() : "");
    const subject = args.message.subject ?? "";
    const text = args.message.text ?? args.message.body ?? "";
    const inboxId = args.message.inbox_id ?? "";

    // 1. Try to match by threadId in conversations
    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .first();

    let tradePackageId = conversation?.tradePackageId;
    let contractorId = conversation?.contractorId;

    // 2. If no thread matched, try matching contractor by email
    if (!contractorId && fromEmail) {
      const contractor = await ctx.db
        .query("contractors")
        .filter((q) => q.eq(q.field("contactEmail"), fromEmail))
        .first();

      if (contractor) {
        contractorId = contractor._id;
        tradePackageId = contractor.tradePackageId;
      }
    }

    // Extract possible recipient addresses (AgentMail webhook to/recipient)
    const toRecipients: string[] = [];
    if (typeof args.message.to === "string") {
      toRecipients.push(args.message.to.toLowerCase());
    } else if (Array.isArray(args.message.to)) {
      for (const t of args.message.to) {
        if (typeof t === "string") toRecipients.push(t.toLowerCase());
        else if (t?.email) toRecipients.push(t.email.toLowerCase());
      }
    } else if (args.message.to?.email) {
      toRecipients.push(args.message.to.email.toLowerCase());
    }
    if (args.message.recipient && typeof args.message.recipient === "string") {
      toRecipients.push(args.message.recipient.toLowerCase());
    }

    // 3. If still no package, match trade package by mailbox ID or recipient address
    if (!tradePackageId) {
      if (inboxId) {
        const pkg = await ctx.db
          .query("tradePackages")
          .filter((q) => q.eq(q.field("agentMailboxId"), inboxId))
          .first();
        if (pkg) {
          tradePackageId = pkg._id;
        }
      }
      if (!tradePackageId && toRecipients.length > 0) {
        const allPackages = await ctx.db.query("tradePackages").collect();
        const pkgMatch = allPackages.find((p) =>
          p.agentMailbox &&
          toRecipients.some(
            (r) => r.includes(p.agentMailbox!.toLowerCase()) || p.agentMailbox!.toLowerCase().includes(r)
          )
        );
        if (pkgMatch) {
          tradePackageId = pkgMatch._id;
        }
      }
      if (!tradePackageId) {
        const emailContent = `${args.message.subject || ""} ${args.message.text || ""}`.toLowerCase();
        const allPackages = await ctx.db.query("tradePackages").collect();
        const matchedByContent = allPackages.find((p) => {
          const divNumber = p.csiDivision.replace(/\s+/g, "").slice(0, 2);
          const tradeKeywords = p.tradeName.toLowerCase().split(/[\s&,/]+/).filter((w) => w.length > 3);
          return (
            emailContent.includes(`division ${divNumber}`) ||
            emailContent.includes(`div ${divNumber}`) ||
            emailContent.includes(`csi ${divNumber}`) ||
            (p.tradeName && emailContent.includes(p.tradeName.toLowerCase())) ||
            tradeKeywords.some((kw) => emailContent.includes(kw))
          );
        });
        if (matchedByContent) {
          tradePackageId = matchedByContent._id;
        }
      }
    }

    // 4. If package identified but contractorId not resolved, match by domain or auto-provision
    if (!contractorId && tradePackageId && fromEmail) {
      const fromDomain = fromEmail.includes("@") ? fromEmail.split("@")[1].toLowerCase() : "";
      if (fromDomain) {
        const pkgContractors = await ctx.db
          .query("contractors")
          .withIndex("by_package", (q) => q.eq("tradePackageId", tradePackageId!))
          .collect();

        const domainMatch = pkgContractors.find(
          (c) => c.contactEmail && c.contactEmail.toLowerCase().includes(fromDomain)
        );
        if (domainMatch) {
          contractorId = domainMatch._id;
        }
      }

      if (!contractorId && fromEmail.toLowerCase().includes("@agentmail.to")) {
        const firstContractor = await ctx.db
          .query("contractors")
          .withIndex("by_package", (q) => q.eq("tradePackageId", tradePackageId!))
          .first();
        if (firstContractor) {
          contractorId = firstContractor._id;
        }
      }

      if (!contractorId) {
        let companyName = explicitName;
        if (!companyName) {
          const userPart = fromEmail.split("@")[0] || "commercial_sub";
          companyName =
            userPart
              .replace(/[._-]/g, " ")
              .replace(/\b\w/g, (l: string) => l.toUpperCase()) + " (Direct Inbound)";
        }

        const pkg = await ctx.db.get(tradePackageId);
        let statePrefix = "COMM";
        if (pkg?.projectId) {
          const prj = await ctx.db.get(pkg.projectId);
          const stateMatch = prj?.location?.match(/\b([A-Z]{2})\b/);
          if (stateMatch) statePrefix = stateMatch[1];
        }

        contractorId = await ctx.db.insert("contractors", {
          tradePackageId,
          companyName,
          contactEmail: fromEmail,
          phone: undefined,
          licenseNumber: `${statePrefix}-VERIFY-PENDING`,
          licenseStatus: "Pending Audit",
          sourceUrl: `mailto:${fromEmail}`,
          rfqStatus: "invited",
          dispatchedAt: Date.now(),
        });
      }
    }

    const attachments = args.message.attachments || [];

    // Schedule async LLM action to parse RFI or extract bid quote
    await ctx.scheduler.runAfter(0, internal.emailActions.processInboundEmail, {
      inboxId,
      messageId: args.message.message_id ?? `msg_${Date.now()}`,
      threadId,
      text,
      subject,
      from: fromEmail,
      tradePackageId,
      contractorId,
      attachments,
    });

    return { received: true, scheduled: true };
  },
});
