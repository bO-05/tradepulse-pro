# TradePulse Pro — Audit-6 Remediation (Pass 3)

**Live app:** https://brainy-skunk-440.convex.site · **Backend:** https://brainy-skunk-440.convex.cloud
**Repo:** github.com/bO-05/tradepulse-pro · **Date:** 2026-09-21 (UTC)
**Deployed code commit:** `f5613dd` (docs-only commits after it) · **Base:** `f502535` (AUDIT-5 green)
**Regression:** build clean · Python 36/36 · verify_setup green · vitest 113/113 · tsc 0 · verify:docs (40 links, log ordered) · verify:reports (7 reports offline) · smoke:live 7/7
**Convergence:** 25 rounds × 3 independent agents; rounds 24 and 25 clean (no Critical/High/Medium) — two consecutive clean rounds.

> Machine-readable companion to `audit-6-remediation.html`. Every after-fix value was observed on the
> live deployment through the real UI. The input audit is `audit-6-usefulness.md`/`.html`.
> Raw evidence lives only in the local working tree; re-derive claims from the live app.

---

## 1 · Executive verdict

| | Before (AUDIT-6) | After |
|---|---|---|
| **Demo** | PARTLY — leveling arithmetic exact, but trust surfaces carried fabricated/overstated claims | **YES** — all headline numbers reconcile; core claim deterministic; execution control proven wired; copy/doc truth; three stale seeded artifacts disclosed (left untouched for byte-stability) |
| **BYO** | PARTLY — a GC could not trust their own leveled number (lead-time term model-computed; pricing/contacts could be fabricated) | **YES** — every ADR-0003 term is code-computed from the raw text and persisted; identical input twice is byte-identical live; own spec/numbers/documents proven end to end; email delivery dead on this deployment and stated honestly |

**Core-claim fix (A6-05r / A6-54).** Penalty = `max(0, weeks − baseline) × $6,000`, computed in code; baseline pinned per division (Div 26: 12 wks; Div 22/23: 16 wks), persisted per bid as `leadTimeTargetWeeks`, and rendered as arithmetic (e.g. `Lead Time (17 wks vs 16-wk baseline): (17 − 16) × $6,000 = +$6,000`). The model no longer returns a dollar penalty. AUDIT-6's "nondeterministic" behavior did **not** re-reproduce in 8 controlled live ingests; the reproduced defect was structural (model computing money, no visible baseline) and is fixed. On a 12-week-baseline division the engine reproduces the audit's own expected total exactly: base $837,450 + stated exclusions $35,950 + lead $30,000 + COI $15,000 = **$918,400**.

---

## 2 · Verification table — every AUDIT-6 finding

