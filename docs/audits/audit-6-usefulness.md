# TradePulse Pro — Adversarial Usefulness Audit (AUDIT-6, final)

**Audited:** live deployment https://brainy-skunk-440.convex.site + public repo github.com/bO-05/tradepulse-pro
**Date:** 2026-09-20 (UTC) · **Auditor access:** browser-only (public repo + live app)
**Judging deadline referenced:** Sep 22, 2026 12:00 PM PT
**Pass:** deep second pass. Supersedes the first-pass draft; several first-pass findings are corrected in §2b/§9.

> **CODING-AGENT START HERE (do these first, in order).** The app is genuinely good; it does not need a rewrite. These 5 changes protect the demo you have already built — each is small and each removes a thing a judge or a real GC can catch:
> 1. **Deterministic lead-time penalty** (Critical, S). In the leveling/extraction path, take the already-extracted `leadTimeWeeks` integer (the UI shows "16 wks"/"17 wks" today) and compute `penalty = max(0, leadTimeWeeks - 12) * 6000` in plain code — do NOT let the model return the dollar penalty. Set extraction decoding to temperature 0. Render the arithmetic next to the line ("17-12 = 5 × $6,000 = $30,000"). This fixes A6-05r/A6-54 and makes the headline ADR-0003 claim true.
> 2. **RFQ toast must tell the delivery truth** (High, S). Where the "Invitation to bid dispatched via AgentMail" toast fires, read the per-recipient delivery result already written to the audit log and show "Sent — delivered to N of M" or "Queued — delivery failed (see audit)". Removes the "dispatched" vs "0 delivered" contradiction (A6-29).
> 3. **Public-demo banner** (High, XS). One persistent footer/banner: "Public shared demo — everything here is visible to anyone with this URL. Do not enter confidential or real bid data." (A6-18).
> 4. **Fix the two dead controls** (Medium, S): wire "Record Execution Status" to a real dialog or delete it (A6-34); make "Auto-Scope" echo the parsed divisions and ask to confirm before writing (A6-42).
> 5. **Doc/copy truth pass** (Medium, XS–S): README "AIA Document A401" → "A401-style"; qualify "$38,500" as the VFD item; fetch `/llms.txt` live in the Diagnostics panel (A6-13); fix the "auto-classifies" copy (A6-38).
> Everything else in §5 is real but lower priority. §6 ranks all ten; §7 lists what NOT to touch.

---

## 1. Verdict card

| | Verdict | One-line |
|---|---|---|
| **(a) Demo verdict** | **PARTLY** | The seeded story lands in ~3 minutes and the demo's leveling arithmetic is exact to the dollar, but the demo's most trust-building surfaces (Judge Dock, generated A401/addendum, discovery) carry fabricated parties/figures or non-contractor pages, so a careful evaluator trusts it less the longer they look. |
| **(b) BYO verdict** | **PARTLY** | A GC can create their own project, scope their own spec, upload their own documents and ingest their own proposals — all verified — but the **leveling engine mis-prices BYO proposals**: the lead-time penalty does not follow the app's own documented $6,000/week rate and can change run-to-run for identical input. A GC cannot yet trust a BYO buyout decision. |

**Per-persona one-liners**
- **GC estimator (primary):** The leveling matrix + CSV are the real product and the exclusions/COI math is exact on my own non-round numbers; but the lead-time term — one of only four terms in ADR-0003 — is wrong/unstable on my inputs (16w→+$24,000, 17w→+$6,000, 20w→+$24,000; same text sometimes $0).
- **Subcontractor bidder (secondary):** There is **no sub-facing view**; the only sub touchpoint is outbound RFQ email, and on this deployment **real AgentMail delivery fails (0 delivered on every attempt observed)**, though the audit log states so honestly.
- **Procurement admin:** The audit stream is a genuine actor-attributed causal log and the crons run and log honestly; but "Record Execution Status" is a dead control, discovery imports non-contractor pages, and there is no identity/attribution.
- **Judge (60s):** The Judge Dock is polished, context-aware, and asks for confirmation before writing — but its 3 scenario cards use fixed demo figures and its 1-Click loop wrote fixed demo parties onto a custom project in my run.

