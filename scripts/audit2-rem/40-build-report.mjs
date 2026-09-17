import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const REPO = "D:/Repo/ALL HACKATHONS/Convex/Convex all gas";
const EV = path.join(REPO, "evidence");
const T = path.join(REPO, "scripts/audit2-rem/report");
const OUT = path.join(REPO, "doc/tradepulse audit 2/TradePulse-Pro-Remediation-2026-09-17-1400-UTC.html");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const rows = (arr) => arr.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("\n");

const badge = {
  fixed: '<span class="pill s-pass">Fixed</span>',
  fixedB: '<span class="pill s-pass">Fixed (Bucket B)</span>',
  fixedClass: '<span class="pill s-pass">Fixed (class)</span>',
  unrepro: '<span class="pill s-na">Unreproduced</span>',
  unreproFixed: '<span class="pill s-na">Unreproduced (already fixed)</span>',
  partial: '<span class="pill s-warn">Partial → fixed</span>',
  skipped: '<span class="pill s-na">Skipped (retracted)</span>',
  decision: '<span class="pill s-warn">Decision + partial fix</span>',
  state: '<span class="pill s-pass">Fixed (state-dependent)</span>',
};

const verification = [
  ["BUG-01", "Med", "Yes", "New Project modal rendered inside the sticky header; the header's <code>backdrop-filter</code> made <code>fixed inset-0</code> resolve to the 187px header box, pushing 3 fields above the viewport.", badge.fixed, "Header.tsx (portal + focus hook + min/max/step)", "Before: dialog top −168px, in header, 3 fields invisible. After (live): top 189px, not in header, all 7 fields visible."],
  ["BUG-02", "Low", "Yes", "Demo tour copy hard-coded demo counts (<code>3 CSI Trade Packages</code>, <code>4 Verified Specialty Contractors</code>).", badge.fixed, "InvestorDemoTourBar.tsx, App.tsx", "On a 0-package fixture the tour now reads “No packages scoped yet”; no TDLR claims remain in tour copy."],
  ["BUG-03", "—", "Retracted", "Audit retracted this candidate (viewport drift).", badge.skipped, "—", "Not re-tested; no code change."],
  ["BUG-04", "Med", "No", "Submit is already disabled when the spec textarea is empty (<code>disabled={isGeneratingPackages || !specInputText.trim()}</code>); the header button also auto-loads a sample spec, so the empty path is unreachable from that control.", badge.unreproFixed, "None", "Whitespace-only textarea keeps the submit disabled; clicking it leaves the modal open with no package created."],
  ["BUG-05", "—", "Retracted", "Audit retracted this candidate (viewport artifact).", badge.skipped, "—", "Not re-tested; no code change."],
  ["BUG-06", "Med", "Yes", "<code>totalLeveledBuyout</code> mixed package budgets and best-leveled bids under a “(Normalized)” label.", badge.fixed, "ExecutiveKpiBar.tsx, leveling.ts, App.tsx", "Label is now “(best bid per package)” with a tooltip; demo total 3,918,500 = 1,225,000 + 1,785,000 + 908,500, computed once and shared."],
  ["BUG-07", "Med", "Yes", "<code>dispatchRfqs</code> marked the package <code>rfqs_dispatched</code> and wrote a “dispatched to 0 contractors” success path.", badge.fixed, "convex/rfq.ts, App.tsx", "Live: dispatch on a zero-contractor package shows a red “No contractors have been discovered…” error; backend verified the package stays draft with no dispatched event."],
  ["BUG-08", "Med", "Yes (15–18s)", "Form cleared after the mutation while the LLM action ran; no in-flight indicator.", badge.fixed, "PreBidQnAView.tsx, App.tsx", "An “RFI submitted — the AI is analyzing…” banner appears immediately and clears when the clarification lands (measured 15s). No duplicate submits were produced."],
  ["BUG-09", "Low", "Yes", "AI clarification rendered as raw text, so <code>**</code> and <code>###</code> showed literally.", badge.fixed, "PreBidQnAView.tsx, lib/markdown.tsx", "After: no raw markdown characters in the DOM; bold/headings render as elements (20 <code>&lt;strong&gt;</code> nodes), without <code>dangerouslySetInnerHTML</code>."],
  ["BUG-10 / BUG-28", "Low", "Yes", "Timestamps used <code>toLocaleTimeString</code> with hour/minute only — no date, no timezone.", badge.fixed, "ActivityAuditStreamView.tsx, PreBidQnAView.tsx, lib/datetime.ts", "After: <code>Sep 17, 2026, 08:10:57 PM GMT+7</code> for both audit events and RFI cards."],
  ["BUG-11", "Med", "Yes", "Addendum filename kept a template artifact and was described as an “AIA A401 standard” addendum (A401 is a subcontract form).", badge.fixed, "convex/files.ts, PreBidQnAView.tsx", "After: <code>ADDENDUM_NO_01_CLARIFICATIONS.md</code>, copy says “CSI MasterFormat pre-bid addendum (AIA Document A401 is the separate subcontract form)”; issuing with zero certified RFIs is blocked in the UI."],
  ["BUG-12", "High", "Partial", "Preview served stored bytes; Download fell back to a filename-keyed canned-document dictionary for records without a stored URL (reachable in legacy/standalone records).", badge.partial, "ProjectFilesView.tsx, lib/storedFile.ts", "Download now fetches and saves the stored object under the record filename. Proof: uploaded <code>after-upload-normal.txt</code> downloaded byte-identical to the upload."],
  ["BUG-13", "Med", "No (deterministic)", "Observed “silent drop” traced to the type/extension race: the default “MEP Blueprint” type rejects <code>.txt</code>, while the picker advertised it. The rejection message was already shown.", badge.fixedClass, "ProjectFilesView.tsx", "<code>accept</code> now matches the selected type (spec: <code>.pdf,.txt</code>; blueprint: <code>.pdf,.dwg,.dxf</code>); a spec-type <code>.txt</code> upload succeeded and appeared immediately."],
  ["BUG-14", "Med", "Yes", "Blanket caption “100% Real Construction Document Specification” on every file.", badge.fixed, "ProjectFilesView.tsx", "After: “Stored in Convex _storage • CSI specification • uploaded Sep 17, 2026” (seeded docs: “Seeded project document … served from the app document archive”)."],
  ["BUG-15", "Med", "Yes (shared cause with BUG-01)", "Stacked confirms both used <code>z-[70]</code>, and the project-delete confirm inside the header resolved <code>fixed</code> against the 187px header, clipping it at the viewport top.", badge.fixed, "ConfirmDialog.tsx (portal + stacking z-index)", "After: the project confirm renders centred (top 359px, not in header); each newly opened confirmation takes a higher z-index and only the topmost responds to Escape."],
  ["BUG-16", "High", "Yes — and worse", "Discovery synthesised licence numbers/phones/emails deterministically; the live run invented government-domain addresses (<code>estimating@tdlr.texas.gov</code>).", badge.fixedB, "convex/contractorDiscovery.ts, SubcontractorDiscoveryView.tsx", "After: records show only published data; sample directory entries are labelled “Unverified — sample directory record” with licence/phone/email stripped; provenance notice shown; no sequential licence pattern, no TDLR badges."],
  ["BUG-17", "Low", "Yes", "“Simulate Inbound Quote” opened the Judge Dock instead of ingesting a quote.", badge.fixed, "BidLevelingMatrixView.tsx", "Relabelled “Simulate Inbound Bid…” with a tooltip naming the dock; verified the label changed and the dock opens by design."],
  ["BUG-18", "Med", "Yes", "“Gaps Plugged: +$169,500” was exclusions-only on the lowest bid, while the visible Alterman card totalled $186,000 and the backend narrative said $186,000.", badge.fixed, "leveling.ts, ExecutiveKpiBar.tsx", "Now computed as the flagged deceptive bid's exclusions + lead + COI − accepted VE; live KPI shows +$186,000, matching the card components exactly."],
  ["BUG-19", "Low", "Yes", "CSV header “Total VE Deduct ($)” counted accepted alternates only.", badge.fixed, "BidLevelingMatrixView.tsx", "Header renamed “Accepted VE Deduct ($)” so the column matches its arithmetic."],
  ["BUG-20", "Low", "Yes", "Card labelled the lower trade price “Duplicate Value” while body copy described paying twice.", badge.fixed, "CrossTradeCoordinationView.tsx", "Labelled “Deductible Redundant Value” with a tooltip defining what is recoverable."],
  ["BUG-21", "Low", "Yes", "“Recoverable Buyout Credits” subtitle said “1-click VE credits”.", badge.fixed, "CrossTradeCoordinationView.tsx", "Subtitle now “Double-buy credits deducted from trade bids”."],
  ["BUG-22", "Low", "Yes", "Footer “$38,500 in Deductions Active” omitted resolved scope voids.", badge.fixed, "CrossTradeCoordinationView.tsx", "Footer now reports double-buy credits and assigned voids separately."],
  ["BUG-23", "High", "State-dependent", "Contract sum, leveling matrix and tour copy used different sources; the stale surface was the hard-coded tour. Agreement sync for bid adjustments already existed.", badge.state, "InvestorDemoTourBar.tsx, App.tsx (+ existing agreements sync)", "Lifecycle test on a fixture: contract sum $1,190,000 == leveling TRUE LEVELED COST $1,190,000 == tour narration; no divergence after award."],
  ["BUG-24", "Med", "Yes", "AIA A401 states $1,200/day LDs while leveling copy and the generated spec said $6,000/week (a different term: lead-time adjustment).", badge.fixed, "convex/terms.ts + agreements/simulation/llmRouter/realDocuments/files + UI copy", "Contract register shows <code>LDs: $1,200/day</code>; leveling copy names “lead-time delay penalties ($6,000/wk schedule-impact rate, distinct from the contract's $1,200/day liquidated damages)”."],
  ["BUG-25", "Low", "Yes", "Subcontract sum absorbed the assigned void while leveling/tour copy lagged.", badge.fixed, "Same as BUG-23/36", "Reconciled in the lifecycle test; the leveling matrix and register agree on the awarded cost."],
  ["BUG-26", "Med", "Yes", "KPI counted <code>tradePackage.status === \"awarded\"</code> (0) while the stepper counted agreements (1).", badge.fixed, "leveling.ts, ExecutiveKpiBar.tsx, Header.tsx", "Award count derives from non-superseded agreements ∪ awarded bids ∪ awarded packages. Live demo: KPI 1/3 == stepper 1/3; lifecycle: 1/2 == 1/2."],
  ["BUG-27", "Low", "Yes", "Tour said “$1,225,000 Subcontract Sealed” independent of the register.", badge.fixed, "InvestorDemoTourBar.tsx", "Scene 06 metric interpolates the active agreement sum and execution state."],
  ["BUG-29", "Low", "No", "Header badge and the tab queue both read the same per-package conversation list in the current build.", badge.unrepro, "None", "Same-snapshot check: header 1 == tab 1 (fixture); header 3 == tab 3 (demo)."],
  ["BUG-30", "High", "Yes", "Eval prompt contains the case's own figures; headline framed extraction as “100% parity / Zero Cheating”.", badge.fixedB, "SponsorDiagnosticsView.tsx, honesty.test.ts", "Retitled “Bid Extraction & ADR-0003 Normalization Check”; states “not an independent estimating benchmark”; “Zero Cheating”/“PARITY ACHIEVED” removed and guarded by a source test."],
  ["BUG-31", "Low", "Partial", "Direct action call creates a unique run ID (verified: 47.6s, new ID each time); the UI showed the previous run while the new one executed with no freshness cue.", badge.partial, "SponsorDiagnosticsView.tsx", "Run ID now shows its start timestamp and a “New run in progress…” note while evaluating."],
  ["BUG-32", "—", "Retracted", "Audit retracted this candidate (<code>select</code> innerText serialisation).", badge.skipped, "—", "Isolation re-verified clean: a stale id is rejected and the URL rewritten to the demo id."],
  ["BUG-33", "Med", "Yes", "Judge Dock declares <code>aria-modal</code> but had no trap and ESC did not restore focus.", badge.fixed, "lib/useDialogFocus.ts, JudgeSimulationDock.tsx (+ New Project, preview, package/spec modals, ConfirmDialog)", "Live: 14 Tab presses never left the dialog; ESC closed it and focus returned to the “60s Judge Dock” trigger."],
  ["BUG-34", "Med", "Yes", "Nav stepper had <code>shrink-0</code> with an unconstrained scroller, stretching the page to 1,167–1,210px.", badge.fixed, "Header.tsx", "Overflow is 0px at 375 / 640 / 768 / 1024 / 1280 / 1440 / 1600 (was 527px at 640, 399px at 768, 186px at 1024)."],
  ["BUG-35", "Low", "Yes", "11px slate-500 secondary text at 3.75:1 and 10px detail text at 3.47:1.", badge.fixedClass, "12 component files (slate-500 → slate-400) + solid emerald chips 600 → 700", "Contrast sweep after: 0 real AA failures at ≤12.5px (gradient-background buttons excluded as known false positives)."],
  ["BUG-36", "Med", "Yes", "Tour scene 04 narrated hard-coded “$61,000 cheaper / $61k–$96k” after the live matrix moved.", badge.fixed, "InvestorDemoTourBar.tsx, App.tsx", "Narration is interpolated from live bids. Empty project: “No proposals have been leveled yet…”. Demo: paper price, gaps, leveled cost and variance match the matrix."],
  ["OBS-01", "Info", "Yes", "Dark-only theme; no <code>color-scheme</code> declared.", badge.decision, "index.html", "Dark-only retained as an intentional design decision; <code>&lt;meta name=\"color-scheme\" content=\"dark\"&gt;</code> added so native controls render dark. A light/high-contrast theme needs a product decision (Bucket B5)."],
  ["OBS-02", "Info", "Yes", "Reset copy named the wrong project (“Austin Commercial Tower”).", badge.fixed, "JudgeSimulationDock.tsx", "Copy now says it resets the shared seeded demo project; the action is confirmed and cannot touch custom projects."],
  ["OBS-03", "Info", "Yes", "Numeric inputs lacked min/max/step.", badge.fixed, "Header.tsx", "Budget <code>min=1 max=1e9 step=1</code>, weeks <code>min=1 max=520</code>, deadline min set. (A <code>step=1000</code> variant was caught by the local harness as making the form invalid and corrected before deploy.)"],
];

