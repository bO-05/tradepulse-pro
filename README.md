# TradePulse Pro ⚡

> **Autonomous CSI MasterFormat Subcontractor Procurement, Dynamic Pre-Bid Q&A & Real-Time Bid Leveling for Commercial Construction**

[![Convex All Gas Hackathon](https://img.shields.io/badge/Convex-All%20Gas%20Hackathon-f59e0b?style=for-the-badge&logo=convex)](https://vibeapps.dev/judging/convex-all-gas-hackathon-openai)
[![Live Demo](https://img.shields.io/badge/Live%20Demo-brainy--skunk--440.convex.site-10b981?style=for-the-badge)](https://brainy-skunk-440.convex.site)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.0-61dafb?style=for-the-badge&logo=react)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.1-38bdf8?style=for-the-badge&logo=tailwindcss)](https://tailwindcss.com/)

---

## 🌐 Live Access & Deployment

| Resource | URL |
| :--- | :--- |
| **Official Web Application** | **[https://brainy-skunk-440.convex.site](https://brainy-skunk-440.convex.site)** |
| **LLMs Discoverability Manifest** | **[https://brainy-skunk-440.convex.site/llms.txt](https://brainy-skunk-440.convex.site/llms.txt)** |
| **Convex Cloud Production Backend** | **[https://brainy-skunk-440.convex.cloud](https://brainy-skunk-440.convex.cloud)** |
| **AgentMail Live Webhook Endpoint** | **[https://brainy-skunk-440.convex.site/agentmail/webhook](https://brainy-skunk-440.convex.site/agentmail/webhook)** |

---

## 🎯 The Problem: The $186,000 Scope Exclusion Trap

In commercial construction (hospitals, labs, towers), General Contractors (GCs) solicit bids from trade subcontractors (Electrical, HVAC, Plumbing). Subcontractors frequently submit **deceptive low bids** on paper ($1,100,000 vs $1,225,000), but hide critical exclusions in fine print:
- Excluded crane hoisting to penthouse mechanical rooms (+$45,000 GC cost)
- Excluded UL 1479 rated firestop penetrations (+$22,000 GC cost)
- Excluded seismic engineered structural bracing (+$55,000 GC cost)
- Non-compliant Certificate of Insurance ($1M limit vs required $5M, +$15,000 penalty)
- 16-week long-lead equipment delays (+$24,000 schedule delay impact)

When GCs award purely based on base price, they suffer **six-figure change orders** and schedule blowouts. Furthermore, trades frequently **double-buy equipment** (e.g. both Division 26 Electrical and Division 23 HVAC bidding Variable Frequency Drives, causing $38,500 in redundant spend) or leave **scope voids** (e.g. low-voltage control wiring excluded by both).

---

## ⚡ Solution: TradePulse Pro

TradePulse Pro automates the entire MEP subcontractor buyout lifecycle end-to-end:
1. **CSI MasterFormat Scoping**: Auto-parses architectural specifications into Division 26 (Electrical), Division 23 (HVAC), and Division 22 (Plumbing) packages with dedicated `@agentmail.to` inboxes.
2. **Autonomous Subcontractor Discovery (Firecrawl)**: Crawls Texas licensing registries (TDLR) and regional contractor sites, extracting active master licenses and safety ratings into Convex.
3. **Dynamic Pre-Bid Q&A (AgentMail & OpenAI)**: Ingests subcontractor email RFIs via AgentMail with cryptographic Svix verification, answers technical questions against the spec, and compiles binding **CSI Addendum No. 01** documents stored in Convex File Storage (`_storage`).
4. **Forensic Bid Leveling Engine (ADR-0003)**: Automatically parses proposals, normalizes hidden exclusions, calculates liquidated damages and COI penalties, and accounts for Value Engineering (VE) alternates.
5. **Cross-Trade Scope Clash Engine**: Detects Double-Buys and Scope Voids between electrical and mechanical trades with 1-click buyout deductions.
6. **AIA Document A401 Contract Generator**: Instantly produces standard 10-article AIA subcontracts with financial attestations, retainage terms, and liquidated damages.

---

## 🏛️ Architecture & Sponsor Synergy Matrix

TradePulse Pro deeply integrates all 4 hackathon sponsors:

```mermaid
graph TD
    A[CSI 3-Part MasterFormat Specs] -->|AI Spec Breakdown| B(Convex Trade Packages)
    B -->|Firecrawl Web Crawler| C[Licensed Contractor Directory]
    B -->|AgentMail API| D[Dedicated Package Inboxes]
    C -->|Outbound RFQ Invites| D
    D -->|Svix Cryptographic Webhook| E[Convex HTTP Router]
    E -->|Pre-Bid Inquiries| F[OpenAI Pre-Bid RFI Engine]
    F -->|Binding Addenda| G[Convex File Storage _storage]
    E -->|Quote Proposals| H[ADR-0003 Bid Leveling Engine]
    H -->|AIA A401 Generator| I[Standard Subcontract Agreements]
    H -->|Cross-Trade Clash Detection| J[Double-Buy & Scope Void Resolver]
```

### 1. Convex (All-Gas Full-Stack Reactive Backend)
* **Real-time WebSockets**: Zero-polling reactive UI updates across all bidders, RFIs, leveling matrices, and audit streams (`useQuery`, `useMutation`).
* **Convex Crons (`convex/crons.ts`)**: Scheduled hourly bid deadline sweeps (`monitor-bid-deadlines`) and 6-hour contractor compliance audits (`audit-contractor-compliance`).
* **Convex File Storage (`_storage`, `convex/files.ts`)**: Secure persistence for CSI specs, BIM drawing PDFs, ACORD 25 COIs, and generated Addenda.
* **Official Static Hosting (`@convex-dev/static-hosting`)**: Unified single-command deployment with production SPA fallback and Wayne Sutton `/llms.txt` discoverability.

### 2. OpenAI & Multi-Model Pipeline (`convex/llmRouter.ts`)
* **GPT-4o Spec Scoping & Pre-Bid RFI Analysis**: Technical inquiry extraction against Division 26/23 specifications.
* **Structured Bid Parsing**: Extracts line items, quantities, unit prices, exclusions, and VE alternates.
* **Multi-Model Support**: Integrated with OpenAI GPT-4o, Google Vertex AI REST, Anthropic Claude, and deterministic offline construction intelligence fallback.

### 3. Firecrawl (`@firecrawl/firecrawl-convex`, `convex/contractorDiscovery.ts`)
* **Subcontractor Web Discovery**: Autonomous discovery of MEP specialty contractors by location and trade division.
* **Website Scraping & Licensing Verification**: Scrapes Texas TDLR licensing registries and contractor domains to verify active master licenses, OSHA ratings, and union status.

### 4. AgentMail (`@agentmail/convex`, `convex/emailActions.ts`, `convex/http.ts`)
* **Dedicated Stateful Inboxes**: Auto-provisions `@agentmail.to` inboxes per CSI trade package (Div 26 Electrical, Div 23 HVAC, Div 22 Plumbing).
* **Cryptographic Svix Verification**: Validates `svix-id`, `svix-timestamp`, and `svix-signature` on inbound emails at `/agentmail/webhook`.
* **Two-Way Communication**: Transmits outbound invitations to bid and ingests inbound contractor RFIs and quote proposals directly into the Convex pipeline.

---

## 📊 The ADR-0003 Normalization Formula

$$\text{Leveled Total Cost} = \text{Base Bid} + \sum(\text{Active Exclusions}) + \text{Lead Time Penalty} + \text{COI Deficiency Penalty} - \sum(\text{Accepted VE Alternates})$$

### The Alterman vs. Rosendin Electric Case Study:
* **Alterman, Inc.**:
  * Base Bid: $\$1,100,000$ *(Looks like the lowest bidder!)*
  * Crane Hoisting Excluded: $+\$45,000$
  * UL 1479 Firestopping Excluded: $+\$22,000$
  * Seismic Bracing Excluded: $+\$55,000$
  * Schedule Lead Time Penalty (16 wks vs 12 wks target @ \$6,000/wk): $+\$24,000$
  * COI Penalty (\$1M policy vs \$5M required): $+\$15,000$
  * **Normalized Leveled Cost: $\$1,286,000$**
* **Rosendin Electric, Inc.**:
  * Base Bid: $\$1,225,000$
  * Exclusions: $\$0$ *(All mandatory inclusions covered)*
  * VE Alternate 01 (Aluminum MC feeder cable): $-\$35,000$ *(Optional GC savings)*
  * **Normalized Leveled Cost: $\$1,225,000$ (or $\$1,190,000$ with VE accepted)**
* **Financial Decision**: Awarding Rosendin Electric saves the GC **$\$61,000$ to $\$96,000$** and prevents catastrophic site delays.

---

## ⚡ 60-Second Judge Evaluation Walkthrough

Want to experience the complete platform in 60 seconds?
1. Open the live deployment: **[https://brainy-skunk-440.convex.site](https://brainy-skunk-440.convex.site)**.
2. In the top navigation bar, click the glowing **⚡ 60s Judge Dock** button.
3. Click **"Run Full Autonomous Procurement Cycle"**:
   * Watch the live Activity Audit Stream log every step in real-time.
   * Scopes Division 26 Electrical, 23 HVAC, and 22 Plumbing.
   * Discovers contractors and provisions AgentMail inboxes.
   * Clarifies RFIs and generates binding CSI Addendum No. 01.
   * Compares bids in the ADR-0003 Side-by-Side Leveling Matrix.
   * Awards Rosendin Electric and generates an authentic **AIA Document A401 Subcontract Agreement**.
4. Click **Scope Clash Engine**: Review cross-trade coordination catching the **$38,500 VFD Double-Buy** and click **"Deduct Credit"**.

---

## 🛠️ Local Development & Testing

### Prerequisites
* Node.js v20+
* Python 3.10+ (for verification test suites)

### Setup
```bash
# Clone the repository
git clone https://github.com/bO-05/tradepulse-pro.git
cd tradepulse-pro

# Install dependencies
npm install

# Run frontend development server
npm run dev
# -> http://localhost:5173/

# Run Convex local backend
npx convex dev
```

### Verification & Testing
```bash
# Run 27 domain, sponsor, and architecture deliverable tests
python tests/test_tradepulse.py

# Run hackathon setup and log verification tests
python tests/verify_setup.py

# Run TypeScript & Vite production build
npm run build
```

---

## 📄 License
MIT License. Built for the Convex All Gas Hackathon 2026.
