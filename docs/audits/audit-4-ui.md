# TradePulse Pro — Human-Operator UI Audit

**Question asked:** Does this app have an intuitive and meaningful UI, if operated by a human as described (GC estimator, subcontractor bidder, second GC admin, adversarial tester, a11y/craft reviewer)?

**Answer:** **Partly.** It is *easy to operate* and *easy to understand on the happy path*. It is **not yet reliable enough for a human to trust the numbers**, and a few controls do something other than what their label says. This document is written so a coding agent can act on it directly: every finding has severity, repro steps, root cause with `file:line`, and a definition of done.

- **Audited:** live deployment `brainy-skunk-440.convex.site` + repo `github.com/bO-05/tradepulse-pro` @ `4c9366a` (2026-09-18).
- **Method:** real mouse/keyboard via Chrome DevTools Protocol (not DOM-only), two independent browser tabs, Console + Network + HAR-class instrumentation throughout, project create → scope → discover → invite → Q&A → submit/revise → level → isolate. Responsive (375px, 200%), keyboard-only, dark theme, empty/loading/error states.
- **Reproduced:** every reported bug at least twice, or explicitly marked flaky.
- **Scope:** UI/UX + meaning + craft. Server/security items are marked out of scope where relevant.

---

## 0. TL;DR for the coding agent

Fix these six things and the product becomes trustworthy to a human operator. Ordered by user harm per unit of effort.

| # | Finding | Severity | Effort | File |
|---|---|---|---|---|
| **F1** | RFI submissions are silently lost (no error, no retry, no draft) | **High** | M | `convex/simulation.ts:319`, `convex/emailActions.ts` `handleRfiProcessing` |
| **F2** | "Leveled Buyout" mixes real bids with budget estimates but is labelled "best bid per package" | **High** | S | `src/leveling.ts:117-120`, `src/components/ExecutiveKpiBar.tsx:55` |
| **F3** | New Project form pre-fills 5 fields; typing appends → silent $550B budgets | **Medium** | S | `src/components/Header.tsx:76-81` |
| **F4** | "Simulate Inbound Bid…" opens a demo dock, ingests nothing | **Medium** | S | `src/components/BidLevelingMatrixView.tsx:779-786` |
| **F5** | Up to 4 competing "next" CTAs per screen; two disagree | **Medium** | M | multiple (see F5) |
| **F6** | RFI form has no trade/division selector; defaults to wrong package | **Medium** | S | `src/components/PreBidQnAView.tsx:739-800` |

Positives worth protecting (do not regress): dishonest-claim fixes in Discovery and Evals, the Bid Leveling card pair, the ConfirmDialog focus/stacking work, and the dynamic tour copy.

---

## 1. What is genuinely intuitive (protect this)

**1.1 The pipeline reads as a left-to-right story.** Six numbered stages, each with a live count (3 Pkgs → 4 Subs → 3 RFIs → 2 Bids → 4 Clashes → 1/3 Awarded). A first-timer can predict what happens next and where they are. This is the single strongest UX decision in the app.

