# TradePulse Pro — Demo Voiceover Script (word-for-word)

**Target length:** 2:40–2:55 · **Read at:** ~145–150 wpm · **App:** https://brainy-skunk-440.convex.site
**Companion:** [`DEMO-SCRIPT.md`](./DEMO-SCRIPT.md) is the click/shot list; this file is the narration and the exact on-screen values.
**Recording kit:** local-only (see the repo's git-ignored `doc/demo-kit/` — intentionally not tracked).

> **Narration stance (no fake customers).** This script never claims a real GC said anything.
> The problem statement cites public industry research; the proof comes from the app's own
> source document, visible arithmetic, and the public audit history. If you add a persona,
> label it: "a composite of the standard buyout workflow, not a real interview."

## Pre-flight (2 minutes, before you hit record)

1. Fresh incognito window (or a fresh profile), **1920×1080**, zoom 100%.
2. Confirm the Projects selector lists **only** "The Domain Tower B - Commercial MEP" (no `AUDIT-*` fixtures).
3. Dismiss the Demo Tour (X). Confirm the KPI strip shows Budget **$4,250,000** and Leveled Buyout **$3,918,500**.
4. Have two tabs ready: the app, and `docs/audits/audit-6-remediation.md` (§9) in case anyone asks how claims were verified.
5. **Demo safety:** never run the Judge Dock or award a contract on the demo project on camera — do those beats on a throwaway `AUDIT-DEMO-*` project (then delete it). Never open the demo's stored agreement (its seeded title predates the A401-style fix). If discovery is in your shot list, test the exact query first; the app may honestly return "no usable contractors".

## The script (timed to a 2:45 cut)

| Time | Screen / action | Exact on-screen value | Voiceover (read verbatim) |
|---|---|---|---|
| 0:00–0:12 | Landing, demo project. Hover the two leveling cards (Bid Leveling tab). | Alterman **$1,100,000** (apparent low) · Rosendin **$1,225,000** | "Every commercial buyout starts with a spreadsheet and one question: is the cheapest bid actually the cheapest? On paper, this project has a clear winner — one point one million dollars. Watch what happens when you check." |
| 0:12–0:30 | Stay on KPI strip. | Budget $4,250,000 · Leveled Buyout $3,918,500 · Variance **+$331,500 (7.8%)** · Gaps **+$186,000** | "Buyout is where a GC's margin lives or dies. The industry's own dispute data keeps naming the same causes — scope gaps, incomplete documents, and change. Comparing paper price hides exactly those. TradePulse runs the whole MEP buyout loop on Convex, so the comparison is true cost." |
| 0:30–0:52 | Tab **01 CSI Scoping**. Scroll the three package cards. | 3 Pkgs · Div 26 / 23 / 22, each with budget, mandatory inclusions, bid deadline, inbox | "One specification becomes CSI MasterFormat packages — Division 26 electrical, 23 HVAC, 22 plumbing — each with a budget, mandatory inclusions, a bid deadline, and its own project inbox." |
| 0:52–1:18 | Scroll to **Project Documents**, click **Preview** on `Alterman_Power_Quote_Proposal.pdf`. Point at the exclusions block and the lead-time line. | EXCLUSION 1–4 ($45,000 + $22,000 + $55,000 + $25,000) · "16 weeks … (+4 weeks late)" | "Before leveling, meet the source. This is the actual proposal file the app ingested. Scan the qualifications: crane rigging excluded, firestopping excluded, seismic bracing excluded, overtime excluded — and a sixteen-week equipment lead time against a twelve-week milestone." |
| 1:18–1:50 | Tab **04 Bid Leveling**, Alterman card: read each line of the normalization and then the ranked totals. | $1,100,000 + $147,000 + $24,000 + $15,000 = **$1,286,000** vs Rosendin **$1,225,000** | "Now the leveling card. The model extracted those facts from the document; the dollars are computed by rules, not guessed. Base one point one million, plus one hundred forty-seven thousand in exclusions, plus twenty-four thousand for the four-week delay, plus fifteen thousand for the insurance deficiency. True leveled cost: one million, two hundred eighty-six thousand. The other bidder submitted one million, two hundred twenty-five thousand with zero exclusions. The paper-cheapest bid is the real most expensive — and every term is on screen." |
| 1:50–2:10 | Tab **05 Scope Clash**. Show the KPI cards, then click **1-Click Deduct Credit** on the VFD double-buy. | Double-Buys **$50,500** · Voids **$46,500** · the deduct updates the matrix | "Trade overlaps cost money too. The clash engine finds fifty thousand five hundred dollars of double-buys and forty-six thousand five hundred in scope voids. One click deducts the credit and the leveling matrix updates." |
| 2:10–2:32 | Tab **Live Activity Audit**. Scroll once. Optional: Contracts tab → register row + disclaimer footer. | Actor + timestamp per event · "AgentMail Delivery: 0 of N … No email was delivered" · "A401-style … not an AIA-licensed form" | "Every action lands in the audit stream with an actor and a timestamp — including failures. A human PM must certify an RFI before an addendum issues. And when email can't deliver on this deployment, the app reports zero delivered instead of pretending. The system tells you what it can't do." |
| 2:32–2:48 | Tab **Evals & Architecture** (or hover the KPI strip). Close on the demo KPI band. | Providers: Claude + Gemini live; OpenAI BYOK. Holdout 3/3 · MAPE 0.00% | "Convex is the backend end to end — data, functions, storage, and realtime propagation in milliseconds. Firecrawl discovers contractors with provenance, AgentMail carries the inboxes and webhook, and OpenAI is a bring-your-own-key adapter. Six independent audits and the remediation report are public in the repo. Every number here is auditable." |
| 2:48–2:55 | Hold on KPI band. | — | (silence / soft music fade) |

Word count ≈ 390 → ≈ 2:35 of speech plus pauses ≈ **2:45**. If you run long, cut the parenthetical in 1:18–1:50 first, then the second sentence of 0:12–0:30.

## 45-second social cut (same story, three beats)

1. **Hook (0:00–0:08):** "The lowest bid on paper is rarely the cheapest. One point one million versus one point two two five — here's the real number." (cards on screen)
2. **Aha (0:08–0:30):** "The proposal excludes crane rigging, firestopping, seismic bracing, and overtime, and carries a 16-week lead against a 12-week milestone. The app computes true cost in code: $1,286,000. Every dollar visible." (source PDF → arithmetic)
3. **Close (0:30–0:45):** "Scope, discovery, Q&A, leveling, clash, contract, audit — one Convex backend. The audit trail reports failures honestly. Repo and live app are public; links in the post."

## Honesty beats (say these where they fit — they build trust, not doubt)

- **Shared public demo:** "This is a public shared demo — the banner says so, and nothing on screen is real bid data."
- **Seeded simulation:** "The demo bids are a seeded simulation using public company examples; the engine's math is the real thing."
- **Determinism:** "Re-ingest the identical proposal and the number doesn't move — it's computed, not sampled." (A judge can test this live.)
- **Email:** "Delivery on this deployment is plan-limited; the app reports 0 of N delivered rather than showing a fake success."
- **Contract:** "This is an A401-style draft, not an official AIA form — the document says that."
- **PM gate:** "A human must certify the RFI before the addendum issues; the app refuses otherwise."

## Research anchors (verify the exact figure before putting it on screen; use at most one)

- **HKA CRUX** dispute reports — scope change / incomplete information consistently top the causes of construction disputes (qualitative claim is safe as stated).
- **FMI/PlanGrid "Construction Disconnected"** — rework ≈ 5% of construction cost, with poor data/communication a leading driver (verify the % in the report you cite).
- **McKinsey Global Institute "Reinventing Construction"** — construction labor-productivity growth ≈ 1%/yr versus ≈ 2.8% for the wider economy (widely cited).
- Prefer zero numbers over an unverified number: name the report, state the mechanism, move on. The app's own visible arithmetic is the strongest evidence you have.

## Do not say

- "OpenAI runs the pipeline" (it is a BYOK adapter; no key is set — Diagnostics says so).
- "We email the subcontractors" (say "we queue the invitation and report delivery honestly").
- "Official AIA contract" / "authenticated AIA" (say "A401-style draft").
- "Real GCs told us" / implied customer testimonials (there is no interview; use the audit history instead).
- "100% accurate" / "guaranteed cheapest" (say "auditable arithmetic; you decide").

## If a judge asks "how do you know?"

Show, in order: (1) the source proposal PDF in Project Documents; (2) the leveling card arithmetic;
(3) the audit stream entry for the ingest with actor + timestamp; (4) `docs/audits/audit-6-remediation.md`
(the remediation report with reproduction status and the browser-only re-verification guide) and
`docs/audits/audit-6-usefulness.md` (the independent audit that was remediated).

## Post-record checklist

1. Trim to ≤2:55; add the voiceover (or captions); export 1080p H.264/AAC.
2. Upload (public is safest; unlisted is still viewable logged-out) with the live URL and repo in the description.
3. Publish the social post tagging **Convex, OpenAI, Firecrawl, AgentMail** with the hackathon tag.
4. Submit at Vibe Apps with the video, live URL, and repo links.
5. Re-open every link in a logged-out window: video plays, app loads, repo is public.
6. Delete any throwaway `AUDIT-*` project used for dock/contract beats; confirm the Projects list shows only "The Domain Tower B - Commercial MEP" with unchanged headline numbers.