| ID | Sev | Repro (our live attempt) | Root cause (before) | Fix | Verified after |
|---|---|---|---|---|---|
| A6-05r | CRIT | STRUCTURAL; nondeterminism not re-reproduced | `sanitizeBidLevelingOutput` trusted `parsedJson.leadTimePenalty`; prompt asked for arithmetic; no target persisted | `terms.targetWeeksForDivision`; sanitize computes via `leadTimePenaltyFor`; prompt asks only for integer weeks; temp 0 on OpenAI/Gemini (Anthropic rejects the parameter — code-enforced); `insertParsedBid` recomputes; UI arithmetic | a7-05/a7-05b + every round: Div22 17→$6,000 @16 twice identical; Div26 16→$24,000 @12; 113 tests |
| A6-54 | CRIT | REPRODUCED (rule-visibility corrected) | same producer defect; docs implied a universal 12-wk target | same + README qualification; Div-03 live run yields $918,400 exact | a7-07 |
| A6-27 | HIGH | REPRODUCED (oregon.gov, portland.gov, ibew48 directory imported) | discovery filtered only a small directory list; no gov/blog checks; no name↔domain agreement | gov/union host + non-company path + SEO-title rejection; `nameMatchesDomain` | a7-02 before vs a7-06 after ("no usable contractors"); 7 unit tests on the exact audited URLs |
| A6-29 | HIGH | REPRODUCED (toast "dispatched" vs audit 0 of 1) | unconditional success toast; audit logged transmission pre-attempt | toast renders real result; audit separates prepared vs delivered; package card shows "0 of N"; no sends forced | a7-05b + rounds |
| A6-42 | MED | REPRODUCED (single click wrote unrelated Div 05) | direct write on submit | preview → echo divisions/scope → explicit Generate; Re-parse | a7-06; rounds |
| A6-34 | MED | UNREPRODUCED — row button opened `role=alertdialog` "Record external execution?" on first click | none found; control is wired | no code change | a7-03 |
| A6-35 | MED | REPRODUCED (Willamette → tdindustries contact + OR-LIC-VERIFIED) | name-keyword→corpus contact map in client + server; fabricated badge | honest unpublished/unverified record; A401 "contact not published" line; license fallbacks honest | a7-07; draft/record verified |
| A6-22 | MED | REPRODUCED (structural) | controls had no stable ids | stable ids/names + aria-label on every control | a7-05 + R2B fast-fill isolation |
| A6-18 | INFO | REPRODUCED | no banner | persistent public-demo banner (only auth-adjacent change) | all tabs at 375/720/1440 each round |
| A6-38 | LOW | REPRODUCED | copy claimed auto-classification | copy states the selected type (drag & drop infers from filename) | R2B+ |
| A6-13 | LOW | REPRODUCED | A401-claim wording; unqualified $38,500; stale llms embed | A401-style wording; $38,500 = VFD item within $50,500; panel fetches live `/llms.txt` | panel byte-equal to live endpoint |
| A6-14 | LOW | REPRODUCED (log said 5%) | docs prose only; terms.ts 10% is canonical | log corrected to 10% | doc scans |
| A6-10 | MED | PARTIAL | jargon in titles | plain titles; holdout explanation present | UI scans |
| A6-07 | MED | REPRODUCED | default blueprint accept lacked `.txt` | `.txt` added; copy honest | R2B |
| A6-51/#10 | MED | REPRODUCED | sanitize copied model `isAccepted`/`isWaived` | ingested VE never accepted; ingested exclusions never waived; severity from final impact; GC toggles | a7-05; R24/R25 determinism |

---

## 3 · New findings discovered by this pass (all fixed unless marked)

Convergence rounds found defects in the same classes; every Critical/High/Medium was fixed and re-verified.

| Round(s) | Sev | Finding | Status |
|---|---|---|---|
| 1 | HIGH | fallback paired an INCLUDED scope keyword with any "excluded" → phantom $12,000 exclusion | fixed |
| 1 | MED | silent provider fallback mislabeled as OpenAI | fixed (audit records real model path) |
| 1 | LOW | CSV float artifact `20722.869999999995` | fixed (rounded) |
| 6 | HIGH/MED | compound "3 months and 2 weeks" → 2 wks; "(18) weeks" ignored | fixed (compound + parens + 4.33/mo) |
| 6/18 | MED | subrogation missed; then unrelated "subrogation included" cleared an umbrella exclusion | fixed (source-classified COI; $15,000 clamp) |
| 8 | MED | percentage-priced exclusion silently converted to dollars | fixed (benchmark + disclosure) |
| 9–13 | HIGH/MED | dollar cap overridden; core-drill priced as firestop; negative credit sign lost; word amounts ignored; base/retainage/insurance bound as exclusions; quoted base rebound; word-amount scope swap | fixed (position/head-scope/context rules, credits excluded, word parser) |
| 15–16 | MED | model dropped a stated scope gap; net over-added on modifier keywords; COI phrasing missed | fixed (deterministic gap net, head-scope only, negation/as-specified) |
| **19** | **HIGH** | GC "Save Leveling Adjustments" failed for any engine-ingested bid (public validator omitted `canonicalCode`; generic error) | fixed; regression test + live accept/decline/waive |
| 20 | MED | scope signatures collapsed into BACNET → double-priced TAB/BOOSTER | fixed (first-named scope wins) |
| **23** | **HIGH** | model-supplied `isWaived` persisted → identical text produced waived ($892,000) vs active ($953,250) rows | fixed (waiver is GC-only); 8 live repeats byte-identical |
| 22–25 | LOW | COI rule misses "statutory workers' compensation and employers liability coverage only"; model rephrases exclusion descriptions (numbers byte-identical) | carried (non-blocking, documented) |

---

## 4 · Decisions (explicit)

