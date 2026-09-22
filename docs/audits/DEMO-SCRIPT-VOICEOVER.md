# TradePulse Pro — Demo Voiceover Script (2:40–2:55)

**Companion to:** [`DEMO-SCRIPT.md`](./DEMO-SCRIPT.md) (the 3-minute shot list and evidence citations).
**Live app:** https://brainy-skunk-440.convex.site · **Repo:** github.com/bO-05/tradepulse-pro
**Record target:** 1920×1080 (or 1440×900), clean browser profile, no bookmarks bar, dark UI as shipped.

> **Honesty rules for this recording.** No invented customer quotes. The problem is stated from
> industry research; the proof is the on-screen source document, the rendered arithmetic, and the
> audit stream. Where the app cannot do something, say it. Every number quoted below exists on
> screen and has been live-verified.

---

## Pre-flight (10 minutes, before recording)

1. **Fresh profile / incognito**, 1920×1080, 100% zoom. Confirm the demo project is selected and the
   banner is visible: *"Public shared demo — everything here is visible to anyone with this URL…"*.
2. **Confirm the demo headline strip** (reload once): `Budget $4,250,000` · `Leveled Buyout $3,918,500`
   · `Variance +$331,500 (7.8%)` · `Gaps Exposed +$186,000` · `Subcontracts 1/3 Awarded` ·
   badges `3 Pkgs / 4 Subs / 3 RFIs / 2 Bids / 4 Clashes`.
3. **Do NOT run the Judge Dock / 1-Click lifecycle on the demo project** — it writes fixed
   demonstration records and can drift the demo. If you want that beat, run it on a throwaway
   project and delete it afterwards.
4. **Do NOT open the demo's seeded agreement** ("Inspect Draft" on the Rosendin contract). Its
   stored document text predates the A401-style honesty pass. Show the Contracts *register* and the
   disclaimer footer, or record the contract beat on a throwaway project.
5. **Test the Firecrawl query you plan to show** (Discovery → a trade → Discover). Discovery is
   strictly filtered now; it may legitimately return *"no usable contractors"*. If it does, either
   record that honest state as a trust beat, or skip discovery on camera.
6. **Avoid live LLM calls inside the timed video** (they can add 10–30s each). The seeded demo
   already contains the full story; use it read-only for speed. If you show live ingestion, accept
   the wait or trim in the edit.
7. Have these ready: the leveling tab (Div 26), the project-files register, Scope Clash, Contracts,
   and the Activity Audit tab.

---

## Beat sheet + word-for-word voiceover

### 0:00–0:12 · HOOK — two numbers (Bid Leveling tab, Div 26 package)

**On screen:** the two bid cards side by side — Alterman `$1,100,000` base vs Rosendin `$1,225,000`.

> "Two electrical bids. Alterman looks eleven hundred thousand. Rosendin looks one point two two
> five million — a hundred and twenty-five thousand more. On paper, Alterman wins. Watch what
> happens when you compare *true* cost."

### 0:12–0:27 · STAKES — research-anchored, no fake customer

**On screen:** the leveling header / Why-GCs-Care (optional).

> "This is bid buyout: where a general contractor's margin is won or lost. The construction
> industry's own dispute and rework research keeps naming the same root causes — scope gaps,
> incomplete documents, change. So the job isn't finding the low number. It's finding the real one."

*(If you cite one report, name it here and verify the exact figure beforehand: HKA CRUX
(dispute causes), FMI/PlanGrid “Construction Disconnected” (rework ≈5% of cost), McKinsey
“Reinventing Construction” (productivity gap). Do not put an unverified percentage on screen.)*

### 0:27–0:50 · SCOPE — the spec becomes GC-owned packages (CSI Scoping)

**On screen:** CSI Scoping — three package cards (Div 26 Electrical, Div 23 HVAC, Div 22 Plumbing)
with budgets, mandatory inclusions, and AgentMail inbox lines.

> "One specification in. Three CSI MasterFormat packages out — each with a budget, mandatory scope
> inclusions, and its own project inbox. Before a single bid arrives, the scope boundaries and the
> money envelope are explicit. That's what makes leveling possible later."

### 0:50–1:15 · SOURCE — show the actual proposal (Project Files, below the package grid)

**On screen:** scroll to **Project Documents**; open `Alterman_Power_Quote_Proposal.pdf` (Preview).
Point at the exclusions and the lead line.

> "Here is the document the app actually ingested — Alterman's own proposal. Four explicit
> exclusions: crane hoisting, firestopping, seismic bracing, overtime. And the fine print: main
> switchgear lead time is sixteen weeks against a twelve-week schedule milestone. That's the gap
> between the paper bid and the real bid."

