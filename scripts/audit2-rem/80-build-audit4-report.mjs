import fs from "node:fs";
import path from "node:path";

const REPO = "D:/Repo/ALL HACKATHONS/Convex/Convex all gas";
const EV = path.join(REPO, "evidence");
const T = path.join(REPO, "scripts/audit2-rem/audit4");
const OUT = path.join(REPO, "TradePulse-Pro-User-Journey-Audit-2026-09-18-0910-UTC.html");

const rows = (arr) => arr.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("\n");
const P = '<span class="pill s-pass">Pass</span>';
const F = '<span class="pill s-fail">Fixed</span>';
const C = '<span class="pill s-warn">Clarified</span>';
const NA = '<span class="pill s-na">N/A</span>';

const regression = [
  ["BUG-01", "New Project modal centred, all fields reachable, focus trapped, ESC restores", P, "Modal top 189px, not in header, all 7 fields visible. Real mouse click → focus inside; ESC → focus back on “New Project” button. <span class='mono'>audit4-newproject-modal.png</span>"],
  ["BUG-02/36", "Tour narration reads live data; no hard-coded demo totals", P, "Scene 04 cue: paper $1,100,000 → gaps $186,000 → leveled $1,225,000 → variance $61,000; matches the matrix. <span class='mono'>audit4-tour-scene4.png</span>"],
  ["BUG-04", "Auto-scope submit disabled on empty/whitespace spec", P, "Carried forward; unchanged code. Covered by the honesty/source suite."],
  ["BUG-06", "KPI says “best bid per package”", P, "KPI band label verified live; backend computed buyout 3,918,500 matches UI."],
  ["BUG-07", "Zero-recipient dispatch errors; package stays draft; no dispatched event", P, "Backend after double-click: status <span class='mono'>draft</span>, 0 <span class='mono'>rfq_dispatched</span> events (zero-contractor package)."],
  ["BUG-08", "RFI in-flight banner", P, "Carried forward; RFI arrived at ~25s with the pending banner path already verified in the previous remediation pass."],
  ["BUG-09", "AI clarification rendered as formatted text", P, "RFI card renders clean text (no raw markdown) in both contexts. <span class='mono'>audit4-realtime-A-after.png</span>"],
  ["BUG-10/28", "Full local date + timezone timestamps", P, "Audit: “Sep 18, 2026, 03:45:54 PM GMT+7”; RFI: “Sep 18, 2026, 04:02:33 PM GMT+7”. <span class='mono'>audit4-audit-timestamps.png</span>"],
  ["BUG-11", "Addendum naming + terminology; zero-RFI UI guard", P, "Carried forward; verified in the previous pass and unchanged."],
  ["BUG-12", "Download saves stored bytes under the record name", P, "Uploaded 43-byte proof file; download saved <span class='mono'>audit4-upload-proof.txt</span> containing the exact payload."],
  ["BUG-13", "Upload accept matches type; clear rejection otherwise", P, "Spec-type .txt accepted and listed; blueprint-type rejection path unchanged."],
  ["BUG-14", "Truthful preview caption", P, "Preview shows the stored text and caption “Stored in Convex _storage…”; no “100% Real…” claim."],
  ["BUG-15", "Confirmations stack safely, header dialogs not clipped", P, "Carried forward; ConfirmDialog portal/stacking unchanged and previously verified."],
  ["BUG-16", "Discovery records only published data with provenance", P, "Live run: 3 records, all “Unverified — from web search result”, no TDLR badges, no sequential licence pattern, “Contact not published” shown. <span class='mono'>audit4-discovery.png</span>"],
  ["BUG-17", "Simulation control label matches behavior", P, "Toolbar reads “Simulate Inbound Bid…” and opens the dock (unchanged from fix)."],
  ["BUG-18", "Gaps Exposed reconciles with the flagged bid", P, "KPI +$186,000 = Alterman 147,000 + 24,000 + 15,000 (backend bid data)."],
  ["BUG-19/20/21/22", "CSV/clash terminology consistent", P, "Source-level honesty suite passes; unchanged from the remediation pass."],
  ["BUG-23/25/27", "Contract sum, matrix and tour agree", P, "UI contract sum 1,225,000 = backend agreement sum; tour scene 06 interpolates the same value."],
  ["BUG-24", "LD vs lead-time terms separated", P, "Register shows LDs $1,200/day; leveling copy names the $6,000/week lead-time rate separately."],
  ["BUG-26", "Award count identical across surfaces", P, "KPI 1/3 = stepper 1/3 = one non-superseded agreement in the backend."],
  ["BUG-29", "Header RFI badge == tab count", P, "Same-snapshot check on the fixture: header 1 == tab “All RFIs (1)”."],
  ["BUG-30/31", "Eval honesty + holdout + unique run IDs", P, "Tab reads “Bid Extraction & ADR-0003 Normalization Check”; holdout card 3/3, MAPE 0.00%; no parity/zero-cheating strings; run ID with start timestamp. <span class='mono'>audit4-evals.png</span>"],
  ["BUG-33", "Dialog focus trap + restore", P, "Judge Dock: 14 Tabs trapped, ESC restored focus. Dock closed correctly."],
  ["BUG-34", "No horizontal overflow 375–1600", P, "0 px overflow at 320/375/768/1024/1440 and 720 px (200% zoom)."],
  ["BUG-35", "Small text AA contrast", P, "Carried forward from the sweep (0 real failures); unchanged code."],
  ["FIX-NEW-10", "Triple-click create = exactly one project", P, "Triple-click live: delta 1, one instance. <span class='mono'>audit4-double-submit.png</span>"],
  ["SPONSOR-STATUS", "Sponsor/diagnostic claims truthful", F, "NEW FINDING (this pass): cards overclaimed OpenAI “Integrated / Active” and Firecrawl TDLR/TSBPE registry verification. Fixed, deployed and verified live. <span class='mono'>audit4-sponsor-cards-fixed.png</span>"],
  ["DISPATCH-LOG", "Audit stream tells the truth about email delivery", F, "NEW FINDING (this pass): the log claimed “Dispatched invitations … via AgentMail” with zero emails delivered. Fixed; new event: “AgentMail Delivery: 0 of 0 eligible recipient(s)” listing reasons."],
];

