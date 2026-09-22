# Quality harness (`scripts/qa/`)

Portable, judge-runnable verification for the TradePulse Pro deployment. Everything here
works from a fresh clone on Windows or macOS/Linux — no absolute paths, no secrets.

## Requirements

- `npm ci` first (`puppeteer-core` ships in devDependencies)
- Node.js 18+
- Chrome or Edge installed (auto-detected; override with `QA_CHROME_PATH`)
- Network access to the live deployment (or a local `npx convex dev` deployment)

## Scripts

| Script | What it does |
|---|---|
| `live-smoke.mjs` | Creates one `AUDIT-QA-SMOKE-*` project on the backend and asserts the remediation guarantees end-to-end: RFI persisted before AI analysis, cross-trade credit evidence gate + idempotency + reversal, executed-subcontract immutability, audited void path. Deletes everything it created and exits non-zero on any failure. |
| `render-audit-reports.mjs` | Opens every report in `docs/audits/` in headless Chrome (offline `file://`) and fails if any image is broken or any page error occurs. Proves judges can double-click the reports. |
| `record-demo.mjs` | Records the live app from a clean browser profile using the Chrome DevTools Protocol screencast, while you (or an agent) drive the demo in the opened window. Captures frames on change with timestamps and muxes them at real display durations (static screens hold), then cleans up. See "Recording the demo" below. |
| `lib.mjs` | Shared helpers (portable repo root, browser launch, diagnostics, screenshots, input helpers). |

## Usage

```bash
# Full guarantee smoke against the live deployment
node scripts/qa/live-smoke.mjs

# Against a local Convex dev deployment
QA_BACKEND_URL=http://127.0.0.1:3210 node scripts/qa/live-smoke.mjs

# Prove the curated audit reports render offline
node scripts/qa/render-audit-reports.mjs
```

Environment overrides: `QA_BACKEND_URL`, `REM_BASE_URL` (site), `REM_EVIDENCE_DIR`
(screenshot output, default `evidence/`), `QA_CHROME_PATH`, `QA_REPO_ROOT`.

## Report/evidence tooling (`scripts/tools/`)

- `check-docs-links.mjs` — fails on any broken relative link in shipped docs (`node scripts/tools/check-docs-links.mjs docs README.md`).
- `compress-report-images.ps1` (Windows PowerShell, optional) — shrinks self-contained audit HTMLs (embedded PNG → resized JPEG) and standalone screenshot folders for repo-friendly reports.
- `reorder-hackathon-log.mjs` — keeps `hackathon.md` strictly chronological (oldest first, newest appended last, per the project log-format reference); run with `--check` in CI/verification.

## Recording the demo

`record-demo.mjs` turns the deployment into a screen recording without extra tooling beyond
`puppeteer-core` (already a devDependency) and `ffmpeg` (mux step; if missing it prints the exact
command). It launches Chrome/Edge with a fresh profile at 1920×1080, starts a CDP screencast, and
keeps recording while you drive:

```bash
# Interactive: drive the demo yourself, press Enter to stop
node scripts/qa/record-demo.mjs

# Automated: record a fixed window (useful for agents)
node scripts/qa/record-demo.mjs --duration 30

# Headless / custom target
node scripts/qa/record-demo.mjs --headless --duration 20 --url http://127.0.0.1:5173
```

Output lands in `evidence/demo-recordings/<timestamp>/demo-<timestamp>.mp4`; temporary frames and
the browser profile are removed after a successful mux (`--keep-frames` to retain). Static screens
are captured once and held at their real duration, so the video keeps true pacing. There is no
audio track — add the voiceover from [`docs/audits/DEMO-SCRIPT-VOICEOVER.md`](../../docs/audits/DEMO-SCRIPT-VOICEOVER.md)
in an editor, or record narration separately.

Notes for recorder agents: the demo project is shared and must stay byte-stable — record read-only
beats on it, run the Judge Dock / award beats on a throwaway `AUDIT-*` project and delete it
afterwards; discovery is strictly filtered and may legitimately return "no usable contractors".
Full guidance (pre-flight, beat sheet, honesty lines) is in the voiceover script.

## Fixture policy

Any live check must create fixtures named `AUDIT-*` and delete them before finishing. The
seeded demo project (`The Domain Tower B - Commercial MEP`) is shared and is never modified.