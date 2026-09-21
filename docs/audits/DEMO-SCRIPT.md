# TradePulse Pro — 3-Minute Demo Script

**Live app:** https://brainy-skunk-440.convex.site/
**Repo:** https://github.com/bO-05/tradepulse-pro
**Purpose:** record a ≤3:00 submission video. Every number quoted below is live in the app; do not narrate a figure you cannot see on screen.

---

## Pre-flight (do this before recording)

1. Open the live app in a fresh incognito window at 1440×900. Confirm the demo project loads with KPI `Leveled Buyout $3,918,500` and `Subcontracts: 1/3 Awarded`.
2. Close the Demo Tour if it auto-opens (X on the teleprompter).
3. Have the Judge Dock ready: top-right **⚡ 60s Judge Dock**.
4. If you will show Q&A, submit one RFI ~60 seconds before recording so a live AI clarification is already on screen.

## Shot list

| Time | Screen | Action | Narration (say this) |
|---|---|---|---|
| 0:00–0:15 | Landing (demo project) | Hover the KPI band and 6-stage stepper | "Commercial GCs lose six figures to hidden scope exclusions. TradePulse Pro runs the whole MEP buyout loop on Convex: scope, discover, pre-bid Q&A, leveling, clash resolution, and contracts." |
| 0:15–0:35 | CSI Scoping | Scroll the three Division cards; point at AgentMail inboxes and mandatory inclusions | "The spec is decomposed into CSI MasterFormat packages with dedicated project inboxes. Budgets and mandatory inclusions are explicit from day one." |
| 0:35–1:00 | Bid Leveling | Show Rosendin `$1,225,000` vs Alterman `$1,286,000`; open Alterman's exclusion breakdown; point at the KPI `Gaps Exposed +$186,000` | "Alterman looks cheaper on paper at $1.1M. ADR-0003 adds its four exclusions, lead-time delay and COI deficiency — its true cost is $1.286M. The hidden gaps surfaced are $186,000, and the KPI band, the card and the audit stream all agree." |
| 1:00–1:20 | Bid Leveling → Award | Click **Award Compliant Winner (…)** (if already awarded, skip to Contracts) | "Awarding generates a 10-article A401-style subcontract draft with retainage and liquidated damages — clearly labeled as not an official AIA form." |
| 1:20–1:40 | Subcontracts | Show `ACTIVE CONTRACTED SUM`, `LDs: $1,200/day`; open the agreement; click **Record Execution Status** only if you want to show the lock | "The register and the leveling matrix agree on the same contracted sum. Execution is recorded with an explicit 'not an e-signature' disclaimer, and the record locks." |
| 1:40–2:00 | Scope Clash | Point at the $50,500 double-buys and $46,500 voids; (optional) click **1-Click Deduct Credit** on the VFD double-buy | "Trades double-buy equipment and leave voids. The clash engine prices both, and one click deducts the credit into the leveling matrix." |
| 2:00–2:20 | Pre-Bid Q&A | Show the AI clarification card with Confidence %, then **Issue Legal Addendum NO. 01** | "Pre-bid RFIs are answered against the specification, PM-certified, and compiled into a filed CSI addendum stored in Convex storage." |
| 2:20–2:40 | Live Activity Audit | Scroll the stream; point at the manual cron buttons | "Every action is an immutable audit event over Convex websockets. Deadline and compliance crons run on schedule." |
| 2:40–3:00 | Evals & Architecture | Point at **Holdout — Answer Not In Prompt 3/3, MAPE 0.00%**, then the model cards | "The eval suite parses eight proposals, coordinates two cross-trade cases, and runs three holdout cases whose proposals state no total at all — the model has to do the arithmetic. Gemini and Claude run live; OpenAI is a BYOK adapter. Convex is the backend end to end." |

## Alternate 60-second cut (if judges want pure speed)

1. **⚡ 60s Judge Dock** → **1-Click Run Full Autonomous Procurement Lifecycle** (~20s, writes real records).
2. Read the dock result line: awarded bidder, agreement number, exclusions caught.
3. Close the dock → **Bid Leveling** (awarded matrix + variance), then **Scope Clash** → **Deduct Credit**.
4. End on **Subcontracts** (A401-style draft + contracted sum).

## Lines to avoid (the app no longer claims them)

- No "100% TDLR verified" or "verified licensing" — discovery shows **provenance**; only registry-page sources are labeled verified.
- No "OpenAI runs the pipeline" — say **OpenAI is a BYOK adapter**; Gemini/Claude are live today.
- No "100% parity / zero cheating" — say **holdout cases cannot be passed by copying**.
- No "our AI signs contracts" — the app explicitly records external execution and disclaims e-signature.

## Evidence you can cite in the submission text

- `npx vitest run` → 113/113 (regression, leveling/derived-number, discovery-guard, and claims-honesty suites).
- Holdout eval run `eval_1789900335453`: 13/13 cases, holdout 3/3, MAPE 0.00%, live Claude traces, prompts verified to contain no answer.
- Adversarial pass: triple-click create → 1 project; zero-recipient RFQ dispatch leaves the package `draft` with zero dispatched events; mid-submit refresh does not duplicate or lose the RFI; 720px (200% zoom) → 0px overflow; keyboard-only dialog open/close with focus restore.
- Demo project byte-stable after every test; all `AUDIT-*` fixtures deleted.