const findings = [
  `
  <div class="finding">
    <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap"><span class="mono" style="font-weight:800">AUD-01</span><span class="pill s-warn">Medium</span><b>Sponsor diagnostics overclaimed integration status and registry verification</b></div>
    <p class="sub" style="margin:8px 0 4px"><b>Repro:</b> open Evals &amp; Architecture → scroll to the sponsor cards. OpenAI showed <span class="mono">Integrated / Active</span> with “Primary LLM Reasoning” despite having no API key; Firecrawl claimed “Texas TDLR &amp; TSBPE state contractor licensing registry verification” contradicting the provenance-first discovery behavior; the section header claimed the app “satisfies 100% of the hackathon judging rubric”.</p>
    <p class="sub" style="margin:4px 0"><b>Impact:</b> judges and users read those cards as factual integration/compliance claims; two of them were false.</p>
    <p class="sub" style="margin:4px 0"><b>Fix:</b> cards now read “Adapter Ready / Key Required” (derived from the live provider-availability query), “provenance-first” discovery, accurate AgentMail/free-tier language, and a neutral header. A source-level honesty test now guards these strings. Deployed and re-verified live.</p>
  </div>`,
  `
  <div class="finding">
    <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap"><span class="mono" style="font-weight:800">AUD-02</span><span class="pill s-warn">Medium</span><b>Audit log claimed RFQ email dispatch when no email was delivered</b></div>
    <p class="sub" style="margin:8px 0 4px"><b>Repro:</b> dispatch RFQs on a package whose discovered contacts are all “Contact not published”. The UI toast correctly said no email was delivered, but the audit stream logged “Dispatched invitations to bid to 3 commercial contractor(s) via AgentMail” and the package badge read “RFQs Dispatched”.</p>
    <p class="sub" style="margin:4px 0"><b>Impact:</b> the immutable audit trail — the product’s trust anchor — overstated an outbound action.</p>
    <p class="sub" style="margin:4px 0"><b>Fix:</b> the queueing event is now neutral (“RFQ Invitations Recorded…”), and the dispatch action writes a separate, truthful delivery event with real counts and per-recipient reasons. Verified live: <span class="mono">“AgentMail Delivery: 0 of 0 eligible recipient(s)”</span> + reasons for all three contacts.</p>
    <p class="sub" style="margin:4px 0"><b>Residual (product call):</b> the package status badge still reads “RFQs Dispatched” after zero delivery; recommend a “queued / delivery failed” indicator or renaming the status.</p>
  </div>`,
  `
  <div class="finding">
    <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap"><span class="mono" style="font-weight:800">AUD-03</span><span class="pill s-info">Info</span><b>Guarded action failures log a client console error</b></div>
    <p class="sub" style="margin:8px 0 4px"><b>Observation:</b> when a user triggers an action the backend intentionally rejects (zero-recipient dispatch), Convex logs a server error in the browser console while the UI shows the error toast. This is expected for a thrown action but will appear as a console error to anyone auditing. No fix applied; documented so the next auditor does not report it as a new defect.</p>
  </div>`,
];