const newFindings = [
  ["FIX-NEW-01", "Med", "An addendum could be issued with zero PM-certified RFIs: the UI filed a “binding” ADDENDUM NO. 01 containing no clarifications.", "UI now blocks issuance and explains why (“must clarify at least one PM-certified RFI”). The backend action remains permissive to preserve the documented F3 regression test — product call on tightening the backend (Bucket B6).", "after3-BUG11 path + error copy verified live; zero-RFI case now returns the guard message."],
  ["FIX-NEW-02", "Med", "The demo dock's “Reset Project Seed State” was a destructive action without confirmation, and its copy implied it reset the current project — it always resets the shared demo.", "Confirmation dialog added; copy states exactly what is reset and that custom projects are untouched.", "Judge Dock source + live check that the confirm appears before the action."],
  ["FIX-NEW-03", "Low", "Create Trade Package, AI Spec Breakdown and the document preview modals had no <code>role=\"dialog\"</code>/<code>aria-modal</code>, and no focus management.", "Role/aria attributes plus the shared focus hook added to the primary modals (Judge Dock, New Project, preview, package, spec).", "Local checks: tab trail stays inside each dialog; ESC restores focus."],
  ["FIX-NEW-04", "Low", "Selected trade chips rendered 11–12px white on emerald-600 (measured 3.6–3.8:1) — an AA failure the original audit did not catch.", "Solid emerald chips/buttons darkened to emerald-700 (≈4.9:1); measured 0 failures after.", "21-probe-contrast.mjs output; live sweep in the final verification JSON."],
  ["FIX-NEW-05", "Info", "Package creation wrote audit events with <code>eventType: \"rfq_dispatched\"</code>, polluting the stream taxonomy.", "New <code>package_created</code> event type with its own icon and badge; regression test asserts zero-recipient dispatch writes no <code>rfq_dispatched</code> event.", "convex/tradePackages.ts:78,160; ActivityAuditStreamView.tsx; regression test."],
  ["FIX-NEW-06", "Low", "Redundancy: the leveling empty state repeated two toolbar actions (four buttons, two actions).", "Empty state collapsed to one primary action with explanatory text pointing at the toolbar and file-based ingest paths.", "BidLevelingMatrixView.tsx (verified in build)."],
  ["FIX-NEW-07", "Low", "“Proceed to Contracts Register” silently skipped the Scope Clash stage.", "Relabelled “Skip ahead: Contracts Register →” with an explicit tooltip; the primary path is unchanged.", "BidLevelingMatrixView.tsx."],
  ["FIX-NEW-08", "Info", "The full-cycle message called an exclusions-only figure “hidden scope gaps” while the KPI's Hidden Gaps Exposed includes lead/COI penalties.", "Message now says “hidden scope exclusions (lead-time and COI penalties are normalized separately)”.", "App.tsx, JudgeSimulationDock.tsx."],
  ["FIX-NEW-09", "Info", "README and <code>/llms.txt</code> claimed TDLR licensing verification the product does not perform.", "Both updated to provenance-first wording that matches the implemented behavior.", "README.md §3; convex/http.ts llms.txt manifest."],
];

