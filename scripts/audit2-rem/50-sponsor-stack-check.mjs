import fs from "node:fs";
import { ConvexHttpClient } from "convex/browser";

const REPO = "D:/Repo/ALL HACKATHONS/Convex/Convex all gas";
const env = {};
for (const line of fs.readFileSync(`${REPO}/.env.local`, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)$/);
  if (m) env[m[1]] = m[2].trim();
}
const DEV = "https://brilliant-ferret-962.convex.cloud";
const c = new ConvexHttpClient(DEV);
const out = { checkedAt: new Date().toISOString(), raw: {}, app: {} };

const mask = (s) => (typeof s === "string" && s.length > 6 ? s.slice(0, 3) + "…" + s.slice(-3) : s);

// ---------- Raw Firecrawl
try {
  const t0 = Date.now();
  const res = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "commercial electrical contractors Austin TX license", limit: 5, country: "US" }),
  });
  const body = await res.json().catch(() => ({}));
  const items = Array.isArray(body.data) ? body.data : Array.isArray(body.data?.web) ? body.data.web : Array.isArray(body.web) ? body.web : [];
  out.raw.firecrawl = {
    status: res.status,
    ms: Date.now() - t0,
    resultCount: items.length,
    topTitles: items.slice(0, 5).map((i) => (i.title || "").slice(0, 70)),
    success: res.ok && items.length > 0,
  };
} catch (e) {
  out.raw.firecrawl = { success: false, error: String(e.message).slice(0, 200) };
}

// ---------- Raw AgentMail
let inboxes = [];
try {
  const res = await fetch("https://api.agentmail.to/v0/inboxes?limit=10", {
    headers: { Authorization: `Bearer ${env.AGENTMAIL_API_KEY}` },
  });
  const body = await res.json().catch(() => ({}));
  inboxes = body.inboxes || body.data || [];
  out.raw.agentmail = { status: res.status, inboxCount: inboxes.length, sampleEmails: inboxes.slice(0, 3).map((i) => mask(i.email || i.address)) , success: res.ok };
} catch (e) {
  out.raw.agentmail = { success: false, error: String(e.message).slice(0, 200) };
}

// ---------- App-level integration on DEV
const PROJECT_TITLE = "AUDIT-SPONSOR-2026-09-17";
let projectId = null;
let packageId = null;
let provisioned = null;
try {
  projectId = await c.mutation("projects:createProject", {
    title: PROJECT_TITLE,
    location: "Austin, TX",
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: 3_000_000,
    targetCompletionWeeks: 52,
    specDocumentText: "SPONSOR STACK CHECK. SECTION 26 00 00 - ELECTRICAL: switchgear, distribution.",
    isDemoProject: false,
  });
  packageId = await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision: "26 00 00",
    tradeName: "Sponsor Check Electrical",
    budgetEstimate: 1_000_000,
    scopeSummary: "Sponsor stack verification scope.",
    mandatoryInclusions: ["Switchgear", "Seismic bracing"],
    bidDeadline: "2026-10-31",
  });
  out.app.fixture = { projectId, packageId };

  // Discovery through the fixed backend
  const t0 = Date.now();
  const disc = await c.action("contractorDiscovery:discoverSubcontractors", { tradePackageId: packageId });
  const contractors = await c.query("contractors:listByPackage", { tradePackageId: packageId });
  out.app.discovery = {
    ms: Date.now() - t0,
    source: disc.source,
    discoveredCount: disc.discoveredCount,
    provenanceLabels: [...new Set(contractors.map((x) => x.licenseStatus))],
    records: contractors.slice(0, 5).map((x) => ({ name: x.companyName, email: x.contactEmail, phone: x.phone || null, license: x.licenseNumber, status: x.licenseStatus })),
  };

  // Provision a real inbox
  provisioned = await c.action("rfqActions:provisionPackageInbox", { tradePackageId: packageId, usernamePrefix: "audit-sponsor" });
  out.app.provision = { email: provisioned.email, idPrefix: String(provisioned.id).slice(0, 12), looksSynthetic: String(provisioned.id).startsWith("inbox_") };

  // Create a self-recipient contractor and dispatch a real RFQ to our own inbox
  if (provisioned && provisioned.live && !provisioned.shared) {
    await c.mutation("contractors:createContractor", {
      tradePackageId: packageId,
      companyName: "AUDIT Self-Send Recipient",
      contactEmail: provisioned.email,
      phone: "+1 (512) 555-0100",
      licenseNumber: "AUDIT-SELF",
      licenseStatus: "Test recipient",
      sourceUrl: "https://agentmail.to",
      rfqStatus: "discovered",
    });
    const dispatch = await c.action("rfqActions:dispatchRfqsWithNotification", { tradePackageId: packageId });
    out.app.dispatch = { emailsSent: dispatch.emailsSent, dispatchedCount: dispatch.dispatchedCount, failures: dispatch.deliveryFailures };

    let delivered = null;
    for (let i = 0; i < 18; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const res = await fetch(`https://api.agentmail.to/v0/inboxes/${provisioned.id}/threads?limit=5`, {
        headers: { Authorization: `Bearer ${env.AGENTMAIL_API_KEY}` },
      });
      if (!res.ok) { delivered = { status: res.status }; continue; }
      const body = await res.json().catch(() => ({}));
      const threads = body.threads || body.data || [];
      if (threads.length > 0) {
        delivered = { threadCount: threads.length, subject: (threads[0].subject || threads[0].messages?.[0]?.subject || "").slice(0, 90), waitedMs: (i + 1) * 5000 };
        break;
      }
      delivered = { threadCount: 0 };
    }
    out.app.delivery = delivered;
  } else if (provisioned) {
    out.app.dispatch = { skipped: true, reason: provisioned.shared ? "Inbox reused (plan limit); skipped to avoid writing into the demo inboxes before your decision." : "No live inbox available." };
  }

  // Cleanup fixture + inbox
  await c.mutation("projects:deleteProject", { projectId });
  // Only delete an inbox this run actually created; never delete a reused demo inbox.
  if (provisioned && provisioned.live && !provisioned.shared) {
    try {
      const del = await fetch(`https://api.agentmail.to/v0/inboxes/${provisioned.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${env.AGENTMAIL_API_KEY}` } });
      out.app.cleanup = { inboxDeleteStatus: del.status, projectDeleted: true };
    } catch (e) {
      out.app.cleanup = { inboxDeleteError: String(e.message).slice(0, 120), projectDeleted: true };
    }
  } else {
    out.app.cleanup = { projectDeleted: true, inboxDeleteSkipped: provisioned ? (provisioned.shared ? "reused inbox left untouched" : "no live inbox") : "none" };
  }
} catch (e) {
  out.error = String(e.stack || e).slice(0, 800);
  if (projectId) { try { await c.mutation("projects:deleteProject", { projectId }); out.app.cleanup = "project deleted after error"; } catch {} }
}

fs.writeFileSync(`${REPO}/evidence/fix-sponsor-stack-check.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));