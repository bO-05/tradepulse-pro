/**
 * Direct AgentMail REST client.
 *
 * The published `@agentmail/convex` component reads its credentials via
 * `process.env` *inside the component sandbox*, and Convex components do not
 * inherit the host deployment's environment (the component does not declare an
 * `env` schema, so values cannot be passed through `app.use` either). That
 * leaves the component's outbound calls without a key on current Convex
 * releases. These helpers call the documented AgentMail API from the host app
 * with the deployment's own `AGENTMAIL_API_KEY`, so inbox provisioning and
 * sending actually work (and give us a real 2xx to report instead of an
 * enqueue-only success). The mounted component is still used for Svix-verified
 * inbound webhook persistence.
 */

const DEFAULT_BASE_URL = "https://api.agentmail.to/v0";
const REQUEST_TIMEOUT_MS = 20_000;

interface AgentmailConfig {
  apiKey: string;
  baseUrl: string;
}

function getConfig(): AgentmailConfig {
  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "AGENTMAIL_API_KEY is not set on this Convex deployment. Run `npx convex env set AGENTMAIL_API_KEY <key>`."
    );
  }
  const baseUrl = (process.env.AGENTMAIL_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  return { apiKey, baseUrl };
}

export function isAgentmailConfigured(): boolean {
  return Boolean(process.env.AGENTMAIL_API_KEY);
}

async function agentmailFetch<T = any>(
  path: string,
  options: { method: "GET" | "POST" | "DELETE"; body?: unknown; query?: Record<string, string | number | undefined> }
): Promise<T> {
  const { apiKey, baseUrl } = getConfig();
  const url = new URL(baseUrl + path);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      method: options.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`AgentMail API ${response.status}: ${text.slice(0, 300)}`);
    }
    return (text ? JSON.parse(text) : null) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface ProvisionedInbox {
  id: string;
  email: string;
}

export async function createAgentmailInbox(request: { username?: string; displayName?: string }): Promise<ProvisionedInbox> {
  const inbox: any = await agentmailFetch("/inboxes", {
    method: "POST",
    body: {
      username: request.username,
      display_name: request.displayName,
    },
  });
  const id = inbox?.inbox_id || inbox?.id;
  const email = inbox?.email || inbox?.address;
  if (!id || !email) {
    throw new Error("AgentMail returned an inbox without an id/email.");
  }
  return { id: String(id), email: String(email) };
}

export async function deleteAgentmailInbox(inboxId: string): Promise<void> {
  await agentmailFetch(`/inboxes/${encodeURIComponent(inboxId)}`, { method: "DELETE" });
}

export async function sendAgentmailMessage(args: {
  inboxId: string;
  to: string;
  subject: string;
  text: string;
}): Promise<{ messageId: string; threadId: string }> {
  const response: any = await agentmailFetch(`/inboxes/${encodeURIComponent(args.inboxId)}/messages/send`, {
    method: "POST",
    body: {
      to: args.to,
      subject: args.subject,
      text: args.text,
    },
  });
  return {
    messageId: String(response?.message_id ?? ""),
    threadId: String(response?.thread_id ?? ""),
  };
}

export async function listAgentmailInboxes(limit = 20): Promise<ProvisionedInbox[]> {
  const response: any = await agentmailFetch("/inboxes", { method: "GET", query: { limit } });
  const raw = response?.inboxes ?? response?.data ?? [];
  return raw
    .map((inbox: any) => ({
      id: String(inbox?.inbox_id || inbox?.id || ""),
      email: String(inbox?.email || inbox?.address || ""),
    }))
    .filter((inbox: ProvisionedInbox) => inbox.id && inbox.email);
}

export async function listAgentmailThreads(inboxId: string, limit = 10): Promise<any[]> {
  const response: any = await agentmailFetch(`/inboxes/${encodeURIComponent(inboxId)}/threads`, {
    method: "GET",
    query: { limit },
  });
  return response?.threads ?? response?.data ?? [];
}