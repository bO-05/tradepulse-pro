# TradePulse Pro — Chief Estimator Ground-Truth Evaluation Scorecard

**Run ID**: `eval_1789352157433`  
**Standard**: ASPE / AGC / CPE Commercial Bid Leveling Guidelines  
**Timestamp**: `2026-09-14T02:16:42.774Z`  
**Backend Target**: `https://brainy-skunk-440.convex.cloud`  

---

## Executive Evaluation Summary

| Metric | Result | Target | Status |
| :--- | :--- | :--- | :--- |
| **Cases Passing Parity** | **10 / 10 (100%)** | 100% | **PASSED** |
| **Leveled Cost MAPE** | **0%** | $\le 0.50\%$ | **PASSED** |
| **Scope Exclusion Recall** | **100%** | $\ge 90.0\%$ | **PASSED** |
| **Scope Exclusion Precision** | **100%** | $\ge 90.0\%$ | **PASSED** |
| **Cross-Trade Double-Buy Recall** | **100.0%** ($50,500 redundant equipment) | 100% | **PASSED** |
| **Cross-Trade Scope Void Recall** | **100.0%** ($46,500 unallocated risk) | 100% | **PASSED** |
| **AIA Document A401 Conformity** | **100.0%** (Statutory Articles 1-6) | 100% | **PASSED** |

---

## Case-by-Case Forensic Audit Trail

| Case ID | Trade Package | Subcontractor Proposal | Expert Ground Truth | AI Leveled Output | Delta ($) | APE (%) | Scope Recall | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `case-26-01-austin-metro` | 26 00 00 | Alterman, Inc. | $1.286.000 | $1.286.000 | $0 | 0.00% | 100% | **PASS** |
| `case-26-02-lone-star` | 26 00 00 | Rosendin Electric, Inc. | $1.190.000 | $1.190.000 | $0 | 0.00% | 100% | **PASS** |
| `case-26-03-capital-grid` | 26 00 00 | Prism Electric, Inc. | $1.198.000 | $1.198.000 | $0 | 0.00% | 100% | **PASS** |
| `case-23-01-travis-county` | 23 00 00 | The Brandt Companies, LLC | $1.785.000 | $1.785.000 | $0 | 0.00% | 100% | **PASS** |
| `case-23-02-hill-country` | 23 00 00 | TDIndustries, Inc. | $1.820.000 | $1.820.000 | $0 | 0.00% | 100% | **PASS** |
| `case-23-03-austin-air` | 23 00 00 | Dynamic Systems, Inc. | $1.740.000 | $1.740.000 | $0 | 0.00% | 100% | **PASS** |
| `case-22-01-colorado-river` | 22 00 00 | Limbach Facility Services LLC | $908.500 | $908.500 | $0 | 0.00% | 100% | **PASS** |
| `case-22-02-apex-piping` | 22 00 00 | Clarke Kent Plumbing | $935.000 | $935.000 | $0 | 0.00% | 100% | **PASS** |
| `case-mep-01-double-buys` | MEP Cross-Trade | Cross-Trade Alignment Engine | $50.500 | $50.500 | $0 | 0.00% | 100% | **PASS** |
| `case-mep-02-scope-voids` | MEP Cross-Trade | Cross-Trade Alignment Engine | $46.500 | $46.500 | $0 | 0.00% | 100% | **PASS** |

---

## Verifiable Audit Trail
All raw LLM prompts, intermediate token extractions, RSMeans plug adders, schedule delay penalties, and contractual provisions are permanently archived in the `agentTraces` table and exported to `evals/results/latest_trace.json`.
