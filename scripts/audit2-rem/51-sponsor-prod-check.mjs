import fs from "node:fs";
import { ConvexHttpClient } from "convex/browser";

const REPO = "D:/Repo/ALL HACKATHONS/Convex/Convex all gas";
const env = {};
for (const line of fs.readFileSync(`${REPO}/.env.local`, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)$/);
  if (m) env[m[1]] = m[2].trim();
}
const URL = process.env.SPONSOR_TARGET || "https://brainy-skunk-440.convex.cloud";
const c = new ConvexHttpClient(URL);
const out = { target: URL, checkedAt: new Date().toISOString(), app: {} };
const PROJECT_TITLE = "AUDIT-SPONSOR-PROD-2026-09-17";
let projectId = null;
let provisioned = null;

try {
  projectId = await c.mutation("projects:createProject", {
    title: PROJECT_TITLE,
    location: "Austin, TX",
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: 2_000_000,
    targetCompletionWeeks: 52,
    specDocumentText: "SPONSOR CHECK.",
    isDemoProject: false,
  });
  const packageId = await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision: "26 00 00",
    tradeName: "Sponsor Check Electrical",
    budgetEstimate: 900_000,
    scopeSummary: "Sponsor stack verification.",
    mandatoryInclusions: ["Switchgear"],
    bidDeadline: "2026-10-31",
  });
  out.app.fixture = { projectId, packageId };

  try {
    provisioned = await c.action("rfqActions:provisionPackageInbox", { tradePackageId: packageId, usernamePrefix: "audit-sponsor" });
    out.app.provision = { email: provisioned.email, id: String(provisioned.id).slice(0, 16), looksSynthetic: String(provisioned.id).startsWith("inbox_") };
  } catch (e) {
    out.app.provision = { error: String(e.message || e).slice(0, 300) };
  }

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
    out.app.dispatch = { emailsSent: dispatch.emailsSent, dispatchedCount: dispatch.dispatchedCount };

    let delivered = null;
    for (let i = 0; i < 18; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const res = await fetch(`https://api.agentmail.to/v0/inboxes/${provisioned.id}/threads?limit=5`, {
        headers: { Authorization: `Bearer ${env.AGENTMAIL_API_KEY}` },
      });
      if (!res.ok) { delivered = { status: res.status }; continue; }
      const body = await res.json().catch(() => ({}));
      const threads = body.threads || body.data || [];
      delivered = { threadCount: threads.length, subject: threads[0]?.subject || threads[0]?.messages?.[0]?.subject || null, waitedMs: (i + 1) * 5000 };
      if (threads.length > 0) break;
    }
    out.app.delivery = delivered;
  }
} catch (e) {
  out.error = String(e.stack || e).slice(0, 600);
} finally {
  if (projectId) { try { await c.mutation("projects:deleteProject", { projectId }); out.app.projectDeleted = true; } catch (e) { out.app.projectDeleteError = String(e.message).slice(0, 160); } }
  if (provisioned && provisioned.live && !provisioned.shared) {
    try {
      const del = await fetch(`https://api.agentmail.to/v0/inboxes/${provisioned.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${env.AGENTMAIL_API_KEY}` } });
      out.app.inboxDeleteStatus = del.status;
    } catch (e) { out.app.inboxDeleteError = String(e.message).slice(0, 120); }
  }
}

fs.writeFileSync(`${REPO}/evidence/fix-sponsor-prod-check.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));