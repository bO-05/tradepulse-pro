/**
 * CONV-C 03 (audit-6 check 4 + new-finding sweep): RFQ honesty on the demo.
 * Drives the UI but never clicks any dispatch/invite control.
 * Also captures the live audit stream strings that assert email delivery / registry verification.
 */
import fs from "node:fs";
import path from "node:path";
import { openApp, clickTab, selectProject, selectRibbonPackage, q, writeEvidence, delay } from "./lib.mjs";

const out = { startedAt: new Date().toISOString(), dispatchedAnything: false };
const { browser, page } = await openApp(1440, 900);
try {
  const projects = (await q("projects:listProjects", {})) || [];
  const demo = projects.find((p) => /The Domain Tower B/i.test(p.title));
  await selectProject(page, demo._id);
  await delay(1800);

  // --- Packages tab: dispatch control copy + inbox labels (read-only) ---
  await clickTab(page, "01:");
  await delay(1400);
  out.packagesDom = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("h3")]
      .filter((h) => /Systems|Lighting|Air Conditioning|Plumbing/.test(h.textContent || ""))
      .map((h) => {
        let node = h;
        for (let i = 0; i < 6 && node; i++) {
          node = node.parentElement;
          if (node && /AgentMail Inbox:/.test(node.innerText || "")) break;
        }
        if (!node) return null;
        const txt = node.innerText.replace(/\n+/g, " | ");
        const inbox = (txt.match(/AgentMail Inbox: \| ([^\s|]+)/) || [])[1] || null;
        const warn = (node.innerText.match(/(Shared inbox[^\n]*|Inbox not provisioned[^\n]*|Email delivery unavailable[^\n]*)/) || [])[0] || null;
        const dispatch = [...node.querySelectorAll("button")].find((b) => /Dispatch RFQs/.test(b.textContent || ""));
        return {
          heading: h.textContent.trim(),
          inbox,
          warning: warn,
          dispatchTitle: dispatch ? dispatch.getAttribute("title") : null,
          dispatchDisabled: dispatch ? dispatch.disabled : null,
        };
      })
      .filter(Boolean);
    return cards;
  });
  await page.screenshot({ path: path.join(process.cwd(), "evidence", "fix6-conv-c-03-rfq-packages.png") });

  // --- Discovery tab: contractor invite affordances (not clicked) ---
  await clickTab(page, "02:");
  await delay(1600);
  await selectRibbonPackage(page, "Electrical & Lighting Systems");
  await delay(1200);
  out.discoveryDom = await page.evaluate(() => {
    const inviteButtons = [...document.querySelectorAll("button")].filter((b) => /Invite to Bid/.test(b.textContent || ""));
    const cardRoots = [...document.querySelectorAll("h3")].filter((h) => /Electric|Alterman/.test(h.textContent || ""));
    return {
      inviteButtonCount: inviteButtons.length,
      inviteTitles: inviteButtons.map((b) => b.getAttribute("title")),
      headings: cardRoots.map((h) => h.textContent.trim()),
      bodyMentions: {
        tdlr: /TDLR/i.test(document.body.innerText),
        agentMail: /AgentMail/i.test(document.body.innerText),
        delivered: /delivered/i.test(document.body.innerText),
      },
    };
  });
  await page.screenshot({ path: path.join(process.cwd(), "evidence", "fix6-conv-c-03-rfq-discovery.png") });

  // --- Audit tab: capture delivery/verification claims visible in the live stream ---
  await clickTab(page, "Live Activity Audit");
  await delay(1800);
  out.auditTab = await page.evaluate(() => {
    const main = document.querySelector("main") || document.body;
    const text = main.innerText;
    const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
    const claimLines = lines.filter((l) => /TDLR|via AgentMail|dispatched to verified|registry/i.test(l));
    return { claimLines, excerpt: text.slice(0, 4000).replace(/\n+/g, " | ") };
  });
  await page.screenshot({ path: path.join(process.cwd(), "evidence", "fix6-conv-c-03-rfq-audit.png") });

  // --- Backend: exact live rows matching the claims (read-only) ---
  const logs = (await q("auditLogs:listRecentLogs", { projectId: demo._id, limit: 500 })) || [];
  out.liveAuditClaims = logs
    .filter((l) => /TDLR|via AgentMail|dispatched to verified|registry/i.test(`${l.title} ${l.description}`))
    .map((l) => ({ title: l.title, description: l.description, actor: l.actor, timestampIso: new Date(l.timestamp).toISOString() }));

  // --- Code-string check: single-dispatch toast guard in src/App.tsx ---
  const appSrc = fs.readFileSync(path.join(process.cwd(), "src", "App.tsx"), "utf8");
  const lines = appSrc.split(/\r?\n/);
  const all = [];
  lines.forEach((line, i) => {
    if (/via AgentMail|AgentMail/i.test(line) && /showToast|description:/.test(line)) {
      all.push({ line: i + 1, code: line.trim(), previous: lines[i - 1]?.trim(), next: lines[i + 1]?.trim() });
    }
  });
  // Locate the single-dispatch handler block
  const start = appSrc.indexOf("const handleDispatchIndividualRfq");
  const end = appSrc.indexOf("const handleCreateContractor", start);
  const handler = appSrc.slice(start, end).split(/\r?\n/);
  out.singleDispatch = {
    startLine: lines.findIndex((l) => l.includes("const handleDispatchIndividualRfq")) + 1,
    toasts: handler
      .map((l, i) => ({ relLine: i + 1, text: l.trim() }))
      .filter((x) => /showToast|emailSent|deliveryConfigured|res\./.test(x.text)),
  };
  out.unconditionalToastInSingleDispatch = handler.some(
    (l) => /showToast\(.*delivered via AgentMail/.test(l) && !/emailSent/.test(handler.join("\n").slice(Math.max(0, handler.join("\n").indexOf(l) - 400), handler.join("\n").indexOf(l)))
  );
  out.allShowToastAgentmailLines = all;
} catch (err) {
  out.error = String(err?.stack ?? err);
} finally {
  await browser.close();
}
writeEvidence("fix6-conv-c-03-rfq-honesty.json", out);
console.log(
  JSON.stringify(
    {
      packagesDom: out.packagesDom,
      discoveryDom: out.discoveryDom,
      auditClaimLines: out.auditTab?.claimLines,
      liveAuditClaims: out.liveAuditClaims,
      singleDispatch: out.singleDispatch,
      allShowToastAgentmailLines: out.allShowToastAgentmailLines,
      error: out.error,
    },
    null,
    1
  )
);