const bucketB = [
  ["B1 — BUG-16 fabricated discovery", "A (chosen): record only published data, label the built-in directory as an unverified sample, strip invented licences/phones/emails, show provenance in the UI.<br/>B: require a real state-registry integration (needs data agreements/ToS; out of hackathon scope).<br/>C: keep generated records but badge them “demo data”.", "A — removes the commercially dangerous claim without breaking the demo flow; B is the eventual production path; C still trains users to trust invented compliance data.", "Confirm A for the demo, or say the word and the sample directory will be removed entirely (discovery then surfaces an explicit “configure FIRECRAWL_API_KEY” error when no live results exist)."],
  ["B2 — BUG-12/14 document truth", "A (chosen): Download fetches and saves stored bytes; preview caption is a storage descriptor.<br/>B: generate a PDF for seeded documents on download (same fabrication class).<br/>C: disable Download where no stored bytes exist.", "A — matches the audit's #2 recommendation and is testable (“download-serves-stored-bytes”).", "None required; overrule only if Download should be hidden for records with no stored object."],
  ["B3 — BUG-30/31 eval honesty", "A (chosen): rename to an extraction/normalization check, state the limitation, show run timestamps.<br/>B: additionally build a holdout eval whose prompt omits the answer (tests leveling arithmetic end-to-end).<br/>C: remove the eval tab.", "A now, B as the next iteration — B is the only option that produces genuinely independent validation evidence.", "Decision: fund B? It is a scoped follow-up (new case type + assertion that the prompt contains no ground-truth figures)."],
  ["B4 — BUG-02/36 tour", "A (chosen): interpolate narration from live data.<br/>B: label the tour a canned recording.<br/>C: remove the tour.", "A — keeps the demo value and eliminates narrator/screen contradictions permanently.", "None required."],
  ["B5 — OBS-01 dark-only theme", "A (chosen): keep dark-only and declare <code>color-scheme: dark</code>.<br/>B: add a light theme (large Tailwind-wide change).<br/>C: add a high-contrast toggle.", "A for the hackathon; C is the cheapest accessibility upgrade if you want one.", "Choose whether a light/high-contrast mode is in scope for the next milestone."],
  ["B6 — FIX-NEW-01 zero-RFI addendum", "A: UI guard only (implemented; backend permissive to keep the documented F3 test).<br/>B: also reject in the backend action and update the F3 test.<br/>C: keep empty addenda and rename them “notice of no clarifications”.", "A now; B if an empty “binding” instrument is a legal risk.", "Decision on B."],
];