- **D1 — Lead-time baseline:** **GC-owned division milestones** (12 wks Div 26/other, 16 wks Div 22/23) in `convex/terms.ts`, persisted per bid and rendered with the arithmetic. Proposal-stated targets are not trusted (bidder-controlled); a per-package target field editable by the GC is the recommended future enhancement. GC can override any penalty in "Adjust Leveling".
- **D2 — Judge Dock on custom projects:** kept as labeled theater with fixed demonstration figures; the normal Award path derives the GC from the project record.
- **D3 — Retainage/LD:** 10% / $1,200-day stay canonical in `convex/terms.ts`; docs prose fixed only.
- **D4 — VE/waive defaults:** ingested VE = not accepted; ingested exclusions = not waived; both GC-controlled toggles (save path repaired). **Add-alternates are unrepresentable** (schema models deduct credits only) — recorded with 0 impact; a `costAdd` field is a recommended follow-up.
- **D5 — Demo carry-overs:** three stale seeded artifacts (agreement text, license labels, historical audit rows) were **not rewritten** under the byte-stability rule; seed code fixed for future re-seeds; one-command refresh is `projects.seedInitialData({force:true})`.

---

## 5 · BYO truth proof (own company, own numbers, own documents)

- **Own spec:** uploaded `.txt` spec persisted in Convex `_storage`; Auto-Scope previewed Div 22 ($385k) + Div 05 ($65k) and wrote nothing until "Generate 2 Trade Packages"; Re-parse left counts unchanged.
- **Own numbers:** base $837,450; stated exclusions $18,600 + $9,950 + $7,400 = $35,950 exact; lead 17 wks → target 12 → $30,000; COI $15,000; VE $35,000 declined; **leveled $918,400 exact**. Identical input twice → byte-identical persisted projection; arithmetic rendered.
- **Own documents:** upload → storage id + text, persists across reload; honest type label; preview/download available.
- **Own contract:** award generated an A401-style draft under the GC's own name, the contractor's own contact (or honest "not published"), sum $918,400, 10% retainage, no official-AIA claim.
- **Cleanup:** fixture deleted; only the demo project remains; demo headline numbers unchanged.
- **Verdict: YES** for own numbers/documents/contract, with the disclosed deployment limits (email delivery unavailable; no auth/isolation; add-alternates not modeled).

---

## 6 · Regression (exact commands)

```
npm run build                 -> built
python tests/test_tradepulse.py  -> ALL 36 PASSED
python tests/verify_setup.py     -> ALL VERIFICATION TESTS PASSED
npx vitest run                -> 7 files, 113 tests passed
npx tsc -b                    -> exit 0
npm run verify:docs           -> 40 links resolve; hackathon log in order (27 entries)
npm run verify:reports        -> 7 audit reports render offline, 0 broken images
npm run smoke:live            -> 7/7 checks passed (self-cleaning fixture)
```

Demo re-checked every round: Budget $4,250,000 · Leveled Buyout $3,918,500 · Variance +$331,500 (7.8%) · Gaps +$186,000 · 1/3 awarded · 3 Pkgs / 4 Subs / 3 RFIs / 2 Bids / 4 Clashes · backend 13 contractors / 6 bids / 1 agreement.

---

## 7 · Convergence log

25 rounds of three independent agents (verification/oracle, adversarial, claims/docs/a11y), each driving the real UI with throwaway fixtures. Blocking = Critical/High/Medium.

| Rounds | Findings (blocking) | Action |
|---|---|---|
| 1–2 | phantom exclusion, provider label, CSV float, compound sentence | fixed |
| 3–5 | VE-as-exclusion, negative base, addendum server gate, model-week-0, next-line amounts | fixed |
| 6–9 | compound/parenthesized leads, subrogation, space amounts, percentage pricing, model codes | fixed |
| 10–13 | core/firestop collision, credit sign loss, word amounts, base/retainage binding, quoted base, COI class clearing | fixed |
| 14–16 | COI arbitrary penalty, dropped scope gap, net over-add, negation | fixed |
| 17 | none blocking | clean |
| 18–21 | COI affirmative class, adjustments validator (HIGH), signature double-price, plural statutory | fixed |
| 22 | none blocking | clean |
| 23 | model `isWaived` nondeterminism (HIGH) | fixed |
| **24** | none blocking | **clean** |
| **25** | none blocking; source unchanged since round 24 | **clean → two consecutive** |

