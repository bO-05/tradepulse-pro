import { defineApp } from "convex/server";
import { v } from "convex/values";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import firecrawl from "@firecrawl/firecrawl-convex/convex.config";
import agentmail from "@agentmail/convex/convex.config";

const app = defineApp({
  env: {
    FIRECRAWL_API_KEY: v.string(),
    FIRECRAWL_WEBHOOK_SECRET: v.optional(v.string()),
    AGENTMAIL_API_KEY: v.optional(v.string()),
    AGENTMAIL_WEBHOOK_SECRET: v.optional(v.string()),
    OPENAI_API_KEY: v.optional(v.string()),
    GEMINI_API_KEY: v.optional(v.string()),
    ANTHROPIC_API_KEY: v.optional(v.string()),
    VERTEX_PROJECT_ID: v.optional(v.string()),
    VERTEX_LOCATION: v.optional(v.string()),
    VERTEX_ACCESS_TOKEN: v.optional(v.string()),
    VERTEX_API_KEY: v.optional(v.string()),
    VERTEX_MODEL: v.optional(v.string()),
    GEMINI_MODEL: v.optional(v.string()),
    ANTHROPIC_MODEL: v.optional(v.string()),
    OPENAI_MODEL: v.optional(v.string()),
  },
});

// 1. Static hosting on https://brainy-skunk-440.convex.site (app-owned root router mode)
app.use(staticHosting);

// 2. Firecrawl web discovery & durable crawler component
app.use(firecrawl, {
  httpPrefix: "/firecrawl/",
  env: {
    FIRECRAWL_API_KEY: app.env.FIRECRAWL_API_KEY as any,
    FIRECRAWL_WEBHOOK_SECRET: app.env.FIRECRAWL_WEBHOOK_SECRET,
  },
});

// 3. AgentMail programmatic inbox component
app.use(agentmail);

export default app;
