// QA-12 follow-up precise probe:
//  1. Tour behavior on a truly fresh context (QA-10 claim: tour opens on first visit).
//  2. Contracts row-level status badge after execution (filter labels are ambiguous).
//  3. Leveling DOM: enabled "Adjust Leveling" vs disabled "Leveling Locked" counts.
//  4. SPA bundle asset fetch status.
// Usage: node scripts/qa-rem/qa12-followup.mjs
import {
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  delay,
  BASE_URL,
  writeLog,
  getSelectorState,
  selectProjectByTitle,
} from "./qa1-lib.mjs";
import fs from "node:fs";
import path from "node:path";

const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const fixture = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa12-fixture.json"), "utf8"));

const LOG = [];
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};
const J = (o, max = 600) => {
  const s = JSON.stringify(o);
  return s.length > max ? s.slice(0, max) + "…" : s;
};

async function clickTab(page, label) {
  return page.evaluate((label) => {
    const header = document.querySelector("header");
    if (!header) return { ok: false, reason: "no header" };
    const btns = [...header.querySelectorAll("button")];
    const match = btns.find((b) => {
      const title = b.getAttribute("title") || "";
      if (title.includes(label)) return true;
      const spans = [...b.querySelectorAll("span")];
      return spans.length <= 3 && spans.some((s) => (s.textContent || "").trim() === label);
    });
    if (!match) return { ok: false, reason: "tab button not found" };
    match.scrollIntoView({ block: "center" });
    match.click();
    return { ok: true, text: (match.textContent || "").trim().slice(0, 60) };
  }, label);
}

async function run() {
  const { browser } = await launchBrowser();
  const summary = { at: new Date().toISOString() };
  try {
    ev("=== QA-12 FOLLOW-UP PRECISE PROBE ===");
    ev(`UTC: ${new Date().toISOString()}`);
    ev("");

    // ---- 1. Tour on truly fresh context ----
    const ctx1 = await browser.createBrowserContext();
    const p1 = await ctx1.newPage();
    p1.setDefaultTimeout(30000);
    await p1.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(p1);
    const tourChecks = [];
    for (const waitMs of [0, 3000, 5000, 8000]) {
      if (waitMs > 0) await delay(waitMs);
      const state = await p1.evaluate(() => {
        const closeBtn = document.querySelector('button[title="Close Teleprompter"]');
        const expandBtn = document.querySelector('button[title="Expand Investor Demo Teleprompter"]');
        const hasText = document.body.innerText.includes("Investor Demo Teleprompter");
        const bodyHasTour = /Teleprompter|Investor Demo Tour/i.test(document.body.innerText);
        return {
          closeBtn: Boolean(closeBtn),
          expandBtn: Boolean(expandBtn),
          hasText,
          bodyHasTour,
          lsTour: localStorage.getItem("tradepulse.tourDismissed"),
        };
      });
      tourChecks.push({ afterMs: waitMs, ...state });
      ev(`tour check +${waitMs}ms: ${J(state)}`);
    }
    await shot(p1, "remediation-qa12-11-tour-fresh-context.png");
    summary.tour = tourChecks;
    await ctx1.close();

    // ---- 2/3/4. Contracts + leveling on fixture ----
    const ctx2 = await browser.createBrowserContext();
    const p2 = await ctx2.newPage();
    p2.setDefaultTimeout(30000);
    const d2 = attachDiagnostics(p2);
    await p2.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(p2);
    await delay(1500);
    await selectProjectByTitle(p2, fixture.tag);
    await delay(2800);
    const selState = await getSelectorState(p2);
    ev(`selected: "${selState?.selectedText}"`);
    summary.landingWithFixture = { selected: selState?.selectedText, options: selState?.options.map((o) => o.text) };

    await clickTab(p2, "Subcontracts");
    await delay(2600);
    const rowProbe = await p2.evaluate(() => {
      const rows = [...document.querySelectorAll("tbody tr")];
      const out = [];
      for (const r of rows) {
        const tds = [...r.querySelectorAll("td")];
        const text = r.innerText.replace(/\s+/g, " ").trim();
        const badges = [...r.querySelectorAll("span")].map((s) => s.textContent.replace(/\s+/g, " ").trim()).filter(Boolean);
        out.push({ text: text.slice(0, 260), badges });
      }
      const counter = document.body.innerText.match(/EXECUTION STATUS RECORDED\s*(\d+)\s*\/\s*(\d+)/i);
      const activeSum = document.body.innerText.match(/ACTIVE CONTRACTED SUM\s*\$[\d,]+/i);
      return { rows: out, executionCounter: counter ? counter[0] : null, activeSum: activeSum ? activeSum[0] : null };
    });
    ev(`contracts rows: ${J(rowProbe, 900)}`);
    await shot(p2, "remediation-qa12-12-contracts-executed-precise.png");
    summary.contractsRows = rowProbe;

    await clickTab(p2, "Bid Leveling");
    await delay(2600);
    const levelingProbe = await p2.evaluate(() => {
      const btns = [...document.querySelectorAll("button")];
      const adjust = btns.filter((b) => (b.textContent || "").includes("Adjust Leveling")).map((b) => ({ text: b.textContent.trim(), disabled: b.disabled }));
      const locked = btns.filter((b) => (b.textContent || "").includes("Leveling Locked")).map((b) => ({ text: b.textContent.trim(), disabled: b.disabled, title: b.getAttribute("title") }));
      const lockedText = (document.querySelector("main")?.innerText || "").split("Leveling locked").length - 1;
      return { adjustCount: adjust.length, adjust, lockedCount: locked.length, locked, lockedTextMentions: lockedText };
    });
    ev(`leveling probe: ${J(levelingProbe, 900)}`);
    await shot(p2, "remediation-qa12-13-leveling-locked-precise.png");
    summary.levelingProbe = levelingProbe;

    // ---- 4. bundle asset fetch ----
    const assetProbe = await p2.evaluate(async () => {
      const s = document.querySelector('script[type="module"]');
      const src = s ? s.getAttribute("src") : null;
      if (!src) return { src: null, status: null };
      const r = await fetch(src);
      return { src, status: r.status, contentType: r.headers.get("content-type") };
    });
    ev(`bundle asset: ${J(assetProbe)}`);
    summary.assetProbe = assetProbe;

    const diag = {
      consoleErrors: d2.consoleLogs.filter((l) => l.type === "error").map((l) => l.text),
      consoleWarnings: d2.consoleLogs.filter((l) => l.type === "warning").map((l) => l.text),
      pageErrors: d2.pageErrors,
      failedRequests: d2.failedRequests,
    };
    ev(`diag: ${J(diag)}`);
    summary.diag = diag;

    fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa12-followup.json"), JSON.stringify(summary, null, 2), "utf8");
    writeLog("remediation-qa12-followup.txt", LOG);
    console.log("Wrote evidence.");
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error("FATAL", e);
  try {
    writeLog("remediation-qa12-followup.txt", LOG.concat([`FATAL: ${e?.stack || e}`]));
  } catch {}
  process.exit(1);
});