**1.2 Bid Leveling is the hero screen.** The two-column card pair (Rank #1 Rosendin, paper $1,225,000 / TRUE LEVELED COST $1,225,000 vs Rank #2 Alterman, paper $1,100,000 / true $1,286,000) with each exclusion priced on its own line makes the product's whole thesis legible in about five seconds. A GC instantly sees *why the cheapest paper bid is not the cheapest real bid.*

**1.3 Destructive and legal actions are described honestly.** Recording contract execution states "TradePulse does not provide a signature service." Upload errors name the file and the allowed extensions. Addendum issuance is gated and explains *which* RFIs are uncertified. "Reset" explains exactly what it clears.

**1.4 Realtime works.** An RFI submitted from an independent browser tab appeared in the other tab with no refresh. Deduct credits and scope assignments propagate. Deep-linking (`?project=…&tab=…`) and the Back/Forward buttons work correctly because tab state is URL-synced (`src/App.tsx:232-255`).

**1.5 Mobile, zoom, and keyboard are real.** At 375px everything stacks with **zero horizontal overflow**; at 200% zoom the stepper collapses to a "Stage" dropdown; keyboard Tab visits every control **with a visible focus ring**; the project `<select>` responds to arrow keys.

**1.6 The `ConfirmDialog` rework is excellent.** Monotonic z-index so stacked dialogs cannot both react; Escape closes; focus is trapped and restored (`src/components/ConfirmDialog.tsx:17-70`). Verified live: Escape closed the Delete-project confirm and the project survived.

---

## 2. Findings that make a human mistrust or mis-operate the app

### F1 — RFI submissions are silently lost — **High**

**Expected:** I type a detailed RFI, hit submit, and it eventually appears (or I get an error).
**Saw:** The submit button disables and shows a spinner, then either appears after ~13–50 s **or vanishes forever** with no error. The form is already cleared, so the text is gone too.
**Why it is high:** This is a subcontractor's formal question to a GC about scope and money. Losing it silently risks a bid built on the wrong assumption, and the bidder has no signal to retry.

**Reproduced twice, and it is flaky — that is the worst kind:**
- Attempt 1 (`REFRESH-MIDFLOW TEST`): submitted, refreshed during analysis → RFI never created; count stayed 1.
- Attempt 2 (`<img src=x…> XSS TEST`): submitted → RFI never created; count stayed 1.
- Attempt 3 (`REPRO2 refresh loss`): submitted, refreshed → **appeared**; count 2 → 3.
- Control (`CONTROL RFI no refresh`): submitted, left open → appeared in ~13 s; count 1 → 2.

So the loss is not caused by the refresh per se; it correlates with the analysis step failing.

**Root cause (`file:line`):**
- `convex/simulation.ts:319` — `submitCustomRfi` returns `{success:true}` immediately and only *schedules* the work: `await ctx.scheduler.runAfter(0, internal.emailActions.processSimulatedInbound, {...})`.
- `convex/emailActions.ts` `handleRfiProcessing` — awaits `internal.llmRouter.executeReasoning` **with no try/catch**. If the LLM call throws (rate limit, timeout, transient network), the action aborts before `internal.rfq.recordInboundRfi` is ever called. Nothing is written and nothing is reported.
- Client (`src/components/PreBidQnAView.tsx:150-182`) clears subject+question on submit and shows a spinner; `pendingRfiSince` is only cleared when a new conversation appears, so on failure it spins indefinitely.

**Definition of done:**
1. Wrap the LLM call and the record write in `handleRfiProcessing` so a failure is caught and the RFI is still persisted with status `pending_analysis` (or `failed_analysis`) plus the original text.
2. On failure, surface a visible error to the client with a **Retry** action; never leave the spinner running forever.
3. Persist the submitted RFI text *before* the LLM step so a refresh cannot lose it.
4. Test: force `executeReasoning` to throw, submit, assert an RFI row exists and the user sees an error with retry.

---

### F2 — "Leveled Buyout" mixes bids with budget estimates — **High (meaning)**

**Expected:** A figure labelled "Leveled Buyout — best bid per package" reflects actual bids.
**Saw:** On a project with 3 packages and **zero bids**, the KPI reads `Leveled Buyout: $2,920,000 (best bid per package)` and `Variance: +$11,280,000 (79.4%)` "savings". Those are just the package budgets summed (850k + 1,450k + 620k = 2,920k). A GC sees a 79% "saving" before a single quote exists.

**Root cause:**
- `src/leveling.ts:117-120` — for any package with no bids: `totalLeveledBuyout += pkg.budgetEstimate || 0; packagesUsingBudget += 1;`.
- `src/components/ExecutiveKpiBar.tsx:55` — the compact strip renders the literal footnote `(best bid per package)` regardless of `packagesUsingBudget`.

**Nuance (be fair when fixing):** the *expanded* 6-card view is more honest — it shows "0 proposals", "Hidden gaps exposed $0". The defect is the always-visible compact strip's label/meaning, which is what most users read.

**Definition of done:**
1. When `packagesUsingBudget > 0`, the compact strip must not claim "best bid per package". Show e.g. `Leveled Buyout: $2,920,000 — 3 of 3 packages using budget estimates (no bids yet)`.
2. Do not show a "Variance/Savings %" derived purely from budgets; label it "Budget vs scope estimate" or hide it until ≥1 bid exists.
3. Test: project with 0 bids shows no "savings" claim; project with real bids shows the true leveled figure.

---

### F3 — New Project form pre-fills fields; typing appends — **Medium**

**Expected:** Click "Project Title", type a name.
**Saw:** 5 of 7 fields start pre-filled ("Austin, TX", "Class-A Commercial Mixed-Use", "Austin Commercial, LP", `5500000`, `52`). Clicking places the caret at the end, so typing **appends**: my `Dallas, TX` became `Austin, TXDallas, TX`, and my budget `14200000` became `550000014200000` — a **$550 billion** budget, silently accepted. I only caught it by reading the DOM.
**Recovery:** triple-click selects all, so a careful user can recover — but nothing signals that the field was pre-filled.

**Root cause:** `src/components/Header.tsx:76-81` — `useState("Austin, TX")`, `useState("Class-A Commercial Mixed-Use")`, `useState(5500000)`, `useState(52)`, `useState("Austin Commercial, LP")`. These are initialized as *values*, not placeholders.

**Definition of done:**
1. Use `placeholder` for hints; initialize the values empty (except where a default is genuinely intended).
2. If a default is intended, select-all on focus so typing replaces it, and/or show a "clear" affordance.
3. Validate budget on submit (e.g. reject > some sane ceiling) with a visible message.
4. Test: type a full project without clearing anything; assert the saved values equal what was typed.

---

### F4 — "Simulate Inbound Bid…" opens a demo dock, ingests nothing — **Medium**

**Expected:** From Bid Leveling, clicking "Simulate Inbound Bid…" ingests an inbound quote so I can see leveling.
**Saw:** It opens the "60-Second Executive Demo & Simulation Engine" dock. Bid count stayed 0. The dock's scenarios (A/B/C) have their own labels and none is called "Simulate Inbound Bid".

**Root cause:** `src/components/BidLevelingMatrixView.tsx:779-786` — `onClick={onOpenSimulation}`. A `title` tooltip explains the indirection, but the visible label does not.

**Definition of done (pick one):**
1. Rename the button to "Open Demo Simulation…", **or**
2. Make it actually ingest a simulated proposal for the active package (Scenario B/C behaviour) and rename to "Simulate Inbound Bid".
3. Test: the control's visible label matches the primary resulting action.

---

### F5 — Too many competing "next" CTAs, and they disagree — **Medium**

**Expected:** One obvious way to move forward.
**Saw:** On Bid Leveling simultaneously: the tour bar "Advance to Scope Clash Engine", the in-page footer "Advance to Scope Clash Engine ➔", a "Skip ahead: Contracts Register →" link, plus the toolbar "Scope Clash Engine". Two of these advance a different number of stages.
**Also duplicated:** empty-state CTA == header CTA ("Run AI Spec Breakdown" at `src/components/TradePackagesView.tsx:273` vs "⚡ AI Spec Breakdown (Auto-Scope)" at `:229`); and the demo-tour controls appear on multiple host screens.

**Root cause (pointers):** `src/components/BidLevelingMatrixView.tsx:1498` ("Advance…"), `:1508` ("Skip ahead…"), `src/components/InvestorDemoTourBar.tsx:144`, `src/components/TradePackagesView.tsx:229,273`.

**Definition of done:**
1. Exactly one primary CTA per screen. Secondary navigation (skip-ahead) becomes a quiet text link, not a second button.
2. Remove the empty-state CTA when the header already exposes the same action.
3. Test: count same-destination controls on each stage; must be 1 primary + optional 1 tertiary link.

---

### F6 — RFI form has no trade selector and defaults to the wrong package — **Medium**

**Expected:** As a plumbing bidder, my medical-gas question is recorded against Div 22.
**Saw:** The Manual Subcontractor RFI form has only *Contractor*, *Subject*, *Question*. The division is inherited from the page-level trade selector, which defaults to `26 00 00 Electrical`. My Div 22 medical-gas question was answered under "PACKAGE: CSI Division 26 00 00 – Electrical".
**Credit where due:** the AI's body text correctly reasoned that medical gas is *excluded* from Div 26 and belongs to Div 22 — so the answer was substantively right, but the package attribution is wrong and the user has no way to correct it in the form.

**Root cause:** `src/components/PreBidQnAView.tsx:739-800` — form fields are contractor/subject/question only; division comes from the active package.

**Definition of done:**
1. Add a trade/division selector to the form (defaulted to the active package, changeable).
2. Show the target package next to the submit button so the bidder confirms routing before submitting.
3. Test: submit a Div 22 question while Div 26 is selected; assert the RFI is stored against Div 22 (or the user was required to choose).

---

## 3. Lower-severity findings (fix when convenient)

| ID | Finding | Sev | Root cause / note |
|---|---|---|---|
| F7 | "Review PM Queue (3)" is white on amber `rgb(217,119,6)` = **3.19:1** at 12px, below WCAG AA 4.5:1 | Low | `PreBidQnAView` banner button. Darken bg or use dark text. |
| F8 | Long SEO page titles become company names: "Commercial Electricians, Industrial, and High" | Low | Title sanitizer in `convex/contractorDiscovery.ts:151-175` (`sanitizeContractorCompanyName`). Truncate/reject mid-word sentence fragments. |
| F9 | Tour/nav copy calls inboxes "dedicated" while 3 packages share one inbox (`boldlevel182@agentmail.to`) | Low (claims) | UI *does* warn per-card ("Shared inbox — AgentMail plan inbox limit reached") — good. Fix the marketing line in `src/components/InvestorDemoTourBar.tsx` to reflect the plan limit. |
| F10 | RFI AI body uses uppercase plain-text labels ("RFI SUBJECT:", "PACKAGE:") that read as unrendered markdown | Info | Not a rendering bug — `MarkdownLite` handles `#`/`**`. These are plain strings from the model. Optionally prompt for real markdown. |
| F11 | Two trade selectors in the same viewport (page-level "SELECT TRADE" chips + per-package chips elsewhere) | Low | Redundant controls; consolidate. |
| F12 | "Buyout" means both a dollar total and an award counter ("0/3 Awarded") in nearby copy | Low | Terminology; pick one meaning. |

**Verified NOT bugs (do not "fix"):**
- Shared-inbox warning — correct, honest surfacing of an AgentMail plan limit.
- XSS in RFI subject/question — safely rendered; `MarkdownLite` never uses `dangerouslySetInnerHTML` (`src/lib/markdown.tsx:36`).
- Whitespace-only subject — correctly disables submit.
- Empty auto-scope submit — button is correctly `disabled` (fixed since the prior audit).
- Confirm dialog stacking/clipping — correctly fixed (monotonic z-index, focus trap).
- Back button — works; tab state is URL-synced.

---

## 4. Issues present in the 2026-09-17 audit that are now FIXED (verified live)

This matters for the coding agent: do not re-fix these.

1. **New Project modal off-screen** — now correctly centered (measured dialog at x=461,y=188, 512×524, all fields on-screen and mouse-reachable).
2. **Hard-coded demo-tour counts** — now dynamic: "The active project currently has 0 CSI Trade Packages."
3. **Fabricated "TDLR Validated" contractor data** — Discovery now labels records **"Unverified — from web search result"** with an amber provenance banner and "Contact not published"; plausible real companies (FSG, Clark Electric). `convex/contractorDiscovery.ts:145-192`.
4. **Evals over-claiming** — now states "Prompt-grounded extraction check", counts a 3-case **holdout** where the answer is absent from the prompt, and shows "AIA A401 CONFORMITY: **N/A** — Not covered by this suite".
5. **Silent empty auto-scope submit** — button now `disabled` until text is present.
6. **No in-flight indicator on RFI submit** — now a spinner + "Analyzing Specifications…" + an explanatory status panel (but see F1: the failure path is still silent).
7. **Stacked/clipped confirm dialogs** — `ConfirmDialog` reworked with monotonic z-index, topmost-only key handling, focus trap and restore.
8. **RFI markdown rendering** — now via `MarkdownLite`.
9. **Timestamps** — now rendered with date + timezone ("Sep 18, 2026, 07:15:33 AM EDT"), not a bare drifting clock.
10. **LD figure inconsistency** — the leveling rationale now explicitly distinguishes "$6,000/wk schedule-impact rate, distinct from the contract's $1,200/day liquidated damages" (`BidLevelingMatrixView.tsx:794`).

---

## 5. Suggested fix order (one PR each)

1. **F1** — persist RFI before the LLM call + error/retry. (Data loss; highest harm.)
2. **F2** — correct the compact KPI label/logic. (Prevents a GC trusting a fake saving.)
3. **F3** — placeholder-not-value on New Project fields + budget sanity check.
4. **F4** — rename or rewire "Simulate Inbound Bid…".
5. **F6** — add the trade selector to the RFI form.
6. **F5** — collapse duplicate CTAs.
7. **F7–F12** — polish pass.

---

## 6. How this was verified (so a reviewer can trust it)

- Real `Input.dispatchMouseEvent` / `Input.insertText` interactions only; no clicking via `element.click()` for user actions.
- Two independent browser tabs on the same project to test realtime; Convex websocket propagation observed.
- Project A (`GC-AUDIT Riverside Medical Tower`, 3 Pkgs / 3 Subs / 3 RFIs) created through the real UI; demo project used for comparison; isolation verified by switching projects and comparing all counts and dollar figures (no leakage).
- Network instrumentation recorded **0 outbound requests** during discovery, confirming the provenance labels reflect a server-side directory, not a client fetch.
- Console: **0 errors / 0 rejections** on cold load; ~1.0 s load, 244 KB transfer, 850 DOM nodes.
- Adversarial passes: double-click on Delete (guarded by `createInFlightRef` / dialog focus trap), Escape cancellation, Back/Forward, whitespace + XSS + RTL/emoji input, mid-flight refresh, multi-tab.
- Responsive: 375×812 (no overflow), 200% zoom (no overflow), keyboard-only Tab (all stops visible).
- Automated contrast scan across all visible text: 3 hits, 2 false positives (gradient buttons), 1 real (F7).

**Limitations:** one auditor, ~30 minutes of live session; hydration/timing on a cold Convex deploy could not be stress-tested; the flaky RFI loss (F1) was reproduced 3/5 times, which is enough to report but its exact trigger (LLM error vs other) is inferred from source, not from server logs.

---

## 7. Artifacts

- Raw screenshots and JSON diagnostics from this audit were kept in the auditor's local `evidence/` working directory and are intentionally not redistributed with this report; every claim above is reproducible against the live app using the repro steps in each finding.
- The remediation of these findings is documented in [`audit-5-remediation.html`](./audit-5-remediation.html), including before/after screenshots.