const reconciliation = [
  ["Total budget", "$4,250,000 (KPI band)", "$4,250,000 (all 8 tabs)", "—", '<span class="pill s-pass">Agree</span>'],
  ["Package budget sum (context only)", "$4,050,000", "$4,050,000", "—", '<span class="pill s-pass">Agree</span>'],
  ["Leveled Buyout (best bid per package)", "$3,918,500 (KPI)", "$3,918,500 (header/tour metric)", "$3,918,500 = 1,225,000 + 1,785,000 + 908,500", '<span class="pill s-pass">Agree</span>'],
  ["Variance vs budget", "+$331,500 (7.8%)", "+$331,500 (tour)", "—", '<span class="pill s-pass">Agree</span>'],
  ["Deceptive bids flagged", "1", "1 (tour)", "Alterman (base &lt; lowest, leveled &gt; lowest)", '<span class="pill s-pass">Agree</span>'],
  ["Hidden gaps exposed", "+$186,000 (KPI band)", "Alterman card: 147,000 + 24,000 + 15,000 = $186,000", "Audit narrative $186,000", '<span class="pill s-pass">Agree</span>'],
  ["Awarded packages", "1/3 (KPI)", "1/3 (header stepper)", "1 non-superseded agreement", '<span class="pill s-pass">Agree</span>'],
  ["Awarded / contracted sum", "$1,225,000 (contracts register)", "$1,225,000 (leveling TRUE LEVELED COST)", "$1,225,000 (tour scene 06)", '<span class="pill s-pass">Agree</span>'],
  ["Liquidated damages", "$1,200/calendar day (agreement + register)", "Named separately from the lead-time rate", "AIA A401 contract text", '<span class="pill s-pass">Agree</span>'],
  ["Lead-time adjustment rate", "$6,000/week (leveling rationale)", "$6,000/week (generated spec + addendum)", "ADR-0003 engine term", '<span class="pill s-pass">Agree</span>'],
  ["RFI count (active package)", "Header badge 1", "Tab “All RFIs (1)”", "—", '<span class="pill s-pass">Agree</span>'],
  ["Discovery directory count", "Banner “Subcontractors Identified (3 contractor records)”", "“Trade Directory (3 of 3)”", "List rows 3", '<span class="pill s-pass">Agree</span>'],
  ["Timestamps", "Full local date + timezone (audit + RFI)", "—", "—", '<span class="pill s-pass">Agree</span>'],
];