**Single biggest credibility risk across both:** the **lead-time penalty** — the app advertises "forensic" ADR-0003 leveling with a published rate ($6,000/week over a 12-week target; README's own example 16w→+$24,000), yet on identical inputs it returned $24,000, $6,000 and $0 across runs, and never once matched the formula on a non-16-week input. For a tool whose whole value is "the paper-cheapest bid isn't the real cheapest," an unstable delay term silently under-collects delay exposure and can flip a ranking. This is a core-claim failure, not polish.

**Runner-up risk:** discovery imports non-contractor pages (a city permits office, an IBEW directory, a contractor's blog post) and binds names that do not match the cited source domain, despite copy stating "Directory and aggregator pages are skipped." Honesty mitigation (rows labeled "Not verified — from web search result") is present and real.

---

## 2. Prior-audit digest (proof of required reading)

**Read (all six sources):** `docs/audits/README.md` (index + current-state paragraph); `audit-1-ux.html` (NO-GO, 5 P1 blockers, 15 Sep); `audit-2-user-journey.html` (5 personas, BUG-01…BUG-36, 17 Sep); `audit-3-adversarial.html` (27 known-state re-verifications 25 pass / 2 method-artifact / 0 regressed; new AUD-01…05, 18 Sep); `audit-4-ui.html` (+ `.md` copy, F1–F12, verdict "Partly", 18 Sep); `audit-5-remediation.html` (F1–F12 verification table, 77 FIX-NEW / 17 USE, 18 QA rounds, clean rounds 17–18, 19 Sep).

**Status as claimed:** all Critical/High/Medium fixed & re-verified; F10/F11 marked UNREPRODUCED (not "fixed"); two consecutive clean rounds; regression `tsc -b` clean / `vitest` 80/80 / Python 36/36; demo byte-stable; fixtures deleted.

**Live spot-checks (re-tested today, not trusted) — 12 items:**

| # | Item | Audit of origin | Result | Evidence observed today |
|---|---|---|---|---|
| 1 | New Project placeholders; typed values saved exactly | audit-4 F3 / audit-5 | **STILL HOLDS** | Created "AUDIT6-3 Cedar Ridge Booster Station", typed GC/budget/type; saved verbatim, no append |
| 2 | 0-bid project no longer claims "(best bid per package)" / fake savings | audit-4 F2 / audit-5 | **STILL HOLDS** | New AUDIT6-3 showed `(project budget)` + `Budget vs scope estimate (+$0) (not bid-based)` before bids |
| 3 | "Simulate Inbound Bid…" renamed | audit-4 F4 / audit-5 | **STILL HOLDS** | Leveling toolbar reads `Open Demo Simulation…` |
| 4 | Addendum disabled with 0 certified RFIs | audit-5 USE-A4-07 | **STILL HOLDS** | On a fresh package, "Issue Pre-Bid Addendum" showed "Certify at least one RFI to enable" and refused |
| 5 | Addendum refuses while RFIs uncertified | audit-1 P1 | **STILL HOLDS** | With 1 pending RFI: "Addendum generation failed: PM certification is required… Review 1 pending RFI(s)." |
| 6 | High-confidence RFI still requires PM gate | audit-1 P1 / audit-2 | **STILL HOLDS** | 96%-confidence RFI sat in "PM Review Required"; only "Approve for Addendum" advanced it |
| 7 | Dialog contract (role/aria-modal/label/focus restore) | audit-2 BUG-01/33 | **STILL HOLDS** | All modals `role=dialog`; Escape closed and restored focus |
| 8 | 0px horizontal overflow at 320/375 | audit-2 BUG-34 | **STILL HOLDS** | Overflow 0 at 375 and 720 (200% reflow) |
| 9 | Deep-link URL sync / Back-Forward | audit-4 §6 | **STILL HOLDS** | `?tab=` updates per stage; reload preserves tab |
| 10 | CSV integrity | audit-3 deep pass | **STILL HOLDS** | Spread Table View + CSV export produced backend-matching values |
| 11 | Eval case-level contradiction resolved ($46,500) | audit-1 P1 | **STILL HOLDS** | case-mep-02 truth == output == $46,500; suite relabeled extraction check; AIA conformity N/A |
| 12 | Executed-contract immutability guard | audit-5 FIX-NEW-03/17/26 | **STILL HOLDS (indirect)** | Contracts register shows execution gating; "Record Execution Status" is present (but see A6-34 — it is a dead control) |

**Where the audits no longer hold / were incomplete (corrected in this pass):**
- (a) The "zero polling / realtime" claim was only single-context in prior passes; I completed a **two-context** measurement (below, C12) — it holds.
- (b) **First-pass A6-05 was wrong** ("lead-time penalty never fires"). Deeper testing shows the truth is **nondeterminism + a wrong rate**, not a blanket skip. See §2b.
- (c) First-pass "Auto-Scope silently does nothing" was **input/race-dependent**: a clean single-division spec auto-scopes correctly; an ambiguous one produced an unrelated division with no warning. Revised (A6-42).
- (d) First-pass "Judge Dock hardcodes GC name" is **specific to the Judge-Dock path**; the normal Award & Draft path correctly derives the GC from the project record (verified). Revised (A6-37).

---

## 2b. Corrigenda — what this deeper pass changed vs the first draft

Honesty about the audit itself. These first-draft claims were **overstated, wrong, or incomplete** and are corrected here:

| First-draft claim | Status now | Truth |
|---|---|---|
| A6-05 "BYO lead-time penalty never fires" | **CORRECTED** | It fires sometimes; the failure is **nondeterminism** and a **penalty that ignores the rate**. Exact same text produced $0 and +$24,000 in different runs; 17w→+$6,000 and 20w→+$24,000 vs the documented $6,000/wk. (A6-05r, A6-54) |
| A6-05 "every VE auto-accepted" | **CORRECTED** | On the demo, Rosendin's VE is shown **"(Declined)"** (not auto-accepted). VE default state is inconsistent between demo and ingested bids; restate as "VE accept state is not obviously GC-controlled on ingest." (A6-51) |
| A6-06 "Auto-Scope silently does nothing" | **CORRECTED** | It works on a clean spec (Div 26 25 created correctly from my text); it produced a wrong division once with no warning. Real finding = no parse echo/confirmation. (A6-41/42) |
| A6-02 "Judge Dock hardcodes demo GC into real projects" | **NARROWED** | True **only for the Judge-Dock simulation path**, which is explicitly labeled a fixed demo slate. The normal path derives the GC from the project record correctly. (A6-37/45) |
| A6-04 "A401 hardcodes demo GC + fabricated license" | **NARROWED** | The **Judge-Dock** A401 did; the normal Award path produced my own GC name ("Cascade Water Works Constructors JV"). Contact cross-contamination observed (name ↔ other company's email). (A6-35) |
| A6-01 "fabricated CO-LIC-VERIFIED on quote-created contractors" | **PARTIALLY SUPERSEDED** | Reproduced in the first pass; in this pass, quote-created contractors on my new packages inherited provenance labels I could not fully re-trigger, and discovery rows were correctly "Not verified". Treat the fabricated-badge as **observed once, not re-reproduced**; the *discovery* quality problem (A6-27/28) is the solid, reproduced version. |
| C13 "8 packages from my 8-division spec" | **NOT RE-REPRODUCED** | This pass used a single-division spec (Div 26 25) and a plumbing spec; produced 1 correct package. Multi-division breadth not re-run. |
| C15 "TXT silently dropped" | **SUPERSEDED** | This pass: upload input `accept=".pdf,.dwg,.dxf"` (no txt) — same mismatch; uploads of PDF work and label by the manual type dropdown, not auto-classification (A6-38). |

---

## 3. Claim-vs-reality table (C1–C15)

| # | Claim (source) | Observed live (this pass) | Verdict | Evidence |
|---|---|---|---|---|
| C1 | Demo `Leveled Buyout $3,918,500`; `Buyout 1/3 Awarded` (DEMO-SCRIPT) | Present, reload-stable | **REAL** | Demo KPI band + stepper |
| C2 | Reconciled $4,250,000 / $3,918,500 / +$331,500 (7.8%) / +$186,000 (README/script/log) | All four agree across strip and 6-card view | **REAL** | `Budget $4,250,000`, `Leveled Buyout $3,918,500 (best bid per package)`, `Variance +$331,500 (7.8%)`, `Gaps Exposed: +$186,000` |
| C3 | Alterman $1.1M→$1,286,000; Rosendin $1,225,000; VE −$35,000; savings $61k–$96k (README) | Alterman math exact ($1,100,000+$147,000+$24,000+$15,000=$1,286,000); Rosendin VE shown **Declined** → $1,225,000; README states both ("$1,190,000 with VE accepted") | **REAL** | Leveling cards; README lines 106–107 |
| C4 | Clash README `$38,500` VFD vs script `$50,500`/`$46,500` (README/script) | Demo shows Double-Buys **$50,500** (2), Voids **$46,500** (2); on a custom project the VFD item was a **$38,500 recoverable credit**. Different items, per-project | **REAL (no conflict)** — docs describe different surfaces | Clash KPI cards, both projects |
| C5 | Discovery provenance; "Unverified" unless a registry page was the source (README/llms) | Discovered records correctly "Unverified — from web search result"; registry-sourced ones "OR-LIC-VERIFIED/active"; **but non-contractor pages (city permits office, IBEW directory, a blog post) are imported as records and name ≠ source domain** | **PARTIAL** | Discovery Div 26 & 23; screenshot `audit6-discovery-provenance.png` |
| C6 | AgentMail shared-inbox disclosure (README/llms/UI) | 6th+ package showed `Shared inbox — AgentMail plan inbox limit reached` | **REAL (disclosure)** | Package card |
| C7 | OpenAI BYOK; Gemini/Claude live (README/llms) | Diagnostics: OpenAI GPT-4o "Adapter ready — OPENAI_API_KEY not set"; live runs `provider=Anthropic, model=claude-sonnet-5` | **REAL** | Diagnostics + traces JSON |
| C8 | 1-click lifecycle works (README) | Works and asks confirmation; **but writes fixed demo figures/parties** ("awarded Rosendin Electric, Inc. $1,190,000") onto the active project | **THEATER on custom projects (labeled as such)** | Judge Dock; audit stream `CONTRACT AWARDED` |
| C9 | Holdout 3/3, MAPE 0.00%, traces inspectable (DEMO-SCRIPT) | Re-ran live: Run ID advanced Sep 18→Sep 20, 13/13, MAPE 0.00%; traces have real tokens/latency/cost and holdouts contain **no total in prompt** | **REAL — strong** | `audit6-eval-traces.json`; `audit6-evals-page.png` |
| C10 | Video shot list clicks/numbers exist, ≤3:00 (DEMO-SCRIPT) | Every quoted number exists on screen; a live 1-Click loop + reading steps exceeds 3:00 if LLM waits are shown | **PARTIAL** | Walkthrough |
| C11 | Test counts (README 80/80, 36/36; script 22/22) | Not runnable browser-only; docs cite three different suites/counts (README: 80/80 + 36/36; script: 22/22) | **NOT TESTABLE** (counts not obviously contradictory: different suites) | README §Verification; DEMO-SCRIPT |
| C12 | Real-time, zero polling (README/llms) | **Two live contexts:** change in A appeared in B in **23 ms** (observer) / 219 ms (100 ms poll); B counter 0→1, no reload | **REAL — verified both contexts** | Two-tab test |
| C13 | Auto-parses architectural specifications (README/llms) | Clean single-division spec ("SECTION 26 25 00 …") → **correct package** "Div 26 25 00 Enclosed Bus Assemblies", text-matching scope, $68,500. An ambiguous plumbing spec produced an **unrelated** Div 05 package with no warning | **PARTIAL** — real but not self-verifying | AI Spec Breakdown, 2 trials |
| C14 | Parses your proposals / Direct Quote-PDF ingestion (README/llms/UI) | Own text parsed; exclusions exact (+$35,950) and COI correct (+$15,000); **lead-time wrong** (17w over 12 → +$6,000, should be $30,000); true leveled $894,400 vs correct $918,400 | **PARTIAL** — breaks on the lead-time term | AUDIT6-3, own numbers |
| C15 | Upload your files, persist, re-open; labels say what they are (README) | Own PDF uploaded to Convex `_storage`, persisted, Preview/Download work; label follows the **manual** type dropdown (not auto-classified); storage URL is public-read | **PARTIAL** | File register; `audit6-a401-draft-sample.txt` sibling path |

**Extra absolute-word claims checked:**
- "**binding** addendum" — the generated addendum says "forms a legally binding part of the Contract Documents", but the app itself gates issue on PM certification and disclaims signature service. Fair use; expose who certified it. (Info)
- "**immutable** causal audit log" — event log is append-only in the UI with actor+timestamp; no delete/undo affordance observed. Holds. (REAL)
- "**verified** license" — only genuine on registry-sourced discovery rows; otherwise labeled unverified. Honest. (REAL)
- "**AIA Document A401**" — README calls it "AIA Document A401 Contract Generator", but the draft itself says "A401-STYLE … not an official AIA document or a licensed AIA form". UI is honest; README headline overstates. (PARTIAL/DOC-STALE)

---

## 4. Feature & screen value map

Classification: **REAL VALUE** (a GC does their job better) · **UNCLEAR** · **BLOAT** · **JARGON** · **THEATER** (impresses in demo, breaks in a real workday) · **MISSING**.

| Screen / feature | Class | Note |
|---|---|---|
| 6-stage stepper + live pipeline counts | **REAL VALUE** | Best single UX decision; per-stage real counts |
| Executive KPI band (compact + 6-card) | **REAL VALUE** | Basis labels are honest; numbers reconcile |
| CSI Scoping cards (budget, inclusions, inbox) | **REAL VALUE** | Includes shared-inbox honesty |
| AI Spec Breakdown (Auto-Scope) | **REAL VALUE, not self-verifying** | Correct on a clean spec; no echo of parsed divisions; one bad silent outcome |
| Direct Quote / PDF ingestion | **REAL VALUE (seeded) / UNCLEAR (BYO)** | Exclusions + COI exact; **lead-time term unreliable** |
| Bid-leveling cards (per-exclusion pricing) | **REAL VALUE** | Seeded math correct to the dollar |
| Spread Table View + CSV export | **REAL VALUE** | Backend-matching, escaped |
| Scope Clash engine | **REAL VALUE** | Prices double-buys/voids; project-scoped (demo $50,500/$46,500 ≠ custom $12,000/$18,500) |
| RFI → AI clarification → PM certify → Addendum | **REAL VALUE** | Spec-grounded; PM gate genuinely enforced; filed to storage |
| Live Activity Audit stream | **REAL VALUE** | Actor+timestamp causal log; honestly records failures ("0 of 1 delivered") |
| Deadline + Compliance crons (manual trigger) | **REAL VALUE** | Run and log honestly ("0 licensed, 0 deficiencies") |
| Convex `_storage` document register | **REAL VALUE** | Upload/persist/preview/download verified; public-read URL caveat (AUTH-READY) |
| Judge Dock (60s demo) | **THEATER (labeled)** | Fixed scenario figures; writes real records; confirmation guard present |
| Generated A401-style draft | **REAL VALUE (text) / THEATER (identity)** | Full 10-article structure, honest disclaimers; contact cross-contamination |
| Generated Addendum No. 01 | **REAL VALUE, with demo boilerplate** | Real storage artifact; Article-1 clauses can be generic |
| "Record Execution Status" (Contracts) | **THEATER / DEAD** | Click = no dialog, no toast, no state change (reproduced twice) |
| Evals & Architecture / Diagnostics | **REAL VALUE** | Genuinely re-runs live; per-case raw prompt/response; honest BYOK status |
| Discovery "Discover Trade Contractors" | **UNCLEAR** | Finds real vendors but also city offices/directories/blogs; name ≠ source |
| "Open source page" per contractor | **UNCLEAR** | No visible scrape/profile result on click |
| "Why GCs Care" panels | **BLOAT** | Duplicated explainer on every stage |
| Demo Tour teleprompter | **UNCLEAR** | Adds nav clutter; live-data driven |
| Diagnostics embed of `/llms.txt` | **DOC-STALE** | Panel text ≠ live endpoint |
| Invite-to-bid message content | **MISSING** | No preview/named contact/due date/reminders; real delivery fails |
| Subcontractor-facing view | **MISSING** | None exists; subs only receive email (which does not deliver here) |
| Notifications / assignees / revision history | **MISSING** | Table-stakes for teams |
| Per-project commercial terms (retainage/LD/insurance) | **MISSING** | Hardcoded 10% / $1,200/day |
| Jargon: "ADR-0003", "forensic", "holdout" | **JARGON** | Only ADR-0003 has a gloss (on the leveling header) |
| Public/shared-instance disclosure | **MISSING (AUTH-READY)** | No banner that data is world-visible |

---

## 5. Findings (A6-xx)

Severity: **Critical** = claim false/misleading or core flow broken with no workaround · **High** = real-usefulness blocker or judge-visible overclaim · **Medium** = friction/false-state/missing table-stakes · **Low** = polish · **Info** = observation. **AUTH-READY** observations top out at Medium (auth is explicitly out of scope).

### Credibility / core-engine

**A6-05r · Critical · BUG/CLAIM — The lead-time penalty is nondeterministic and does not follow the documented $6,000/week rate.**
Saw: README states the formula and example ("16 wks vs 12 wks target @ $6,000/wk → +$24,000"). Across runs and projects: 16w→+$24,000 (correct), **16w→$0 (On Track)** for near-identical text, **17w→+$6,000** (should be $30,000), **20w→+$24,000** (should be $48,000). Exact same quote text produced $0 on one ingest and +$24,000 on another; reload-stable in both states.
Repro: any project → Div 22/03 package → Ingest Quote → paste a proposal stating "N weeks from notice to proceed; target is 12 weeks".
Why it matters: Lead Time Penalty is one of four terms in `leveled = base + gaps + lead + COI − accepted VE`; an unstable/incorrect term silently under-collects delay exposure and can flip the ranking the product exists to compute.
Recommendation (lowest effort, highest impact): stop asking the model to output the penalty. Extract `leadWeeks` (already shown: "17 wks"), then compute `max(0, leadWeeks − targetWeeks) × 6000` deterministically in code, set decoding temperature 0, persist the extracted fields, and display the arithmetic (`17 − 12 = 5 × $6,000 = $30,000`) so a GC can audit it.

**A6-54 · Critical · BUG — Confirmed against MY OWN numbers: lead-time penalty wrong even when it fires.**
Saw (project AUDIT6-3, own): base $837,450; exclusions $18,600+$9,950+$7,400=+$35,950 (**correct**); COI +$15,000 (**correct**); lead "17 weeks… target 12 weeks" → **+$6,000**; leveled total $894,400. Correct total is $918,400.
Repro: as A6-05r.
Recommendation: as A6-05r. This is the #1 fix for the remaining time.

**A6-27 · High · CLAIM/UX — Discovery imports non-contractor pages and mislabels the entity vs its source.**
Saw (Div 26 & Div 23, reproduced): records included "Electrical Permits" → `portland.gov` city permits page; "Contractor Directory" → `ibew48.com/contractor-directory/`; "Vancouver & Portland HVAC Contractors" → `directmechanical.com`; "New HVAC Design / Build" → `heinz-mech.com/…-design-build-portland-or/` (a service/blog page); "Pacific Electrical Contractors LLC" and "Willamette Mechanical Systems Inc." both cited a different company's domain with the other company's email.
Repro: CSI Scoping → pick a trade → Discover Trade Contractors.
Why it matters: the architecture copy claims "Directory and aggregator pages are skipped." A GC acting on this list would email a permits office and a union directory.
Recommendation: filter results to records whose page is a company site matching the entity name; drop government/aggregator/blog URLs; require name/domain agreement; keep the honest "Unverified" label. Effort: medium, high impact on trust.

### Fabrication / honesty

**A6-29 · High · CLAIM — Real AgentMail RFQ delivery fails ("0 of N delivered") while the toast says "dispatched".**
Saw: "Invite to Bid" → toast "Invitation to bid dispatched via AgentMail"; row → "RFQ Invited". Audit log (ground truth): "AgentMail Delivery: 0 of 1 eligible recipient(s) … No email was delivered to tradepermits@portlandoregon.gov", then "0 of 2", then "0 of 1" to `leeann@aandj-electric.com` (a plausible address). Three attempts, zero deliveries.
Integrity positive: the audit stream **discloses the failure**; the toast is the misleading part.
Recommendation: make the toast reflect the delivery result ("Invitation queued — delivery failed, see audit"), and surface a clear "email delivery unavailable on this deployment" state on the package.

**A6-35 · Medium · BUG — A401 draft contact cross-contamination.**
Saw: draft for "Willamette Mechanical Systems Inc." lists `Contact: estimating@tdindustries.com` (a different company that appears in the eval corpus).
Recommendation: bind contact to the same contractor record as the name; never fall back to a corpus email.

**A6-51 / A6-37 · Info — Demo-vs-normal-path differences are mostly honest labeling.**
The Judge Dock scenario cards and 1-Click loop use **fixed demonstration figures** and are explicitly labeled ("fixed demonstration figures for repeatable walkthroughs; they write real records"). Normal Award & Draft derives the GC from the project record. Keep the warning visible; consider disabling 1-Click on custom projects.

### Dead / silent controls (A6-34, A6-42)

**A6-34 · Medium · UX/DEAD — "Record Execution Status" is a no-op.**
Saw: on Contracts, clicking it opened no dialog, showed no toast, and left the header at "Execution Status Recorded 0 / 1" and the row at "Pending Execution"; reproduced at two time points and after a full reload (then 0 / 2 with two contracts).
Recommendation: wire it to a status dialog (Executed date, signatory, doc upload) or remove the affordance.

**A6-42 · Medium · UX — Auto-Scope gives no confirmation of what it parsed.**
Saw: an unambiguous "SECTION 26 25 00" spec produced a correct Div 26 25 package; an ambiguous Div-22 spec produced an **unrelated Div 05 12 00 Structural Steel** package ($1,850,000) with no warning, and the input file was not the built-in sample either. No echo of parsed divisions, no undo.
Recommendation: after parse, show the detected divisions + scope items and require "Generate"; make the write reversible.

**A6-22 · Medium · UX/BUG — Ingest modal state/index fragility.**
Saw (multiple): the "Subcontractor / Bidder" control is free-text only when the package has zero registered contractors, a `<select>` otherwise, and a "Company Name" input appears only after choosing "+ Enter Custom / New Subcontractor Name". Field count varies 3↔4; scripted/fast fills land values in the wrong controls (company name into filename, filename into the quote body) → "Bid ingestion failed: Unsupported file type".
Recommendation: stable ids/labels; reset the form on package change; never reuse positional indices in the form logic.

### Claim/doc

**A6-38 · Low · CLAIM — Document type is manual, not "auto-classified".**
Saw: a CSI-spec PDF uploaded with the type dropdown left at default was labeled "BLUEPRINT"; re-uploading with the dropdown set to "CSI Specification PDF" labeled it SPEC. Copy says "Auto-classifies document types".
Recommendation: either classify by content (first-page text) or change the copy to "Choose a document type".

**A6-13 · Low · DOC-STALE — README/llms headline overstates A401 and discovery, and the clash figure is unqualified.**
Saw: README calls the generator "AIA Document A401 Contract Generator" (the artifact says "A401-STYLE … not an official AIA document"); README's "$38,500 redundant spend" is one VFD item while the demo's total double-buys is $50,500. Live `/llms.txt` is accurate; the Diagnostics panel embeds a stale copy.
Recommendation: align README wording ("A401-style draft"), qualify the $38,500 as the VFD item, and fetch `/llms.txt` live in the panel.

**A6-14 · Low · CLAIM — Retainage inconsistency.** A401/Contracts show 10%; audit-5/README reference 5%. Pick one and label it configurable.

### AUTH-READY observations (never defects)

**A6-18 · Info — No disclosure that the instance is public/shared.** Commercially sensitive data (prices, exclusions, insurance, contracts) is world-visible to anyone with the URL. Smallest honest mitigation: a persistent footer/banner: "Public shared demo — everything here is visible to anyone with this URL. Do not enter confidential or real bid data."

**A6-20 · Info — No identity, attribution, or isolation.** All projects appear in the selector to every visitor; any visitor can create/delete/dispatch/certify. Audit actors are system labels only ("Autonomous Procurement Engine", "AgentMail Subcontractor Dispatcher"), so two people cannot tell each other's actions apart.

**A6-21 · Info — UI implies ownership it cannot deliver.** Uploader/actor roles ("Chief Estimator / Project PM", "Project Manager") and an executive-titled execution dialog imply per-user accounts that do not exist.

**A6-43 · Info — Convex `_storage` files are public-read by URL.** `https://brainy-skunk-440.convex.cloud/api/storage/<id>` returned the addendum with HTTP 200 and no auth (verified via curl). Fine for a demo; scope storage to project/tenant before real use.

**A6-26 · Info — No user/team/role/invite surface exists.** Swept all buttons/links/text for invite|team|role|member|account|admin|setting → 0 matches. Consistent single-tenant demo scope.

### Quality / polish

**A6-30 · Info (positive) — The audit stream is a genuine causal log.** Actor + timestamp + causation for every step; honestly records failures and "Discovery returned no usable contractors."

**A6-53 · Info (positive) — Responsive + console clean.** No horizontal scroll at 375px or 720px (200% reflow); zero console errors/exceptions across load and all 8 tabs.

**A6-10 · Medium · JARGON — "ADR-0003", "forensic", "holdout".** Only ADR-0003 has a gloss. Replace in user-facing titles: "Leveling formula (ADR-0003): base + scope gaps + lead-time + COI − accepted VE credits".

**A6-07 · Medium · CLAIM — Upload says "Supports PDF, DWG, DXF, TXT" but the input `accept=".pdf,.dwg,.dxf"`.** Add `.txt` or fix the copy.

---

## 6. Top 10 fixes ranked by impact ÷ effort (≈2.5 days to judging)

| # | Fix | Screen | Impact | Effort | Why |
|---|---|---|---|---|---|
| 1 | Compute lead-time penalty deterministically: `max(0, leadWeeks−12)×6000`, temperature 0, show the arithmetic | Leveling ingest | **Critical** | S | Restores the core ADR-0003 claim; one code path, no model call |
| 2 | Show the parsed divisions/scope and require confirmation before Auto-Scope writes; make it undoable | CSI Scoping | High | S–M | Prevents a silently wrong package |
| 3 | Make the RFQ toast reflect the delivery result; show "delivery unavailable" honestly | Dispatch | High | S | Removes the "dispatched" vs "0 delivered" contradiction |
| 4 | Filter discovery to company pages whose name matches the domain; drop gov/aggregator/blog URLs | Discovery | High | M | Turns a misleading vendor list into a usable one |
| 5 | Wire "Record Execution Status" to a real dialog (date/signatory/upload) or remove it | Contracts | Medium | S | Dead control a judge will click |
| 6 | Bind A401 contact email to the same contractor record as the name | Contracts | Medium | S | Legal-identity correctness |
| 7 | Add the public-shared-demo banner | Header/footer | High | XS | The #1 adoption caveat, near-zero effort |
| 8 | Fix ingest-modal field stability (stable ids/labels; reset on package change) | Ingest modal | Medium | S | Removes silent mis-ingestion |
| 9 | Align copy: "A401-style", qualify $38,500 as the VFD item, fetch `/llms.txt` live | Docs + Diagnostics | Medium | XS–S | Removes stale claims a judge can catch |
| 10 | Default ingested VEs to **not accepted** with an explicit GC accept toggle; label document type as chosen-not-auto | Leveling + Files | Medium | S | Stops ranking distortion and a small claim overreach |

**Do-nothing list (cut rather than fix):** "Why GCs Care" panels (duplicated explainer), "Open source page" if it cannot be made to show a result, and the Diagnostics embed of a static `/llms.txt` (fetch live or drop).

**NEEDS-DECISION (not fixes):** per-project commercial-terms editor (retainage/LD/insurance); notifications + assignees; revision history for RFIs/bids; editable invite templates + reminders; a sub-facing bidder portal; scoping `_storage` to a tenant.

---

## 7. Protect list (do not regress)

- The 6-stage pipeline with live per-stage counts.
- **Per-exclusion and COI arithmetic** — verified exact to the dollar on seeded AND on my own non-round numbers.
- Two-context realtime: **23 ms** propagation, zero polling, no reload.
- The **live, re-runnable eval suite** with real tokens/latency/cost and inspectable raw prompts (holdouts have no total in the prompt).
- The **PM-certification gate** on the addendum and the honest refusal message.
- The **append-only audit stream** that discloses failures ("0 delivered", "no usable contractors").
- **Shared-inbox disclosure** and honest actor/delivery logging.
- The **executed-contract immutability** guard and honest void path.
- **Project-create and project-delete confirmation dialogs**; the Judge Dock's context-aware confirm.
- Responsive layout (0 overflow at 375 / 720) and a clean console.

---

## 8. Honesty section

**Could not test browser-only:**
- True external email send/receive at the provider (AgentMail) — I could only read the app's own delivery log, which reported 0 delivered. The *app-level* failure is observed; the *root cause* (key, inbox limit, sandbox) is not.
- Any test suite (`vitest` 80/80, Python 36/36, script 22/22), the QA scripts, or the build — counts are taken from docs and may be stale.
- Repo source beyond `README.md` and `docs/audits/*` read in-browser.
- Multi-user concurrency beyond two browser contexts.

**Verification methods used:** create → scope → discover → dispatch → ingest → level → award → contract → clash → RFI → addendum → export, all inside throwaway projects; every headline number re-checked after reload; two tagged trials for anything suspected flaky.

**Left behind:** **nothing but the demo project.** I created and deleted `AUDIT6-2 Riverside Water Reclamation Plant` and `AUDIT6-3 Cedar Ridge Booster Station`, plus one earlier first-pass project. Final Projects list verified = **"The Domain Tower B - Commercial MEP (Austin, TX)" only**. Demo state byte-identical before/after: 3 Pkgs / 4 Subs / 3 RFIs / 2 Bids / 4 Clashes / 1/3 Awarded, $4,250,000 / $3,918,500 / +$331,500 (7.8%) / +$186,000.

**Disclosed constraints respected as non-defects:** no auth, OpenAI BYOK with no key on this deployment, shared AgentMail inboxes, dark-only theme.

**Evidence artifacts saved under `outputs/`:** `audit6-eval-traces.json` (82 KB real traces), `audit6-evals-page.png`, `audit6-discovery-provenance.png`, `audit6-addendum-no-01.md`, `audit6-a401-draft-sample.txt`, `audit6-judgedock.png`, `audit6-mobile-375.png`, `audit6-delete-confirm.png`.

---

## 9. Checklist answers

- Verified every C1–C15 on screen incl. reload persistence? **Yes** (C11 not runnable; C13/C14/C15 verified PARTIAL with my own inputs).
- Read every audit record + index and produced the digest with ≥6 live spot-checks? **Yes** — 12 spot-checks.
- Ran the full GC cycle in my own project and deleted it? **Yes** (create → spec → packages → discover → RFI → addendum → level → clash → award → contracts; then delete).
- Ran the full BYO test — MY spec, MY numbers, MY documents — and gave the BYO verdict? **Yes.**
- Compared the demo headline numbers before and after? **Yes** — unchanged.
- Listed jargon with on-screen locations and plain alternatives? **Yes** (A6-10).
- Separated real work from theater with evidence? **Yes** (§4–§5).
- Auth/identity/isolation notes marked AUTH-READY, never defects? **Yes** (A6-18/20/21/26/43, Info).
- Final Projects list contains only "The Domain Tower B - Commercial MEP"? **Yes.**
- Reported what could not be tested browser-only instead of guessing? **Yes.**