What each round verified: independent oracle vs persisted values, determinism (identical text twice → byte-identical numeric projection), ranking + deceptive flag, CSV cell-for-cell, UI arithmetic, adjustment save/waive, RFQ truth, addendum gate, insurance never a base, responsive/a11y/console, doc/claim truth, demo byte-stability and only-demo cleanup.

---

## 8 · Honesty

- **Could not be tested:** true external AgentMail send/receive (app-level 0 delivered on every attempt; root cause provider-side and unchanged — no secrets read or set); multi-user concurrency beyond two contexts; auth/identity/isolation (out of scope).
- **Anthropic temperature:** this model rejects the deprecated parameter (HTTP 400); sending it silently killed the live model path once. Determinism is code-enforced and proven by repeated live ingests, not decoding settings.
- **Carried LOWs:** one plural statutory-workers-compensation COI phrasing the text rule misses (model usually catches it); cosmetic model wording drift in exclusion descriptions with byte-identical numbers.
- **Demo carry-overs (not rewritten):** stale seeded agreement text, seeded "Active / Verified" license labels, historical seeded audit rows; seed code corrected for future re-seeds.
- **Fixtures:** all `AUDIT7-*` (and the harness's `AUDIT-QA-SMOKE-*`) deleted; one accidental probe contractor was removed in-round with the demo counts re-verified. Final Projects list = only "The Domain Tower B - Commercial MEP".
- **Deployment:** fixes were deployed to the production Convex deployment (schema/functions + static hosting) because the mission required live-app verification; no environment variables or keys were changed.

---

## 9 · For the next auditor (browser-only re-verification guide)

**What you can see.** Public app (no login) `https://brainy-skunk-440.convex.site` · `GET /api/health` · `GET /llms.txt` · backend `https://brainy-skunk-440.convex.cloud` · public repo `github.com/bO-05/tradepulse-pro`. Deployed code equals `f5613dd`; docs changed only after it. Raw evidence is local-only — re-derive every claim from the live app.

**The rule the engine must follow (verify it yourself).** Lead penalty = `max(0, weeks − baseline) × $6,000`; baseline **12 wks** Div 26/others, **16 wks** Div 22/23; target persisted per bid (`leadTimeTargetWeeks`) and rendered with the arithmetic. Stated exclusion dollar amounts bind verbatim; unpriced scopes take the documented benchmark (Div 22/26 crane 25,000/45,000; Div 23 crane 48,000; firestop 22,000; seismic 55,000; core 16,000; backflow 8,500; booster 12,000; TAB 28,000; BACnet 18,000; vibration 14,000; overtime 25,000; default 15,000). COI deficiency is exactly **$15,000** only when the text withholds coverage; ingested VE alternates default to not accepted and ingested exclusions to not waived.

**10-minute BYO repro.** Create a project → Div 22 (or 26) package → add one contractor → "Ingest Quote / PDF" with a proposal stating a base price, two exclusions with explicit dollar amounts, `lead time N weeks`, and umbrella wording. Expected: stated amounts exactly, `<n> vs <baseline>-wk baseline` with `(N − baseline) × $6,000` rendered, COI $0 or $15,000 per wording, leveled = base + exclusions + lead + COI. Re-ingest the identical text and compare the persisted numeric projection (must be byte-identical). Cross-check Spread Table View and CSV. Delete your project when done.

**Honest expectations (do not re-file).** RFQ email delivery reports **0 of N delivered** on this deployment (toast + audit + package card agree; nothing faked). The addendum refuses with fewer than one PM-certified RFI. No auth/tenant isolation (out of scope; public-demo banner states it). Three stale seeded demo artifacts remain (agreement text, license labels, historical audit rows). Add-alternates are not modeled. Two LOWs carried (one COI phrase; description wording drift).

**Artifact map.** `audit-6-usefulness.md`/`.html` = the audit being remediated; `audit-6-remediation.md` = this report (best for agent reading); `audit-6-remediation.html` = self-contained visual report; `DEMO-SCRIPT.md` = demo shot list; `scripts/qa/` = curated live harness; `scripts/audit7/` = audit-6 repro harness (curated scripts; raw convergence rounds remain in git history).