const redundancy = [
  ["Leveling empty-state actions", "Four buttons for two actions (Ingest ×2, Simulate ×2)", "One primary (<span class='mono'>Ingest Direct Quote / PDF</span>) + text pointing at the toolbar and file-based ingest"],
  ["“Simulate Inbound Quote” vs “Simulate Proposal Inflow”", "Two labels, one destination (Judge Dock)", "Single toolbar control “Simulate Inbound Bid…” with a tooltip naming the dock; empty state no longer duplicates it"],
  ["“Proceed to Contracts Register”", "Looked like a primary path but silently skipped the Scope Clash stage", "Relabelled “Skip ahead: Contracts Register →” with an explicit tooltip; the advance-to-clash CTA remains the primary"],
  ["Confirmation stacking", "Two dialogs could share z-index 70 with DOM-order rendering", "Newest confirmation takes the highest z-index; only the topmost handles Escape/Tab"],
];

const perf = [
  ["First contentful paint", "1.19 s (audit network)", "2.8–3.6 s measured on this network (TTFB 0.97–1.70 s dominated)", '<span class="pill s-warn">Network variance; no app regression</span>'],
  ["JS transfer (gzip)", "196.5 KB served", "190.2 KB gzip (711 KB raw)", '<span class="pill s-pass">−3%</span>'],
  ["CSS", "46.1 KB", "46.7 KB raw (8.3 KB gzip)", '<span class="pill s-pass">≈</span>'],
  ["Resources per load", "3", "5 (a duplicate favicon request was observed once; Info note)", '<span class="pill s-na">Minor</span>'],
  ["Console errors on load", "0", "0 (live after deploy)", '<span class="pill s-pass">Clean</span>'],
  ["DOM nodes", "703", "~850 after data load", '<span class="pill s-na">+21%</span>'],
  ["Horizontal overflow", "527px @640 / 399px @768 / 186px @1024", "0px at 375–1600", '<span class="pill s-pass">Fixed</span>'],
];