const sponsors = [
  ["Convex", '<span class="pill s-pass">Live</span>', "Schema, queries, mutations, actions, crons, file storage, realtime; all exercised (backend reads, two-context realtime, upload/download).", "KPI/backed reads, realtime 1.0 s propagation"],
  ["Firecrawl", '<span class="pill s-pass">Live</span>', "Real web search returned company pages; records show “Unverified — from web search result”; no fabricated fallback directory; no TDLR claim.", "audit4-discovery.png, backend contractor rows"],
  ["Claude Sonnet 5", '<span class="pill s-pass">Live</span>', "Model diagnostics and the jev text helper both answered from Claude; RFI clarification rendered.", "Runs + 4 text calls (1.6–2.6 s)"],
  ["Gemini", '<span class="pill s-pass">Live</span>', "Pinned to gemini-3.6-flash (3.8 is quota-blocked); diagnostics show live.", "llmRouter:getProviderAvailability"],
  ["AgentMail", '<span class="pill s-pass">Live (free tier)</span>', "Inbox/send via the REST API with the deployment key; free-tier limit reuses an inbox and the package card discloses it; delivery results logged truthfully.", "provision + dispatch runs, delivery log"],
  ["OpenAI", '<span class="pill s-info">BYOK — key required</span>', "Adapter wired and labelled “Adapter Ready / Key Required”; no key on the deployment (hackathon provides no OpenAI credits); live pipeline routes to Gemini/Claude.", "availability query, diagnostics card"],
];

const recon = [
  ["Leveled buyout", "$3,918,500", "1,225,000 + 1,785,000 + 908,500 = 3,918,500", P],
  ["Gaps exposed", "+$186,000", "Alterman exclusions 147,000 + lead 24,000 + COI 15,000", P],
  ["Awarded packages", "1/3", "1 non-superseded agreement (A401-2026-2601-18042)", P],
  ["Contract sum", "$1,225,000", "agreement.contractSum = 1,225,000", P],
  ["Liquidated damages", "$1,200/day", "agreement.liquidatedDamagesDaily = 1200", P],
  ["Package count / budgets", "3 · $1.25M/$1.85M/$950K", "tradePackages rows match", P],
  ["Contractors / RFIs / bids / clashes", "4 / 3 / 2 / 4", "backend lists match the stepper counts", P],
  ["Eval holdout", "3/3 · MAPE 0.00%", "run eval_1789711637426 holdoutPassed=3, holdoutMape=0, prompts contain no totals", P],
  ["RFI realtime", "appeared in both contexts", "propagation 1.0 s across independent contexts", P],
];

const agentRows = [
  ["Switch project + read CSI scoping", "3", "~3 s", "Selected “AUDIT-4-2026-09-18” via the <span class='mono'>select</span> control, opened CSI Scoping, reported the package card. No data changed."],
  ["Create a trade package through the UI", "8", "19 s", "Clicked Create Trade Package → typed 23 00 00 / AUDIT-4 Jev HVAC / 850000 / scope summary → clicked Create Package. Backend verified CSI 23 00 00, budget 850,000, status draft. [trace]"],
  ["Read KPI band (smoke) + create AUDIT-JEV project (earlier run)", "3", "8.9 s", "Read Buyout and Gaps Exposed correctly; created and submitted a project in 5.5 s (fixture deleted)."],
];

