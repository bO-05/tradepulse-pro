import { action } from "./_generated/server";
import { v } from "convex/values";
import { AgentMail } from "@agentmail/convex";
import { components, internal } from "./_generated/api";

const agentmail = new AgentMail(components.agentmail);

export const provisionPackageInbox = action({
  args: {
    tradePackageId: v.id("tradePackages"),
    usernamePrefix: v.string(),
  },
  handler: async (ctx, args): Promise<{ email: string; id: string }> => {
    const apiKey = process.env.AGENTMAIL_API_KEY;
    let mailboxEmail = `${args.usernamePrefix}-${Date.now().toString().slice(-4)}@agentmail.to`;
    let mailboxId = `inbox_${Date.now().toString().slice(-6)}`;

    if (apiKey) {
      try {
        const inbox = await agentmail.createInbox(ctx as any, {
          username: `${args.usernamePrefix}-${Date.now().toString().slice(-4)}`,
          displayName: "TradePulse RFQ Portal",
        });
        mailboxEmail = inbox.email;
        mailboxId = (inbox as any).inbox_id || (inbox as any).id || mailboxId;
      } catch (err) {
        console.warn("AgentMail live inbox creation failed (offline or test key), using provisioned address:", err);
      }
    }

    await ctx.runMutation(internal.tradePackages.updateMailbox, {
      tradePackageId: args.tradePackageId,
      agentMailbox: mailboxEmail,
      agentMailboxId: mailboxId,
    });

    return { email: mailboxEmail, id: mailboxId };
  },
});

export const dispatchRfqsWithNotification = action({
  args: {
    tradePackageId: v.id("tradePackages"),
  },
  handler: async (ctx, args): Promise<any> => {
    // 1. Run mutation to mark contractors invited and package dispatched
    const result: any = await ctx.runMutation(internal.rfq.dispatchRfqsInternal, {
      tradePackageId: args.tradePackageId,
    });

    // 2. Fetch package details
    const tradePkg = await ctx.runQuery(internal.tradePackages.getPackageInternal, {
      tradePackageId: args.tradePackageId,
    });
    if (!tradePkg) throw new Error("Trade package not found");

    // Fetch project details for dynamic email subject & text
    const project = await ctx.runQuery(internal.projects.getProjectInternal, {
      projectId: tradePkg.projectId,
    });

    // 3. Fetch invited contractors
    const contractors = await ctx.runQuery(internal.contractors.listByPackageInternal, {
      tradePackageId: args.tradePackageId,
    });

    const apiKey = process.env.AGENTMAIL_API_KEY;
    let emailsSent = 0;

    if (apiKey && tradePkg.agentMailboxId) {
      for (const contractor of contractors) {
        if (contractor.contactEmail && contractor.contactEmail.includes("@")) {
          try {
            await agentmail.sendMessage(ctx as any, tradePkg.agentMailboxId, {
              to: contractor.contactEmail,
              subject: `INVITATION TO BID: ${tradePkg.tradeName} (CSI ${tradePkg.csiDivision}) - ${project?.title || "Commercial Development"}`,
              text: `Dear ${contractor.companyName} Estimating Team,\n\nYou are invited to submit a proposal for ${tradePkg.tradeName} for ${project?.title || "our commercial development"} located in ${project?.location || "the area"}.\n\nMandatory Inclusions:\n${tradePkg.mandatoryInclusions.map((inc: string) => `- ${inc}`).join("\n")}\n\nBid Deadline: ${tradePkg.bidDeadline}\n\nPlease submit all pre-bid RFIs and final proposals directly to this project email address: ${tradePkg.agentMailbox}.\n\nTradePulse Pro Procurement Team`,
            });
            emailsSent++;
          } catch (err) {
            console.warn(`Failed to dispatch email to ${contractor.contactEmail}:`, err);
          }
        }
      }
    }

    return {
      ...result,
      emailsSent,
    };
  },
});

export const dispatchSingleRfqWithNotification = action({
  args: {
    contractorId: v.id("contractors"),
  },
  handler: async (ctx, args): Promise<any> => {
    // 1. Fetch contractor details
    const contractor = await ctx.runQuery(internal.contractors.getContractorInternal, {
      contractorId: args.contractorId,
    });
    if (!contractor) throw new Error("Contractor not found");

    // 2. Fetch trade package details
    const tradePkg = await ctx.runQuery(internal.tradePackages.getPackageInternal, {
      tradePackageId: contractor.tradePackageId,
    });
    if (!tradePkg) throw new Error("Trade package not found");

    // 3. Fetch project details
    const project = await ctx.runQuery(internal.projects.getProjectInternal, {
      projectId: tradePkg.projectId,
    });

    // 4. Update contractor status and log audit record
    await ctx.runMutation(internal.rfq.markSingleContractorInvitedInternal, {
      contractorId: args.contractorId,
      tradePackageId: tradePkg._id,
    });

    // 5. Dispatch email via AgentMail if available
    const apiKey = process.env.AGENTMAIL_API_KEY;
    let emailSent = false;
    if (apiKey && tradePkg.agentMailboxId && contractor.contactEmail && contractor.contactEmail.includes("@")) {
      try {
        await agentmail.sendMessage(ctx as any, tradePkg.agentMailboxId, {
          to: contractor.contactEmail,
          subject: `INVITATION TO BID: ${tradePkg.tradeName} (CSI ${tradePkg.csiDivision}) - ${project?.title || "Commercial Development"}`,
          text: `Dear ${contractor.companyName} Estimating Team,\n\nYou are invited to submit a proposal for ${tradePkg.tradeName} on ${project?.title || "our commercial development"} located in ${project?.location || "the area"}.\n\nMandatory Inclusions:\n${tradePkg.mandatoryInclusions.map((inc: string) => `- ${inc}`).join("\n")}\n\nBid Deadline: ${tradePkg.bidDeadline}\n\nPlease submit all pre-bid RFIs and final proposals directly to this project email address: ${tradePkg.agentMailbox}.\n\nTradePulse Pro Procurement Team`,
        });
        emailSent = true;
      } catch (err) {
        console.warn(`Failed to dispatch single RFQ email to ${contractor.contactEmail}:`, err);
      }
    }

    return {
      success: true,
      contractorId: args.contractorId,
      emailSent,
    };
  },
});