const testOutput = execSync("npm test", { cwd: REPO, encoding: "utf8" });

const templates = ["template-1.html", "template-2.html", "template-3.html"].map((f) => fs.readFileSync(path.join(T, f), "utf8")).join("\n");

const withRows = templates
  .replace("{{VERIFICATION_ROWS}}", rows(verification))
  .replace("{{NEW_FINDINGS_ROWS}}", rows(newFindings))
  .replace("{{BUCKET_B_ROWS}}", rows(bucketB))
  .replace("{{RECON_ROWS}}", rows(reconciliation))
  .replace("{{REDUNDANCY_ROWS}}", rows(redundancy))
  .replace("{{PERF_ROWS}}", rows(perf))
  .replace("{{TEST_OUTPUT}}", esc(testOutput));

const withImages = withRows.replace(/\{\{IMG:([^|]+)\|([^}]+)\}\}/g, (m, name, caption) => {
  const p = path.join(EV, name);
  if (!fs.existsSync(p)) return `<figure><figcaption>Missing evidence: ${esc(name)}</figcaption></figure>`;
  const src = `data:image/png;base64,${fs.readFileSync(p).toString("base64")}`;
  return `<figure><img src="${src}" alt="${esc(caption).replace(/"/g, "&quot;")}" loading="lazy"/><figcaption><span class="fname">${esc(name)}</span>${caption}</figcaption></figure>`;
});

fs.writeFileSync(OUT, withImages, "utf8");
const size = fs.statSync(OUT).size;
console.log("Report written:", OUT);
console.log("Size:", (size / 1024 / 1024).toFixed(2), "MB");
console.log("Images embedded:", (withImages.match(/data:image\/png;base64/g) || []).length);
console.log("Unresolved tokens:", (withImages.match(/\{\{/g) || []).length);