const coverage = [
  ["Navigation & inventory", '<span class="pill s-pass">Full</span>', "All 8 tabs, project selector, New Project, Judge Dock, tour, package/evals/diagnostics views exercised this pass.", P],
  ["GC journey (create → package → discovery → upload → download → Q&A → cleanup)", '<span class="pill s-pass">Full</span>', "Fixture end-to-end; discovery, upload/download, RFI submission; award/leveling previously verified and re-checked read-only on the demo.", P],
  ["Sub bidder journey", '<span class="pill s-warn">Partial</span>', "RFI submission and AI clarification verified in two contexts; bid revision flow not re-run this pass (covered in previous audits).", NA],
  ["Isolation", '<span class="pill s-pass">Pass</span>', "Two independent contexts and a disposable fixture; stale/foreign IDs previously verified.", P],
  ["Adversarial", '<span class="pill s-pass">Full</span>', "Triple-click create, double-click dispatch, whitespace title, refresh race, Back, two tabs; agent-driven UI mutation.", P],
  ["Discovery provenance", '<span class="pill s-pass">Full</span>', "Live run inspected record-by-record; no fabricated licence/phone/email patterns.", P],
  ["Bid leveling math &amp; CSV", '<span class="pill s-na">Read-only this pass</span>', "Backend bids reconciled to the KPI; arithmetic hand-verified in previous audits and covered by the derived-number test suite.", NA],
  ["Contracts &amp; execution", '<span class="pill s-na">Read-only this pass</span>', "Register sum, LD and status reconciled against the backend; execution lock previously verified.", NA],
  ["Files &amp; download truth", '<span class="pill s-pass">Full</span>', "Upload, listing, stored-byte download, truthful caption all verified on the fixture.", P],
  ["Evals &amp; claims integrity", '<span class="pill s-pass">Full</span>', "Holdout card, run ID/date, provider labels, sponsor claims, audit delivery log.", P],
  ["Accessibility / responsive", '<span class="pill s-pass">Full</span>', "Keyboard focus trap/restore, overflow matrix, 200% zoom, timestamps.", P],
  ["Performance / network", '<span class="pill s-pass">Pass</span>', "Zero console errors and zero failed requests in clean runs; two contexts held realtime subscriptions without churn.", P],
  ["Backend/data integrity", '<span class="pill s-pass">Full</span>', "9-value reconciliation against Convex reads; fixture cascade delete left only the demo.", P],
];

const templates = ["template-1.html", "template-2.html"].map((f) => fs.readFileSync(path.join(T, f), "utf8")).join("\n");
const withRows = templates
  .replace("{{REGRESSION_ROWS}}", rows(regression))
  .replace("{{FINDING_CARDS}}", findings.join("\n"))
  .replace("{{SPONSOR_ROWS}}", rows(sponsors))
  .replace("{{RECON_ROWS}}", rows(recon))
  .replace("{{AGENT_ROWS}}", rows(agentRows))
  .replace("{{COVERAGE_ROWS}}", rows(coverage));

const withImages = withRows.replace(/\{\{IMG:([^|]+)\|([^}]+)\}\}/g, (m, name, caption) => {
  const p = path.join(EV, name);
  if (!fs.existsSync(p)) return `<figure><figcaption>Missing evidence: ${name}</figcaption></figure>`;
  const src = `data:image/png;base64,${fs.readFileSync(p).toString("base64")}`;
  return `<figure><img src="${src}" alt="${caption.replace(/"/g, "&quot;")}" loading="lazy"/><figcaption><span class="fname">${name}</span>${caption}</figcaption></figure>`;
});

fs.writeFileSync(OUT, withImages, "utf8");
console.log("Report:", OUT);
console.log("Size:", (fs.statSync(OUT).size / 1024 / 1024).toFixed(2), "MB");
console.log("Images:", (withImages.match(/data:image\/png;base64/g) || []).length);
console.log("Unresolved tokens:", (withImages.match(/\{\{/g) || []).length);