### 1:15–1:48 · AHA — the reversal (Bid Leveling, Alterman card)

**On screen:** the Alterman card’s normalization block. Point at each term as you speak it, then at
the true leveled cost, then the Deceptive banner (`+$186,000 True Variance`).

> "The model extracts the facts. The rules compute the dollars — every term is on screen.
> Base: one point one million. Exclusions: forty-five plus twenty-two plus fifty-five plus
> twenty-five — one hundred and forty-seven thousand. Lead time: sixteen weeks versus the
> twelve-week Division 26 milestone — four weeks at six thousand, twenty-four thousand.
> COI deficiency: fifteen thousand. True leveled cost: one million, two hundred eighty-six thousand.
> Versus Rosendin's clean one point two two five million with zero exclusions. The paper winner is
> the real loser — and the app flags exactly why."

*(Optional single sentence, only if you want the auditability point: “Re-run the same proposal
twice and the number doesn't move — it's computed by rules, not guessed by a model.”)*

### 1:48–2:10 · CLASH — recovered money (Scope Clash)

**On screen:** Scope Clash KPIs — `Double-Buys $50,500 (2)` and `Voids $46,500 (2)`; then
`1-Click Deduct Credit` on the VFD double-buy.

> "Trades double-buy equipment and leave gaps between scopes. The clash engine prices both: fifty
> thousand five hundred in double-buys, forty-six thousand five hundred in scope voids. One click
> turns the overlap into a credit that flows straight into the leveling matrix — money recovered
> before it's lost."

### 2:10–2:38 · TRUST — the system tells you what it can't do (Activity Audit → Contracts)

**On screen:** Live Activity Audit stream (actor + timestamp per event; point at a
`AgentMail Delivery: 0 of N eligible recipient(s) — No email was delivered` line); then Contracts
register with the disclaimer footer.

> "Every step is an append-only audit event with an actor and a timestamp. When a human decision is
> required, the app stops — an addendum can't issue until a project manager certifies the RFI.
> And when email delivery fails on this deployment, the app reports zero delivered instead of
> pretending. The system tells you what it can't do. That's the difference between a demo and a
> tool."

### 2:38–2:55 · SPONSORS + CLOSE (Evals & Architecture / Diagnostics, then back to the KPI strip)

**On screen:** Diagnostics page (sponsor cards, provider availability), then the KPI strip.

> "Under the hood it's all four sponsors: Convex for the reactive backend, realtime sync, storage and
> static hosting. Firecrawl for provenance-labeled contractor discovery. AgentMail for per-package
> inboxes and signed webhooks. And OpenAI as a bring-your-own-key adapter — no key on this
> deployment, and the diagnostics say so. The repo carries six independent audits and a remediation
> report with reproduction status. One project, one loop, and every number auditable."

---

## Honesty micro-lines (drop-in, use only if the moment comes)

| If you're showing… | Say |
|---|---|
| Shared plan inbox | "The free AgentMail plan limit reuses an inbox, and the package card labels it as shared." |
| RFQ delivery | "Invitations are recorded and delivery is attempted; here it reports 0 delivered — nothing is faked." |
| A401 draft | "It's an A401-style draft, not an official AIA form — the document says that itself." |
| Seeded data | "The bids you're seeing are a seeded simulation using public company examples; the banner notes this is a public instance." |
| Add-alternates | "The model handles deduct credits; a stated add-alternate is recorded without affecting the total today." |
| No auth | "This is a public single-tenant demo by design; a production tenant would scope data per account." |

## Do not say

- "OpenAI runs the pipeline" / any claim OpenAI is live (it is a BYOK adapter with no key).
- "We send RFQ emails" — say "queue and report delivery".
- "Official AIA contract" — it is A401-style.
- "Real GCs told us…" — no interviews; use the research anchor and the audit trail instead.
- "100% accurate AI" — say "the AI extracts; the rules compute, and you can audit every term".

## Post-record checklist

1. Trim to ≤2:55; add the voiceover (or captions); export 1080p H.264.
2. Upload **publicly** (unlisted still works logged-out, public is safest) — title/description include
   the live URL and repo.
3. Publish the social post tagging **Convex, OpenAI, Firecrawl, AgentMail** with the hackathon tag.
4. Submit at Vibe Apps with the video, live URL, and repo links.
5. Re-open every link in a logged-out window; confirm the video plays, the app loads, and the repo
   is public.
6. Delete any throwaway project used for the Judge Dock/contract beat; confirm the Projects list
   contains only "The Domain Tower B - Commercial MEP" and its headline numbers are unchanged.