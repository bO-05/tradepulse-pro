import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { AgentMail } from "@agentmail/convex";
import { components, internal } from "./_generated/api";
import { getRealDocumentPdfBytes } from "./realDocuments";

const http = httpRouter();

// Inbound AgentMail Webhook (Svix signature verification when secret is configured, resilient ingestion fallback otherwise)
http.route({
  path: "/agentmail/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;
    const hasSvixHeaders =
      Boolean(req.headers.get("svix-id")) &&
      Boolean(req.headers.get("svix-signature"));

    // Enforce Svix cryptographic verification whenever secret is configured
    if (secret) {
      if (!hasSvixHeaders) {
        return new Response(
          JSON.stringify({ error: "Missing required svix headers for signature verification" }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
      }
      try {
        const activeAgentMail = new AgentMail(components.agentmail, {
          webhookSecret: secret,
          onMessageReceived: internal.email.onMessageReceived,
        });
        return await activeAgentMail.handleWebhook(ctx as any, req);
      } catch (err: any) {
        console.warn("AgentMail Svix verification failed:", err?.message || err);
        return new Response(
          JSON.stringify({ error: err?.message || "Webhook verification failed" }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Resilient fallback mode: Ingest webhook gracefully even if secret is not yet set
    try {
      const rawText = await req.text();
      const payload = rawText ? JSON.parse(rawText) : {};
      const message = payload.message || payload.data?.message || payload;
      const thread = payload.thread || payload.data?.thread || {};
      const eventId = payload.event_id || payload.id || `evt_${Date.now()}`;

      if (message && (message.text || message.subject || message.body || message.from)) {
        await ctx.runMutation(internal.email.onMessageReceived, {
          message,
          thread,
          eventId,
        });
      }

      return new Response(
        JSON.stringify({
          status: "received",
          mode: "resilient_unverified",
          eventId,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (err: any) {
      console.warn("Resilient webhook processing error:", err);
      return new Response(
        JSON.stringify({ error: err?.message || "Webhook processing error" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
  }),
});

// AgentMail Webhook status / health probe
http.route({
  path: "/agentmail/webhook",
  method: "GET",
  handler: httpAction(async () => {
    const isConfigured = Boolean(process.env.AGENTMAIL_WEBHOOK_SECRET);
    return new Response(
      JSON.stringify({
        status: "active",
        endpoint: "/agentmail/webhook",
        svixVerification: isConfigured ? "enforced" : "resilient_fallback",
        instructions: isConfigured
          ? "Webhook secret configured and active."
          : "Webhook active in resilient mode. Set AGENTMAIL_WEBHOOK_SECRET for cryptographic verification.",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }),
});

// Wayne Sutton / Vibe Apps llms.txt discoverability endpoint
http.route({
  path: "/llms.txt",
  method: "GET",
  handler: httpAction(async () => {
    const siteUrl = process.env.CONVEX_SITE_URL || "https://brainy-skunk-440.convex.site";
    const manifest = `# TradePulse Pro - Autonomous Construction Procurement API
> Autonomous Trade Subcontractor Procurement, RFQ Distribution & Real-Time Bid Leveling
> Built for the Convex "All Gas" Hackathon 2026

## Overview
TradePulse Pro automates the $1.8T commercial construction subcontractor procurement workflow:
1. CSI MasterFormat Trade Scoping (Div 22 Plumbing, Div 23 HVAC, Div 26 Electrical)
2. Subcontractor Web Discovery & Licensing Verification via Firecrawl
3. Dedicated Stateful Project Inboxes via AgentMail (@agentmail.to)
4. Autonomous Pre-Bid RFI Clarifications via OpenAI & Gemini high-throughput reasoning
5. Forensic Bid Leveling & Scope Gap Normalization via Claude & OpenAI

## Live Endpoints & Endpoints Specification
- Web UI: ${siteUrl}
- Webhook Ingest: POST ${siteUrl}/agentmail/webhook
- Discoverability: GET ${siteUrl}/llms.txt
- Reactive Engine: Convex Realtime WebSockets (Zero Polling Invariant)

## Normalization Formula (ADR-0003)
Leveled Cost = Base Bid + Sum(Scope Gaps) + Lead Time Penalty + COI Penalty - Accepted Alternates

## Sponsor Synergy
- Convex: Reactive backend, real-time database, scheduled functions, HTTP actions, static hosting
- OpenAI: Primary LLM pipeline for bid parsing, RFI extraction, and leveling calculations
- Firecrawl: Subcontractor web discovery and state licensing verification
- AgentMail: Stateful programmatic email inboxes for subcontractor bidding
`;
    return new Response(manifest, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }),
});

// Health check endpoint
http.route({
  path: "/api/health",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(
      JSON.stringify({
        status: "ok",
        app: "TradePulse Pro",
        timestamp: Date.now(),
        version: "1.0.0",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }),
});

// Helper function to serve authentic construction PDF documents
function serveRealDocument(fileName: string): Response {
  const cleanName = fileName.replace(/^[/\\]+/, "").split(/[?#]/)[0];
  const pdfBytes = getRealDocumentPdfBytes(cleanName);
  if (!pdfBytes) {
    return new Response(
      JSON.stringify({
        error: "Document not found in certified registry",
        requestedFile: cleanName,
        availableDocuments: [
          "01_00_00_General_Requirements.pdf",
          "26_00_00_Electrical_Systems_Spec.pdf",
          "23_00_00_HVAC_Systems_Spec.pdf",
          "22_00_00_Plumbing_Systems_Spec.pdf",
          "E-101_Main_Switchgear_Penthouse_Plan.pdf",
          "Rosendin_Electric_Proposal_AIA.pdf",
          "Alterman_Power_Quote_Proposal.pdf",
          "Rosendin_Electric_ACORD25_COI.pdf",
        ],
      }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(pdfBytes as any, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${cleanName}"`,
      "Content-Length": String(pdfBytes.length),
      "Cache-Control": "no-cache, must-revalidate",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// 1. CSI MasterFormat Technical Specifications (Div 01, Div 26, Div 23, Div 22)
http.route({
  pathPrefix: "/specs/",
  method: "GET",
  handler: httpAction(async (_ctx, req) => {
    const url = new URL(req.url);
    const fileName = url.pathname.replace(/^\/specs\//, "");
    return serveRealDocument(fileName);
  }),
});

// 2. BIM Architectural Drawings & Switchgear Penthouse Blueprints
http.route({
  pathPrefix: "/drawings/",
  method: "GET",
  handler: httpAction(async (_ctx, req) => {
    const url = new URL(req.url);
    const fileName = url.pathname.replace(/^\/drawings\//, "");
    return serveRealDocument(fileName);
  }),
});

// 3. Subcontractor Itemized Proposals & AIA Quotations
http.route({
  pathPrefix: "/quotes/",
  method: "GET",
  handler: httpAction(async (_ctx, req) => {
    const url = new URL(req.url);
    const fileName = url.pathname.replace(/^\/quotes\//, "");
    return serveRealDocument(fileName);
  }),
});

// 4. ACORD 25 Certificates of Liability Insurance
http.route({
  pathPrefix: "/insurance/",
  method: "GET",
  handler: httpAction(async (_ctx, req) => {
    const url = new URL(req.url);
    const fileName = url.pathname.replace(/^\/insurance\//, "");
    return serveRealDocument(fileName);
  }),
});

// 5. Universal Document Access Endpoints
http.route({
  pathPrefix: "/api/files/",
  method: "GET",
  handler: httpAction(async (_ctx, req) => {
    const url = new URL(req.url);
    const fileName = url.pathname.replace(/^\/api\/files\//, "");
    return serveRealDocument(fileName);
  }),
});

http.route({
  pathPrefix: "/files/",
  method: "GET",
  handler: httpAction(async (_ctx, req) => {
    const url = new URL(req.url);
    const fileName = url.pathname.replace(/^\/files\//, "");
    return serveRealDocument(fileName);
  }),
});

// CRITICAL: Register static routes at the end of app-owned HTTP router!
registerStaticRoutes(http, components.staticHosting);

export default http;
