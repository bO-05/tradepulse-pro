/**
 * QA20-03 copy/claim sweep across every tab (rendered text + tooltips) on the
 * AUDIT-QA20-JOURNEY fixture, plus the judge dock.
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog } from "./qa20-lib.mjs";

const F = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const out = { tabs: {}, matches: [] };

const PATTERNS = [
  { id: "CLAIM-38.5k", re: /\$?38[,.]?5(00|k)/i },
  { id: "CLAIM-dedicated-inbox", re: /dedicated\s+(inbox|mailbox|address)/i },
  { id: "CLAIM-official-AIA", re: /official\s+(AIA|American Institute)/i },
  { id: "CLAIM-aia-licensed-positive", re: /(?<!not an )(?<!not )AIA-licensed\s+(form|document)/i },
  { id: "CLAIM-gemini-38", re: /gemini\s*3[.\-]8/i },
  { id: "CLAIM-gemini-version", re: /gemini\s*\d+(\.\d+)?\s*(flash|pro|ultra)?/i },
  { id: "CLAIM-legally-binding", re: /legally\s+binding/i },
  { id: "CLAIM-signature-service", re: /(provides?|offers?)\s+(e-?signature|electronic signature)/i },
  { id: "CLAIM-verification-registry", re: /(registry|state database)\s+(lookup|verified)/i },
];

async function tabText(page, label) {
  const res = await page.evaluate((t) => {
    const btns = [...document.querySelectorAll("header button")];
    const b = btns.find((x) => (x.getAttribute("title") || "").includes(t) || (x.innerText || "").includes(t));
    if (!b) return { ok: false };
    b.click();
    return { ok: true };
  }, label);
  await delay(1800);
  const text = await page.evaluate(() => {
    const main = document.querySelector("main") || document.body;
    return main.innerText;
  });
  const tips = await page.evaluate(() =>
    [...document.querySelectorAll("[title]")]
      .filter((e) => e.getBoundingClientRect().width > 0)
      .map((e) => ({ tag: e.tagName, text: (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60), title: e.getAttribute("title") }))
      .filter((x) => x.title && x.title.length > 3)
  );
  return { res, text, tips };
}

function scan(label, text, tips) {
  for (const p of PATTERNS) {
    const m = text.match(p.re);
    if (m) out.matches.push({ where: label, pattern: p.id, match: m[0], context: text.slice(Math.max(0, m.index - 90), m.index + 120).replace(/\s+/g, " ") });
  }
  for (const t of tips) {
    for (const p of PATTERNS) {
      const m = t.title.match(p.re);
      if (m) out.matches.push({ where: `${label}/title`, pattern: p.id, match: m[0], context: `[${t.tag} "${t.text}"] ${t.title.slice(0, 180)}` });
    }
  }
}

async function main() {
  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.emulateTimezone("America/Los_Angeles");
  await page.goto(`${BASE}/?project=${F.journey.id}&tab=packages&qa20=copy`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
    b?.click();
  });
  await delay(1000);

  const tabs = ["CSI Scoping", "Discovery", "Pre-Bid Q&A", "Bid Leveling", "Scope Clash", "Subcontracts", "Live Activity Audit", "Evals & Architecture"];
  for (const t of tabs) {
    const { res, text, tips } = await tabText(page, t);
    const key = t.replace(/[: ]+/g, "_");
    out.tabs[key] = { ok: res.ok, chars: text.length, text };
    scan(key, text, tips);
    await shot(page, `fix4-qa20-copy-${key}.png`);
  }

  // Judge dock + scenarios
  const dockOpen = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("judge") || /judge dock|simulation dock/i.test(x.getAttribute("title") || "") || /Judge Simulation/i.test(x.textContent || ""));
    if (!b) return { ok: false, available: [...document.querySelectorAll("button")].map((x) => (x.getAttribute("title") || x.textContent || "").trim()).filter(Boolean).slice(0, 60) };
    b.click();
    return { ok: true };
  });
  await delay(900);
  if (dockOpen.ok) {
    const dock = await page.evaluate(() => ({
      text: document.body.innerText,
      tips: [...document.querySelectorAll("[title]")].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.getAttribute("title")),
    }));
    scan("judge-dock", dock.text, []);
    for (const t of dock.tips) scan("judge-dock/title", "", [{ tag: "TITLE", text: "", title: t }]);
    await shot(page, "fix4-qa20-copy-judge-dock.png");
  }

  // Addendum tooltip on Q&A for current package
  await tabText(page, "Pre-Bid Q&A");
  let addendum = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Addendum/i.test(x.textContent || "") || /Addendum/i.test(x.getAttribute("title") || ""));
    return b ? { text: (b.textContent || "").trim(), title: b.getAttribute("title"), disabled: b.disabled } : null;
  });
  if (addendum?.disabled) {
    // Make the enabled-state tooltip observable: certify one clarified RFI.
    const sim = await fetch(`${process.env.CONVEX_URL || "https://brainy-skunk-440.convex.cloud"}/api/mutation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "simulation:triggerJudgeSimulation", args: { tradePackageId: F.journey.packageId, scenario: "rfi_inquiry" }, format: "json" }),
    }).then((r) => r.json());
    say(`trigger rfi sim: ${JSON.stringify(sim).slice(0, 160)}`);
    await delay(9000);
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForAppReady(page, 60000);
    await tabText(page, "Pre-Bid Q&A");
    addendum = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Addendum/i.test(x.textContent || "") || /Addendum/i.test(x.getAttribute("title") || ""));
      return b ? { text: (b.textContent || "").trim(), title: b.getAttribute("title"), disabled: b.disabled } : null;
    });
    // Hover to materialize the tooltip visually (native tooltip not in DOM, but title attr is the claim).
    const box = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Addendum/i.test(x.textContent || ""));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (box) {
      await page.mouse.move(box.x, box.y);
      await delay(1500);
      await shot(page, "fix4-qa20-copy-addendum-hover.png");
    }
  }
  out.addendumButton = addendum;
  if (addendum?.title) scan("qna-addendum-enabled", "", [{ tag: "BUTTON", text: addendum.text, title: addendum.title }]);

  out.pageErrors = diag.pageErrors.slice(0, 10);
  out.matchCount = out.matches.length;
  say(`tabs scanned=${Object.keys(out.tabs).length}; matches=${out.matches.length}`);
  for (const m of out.matches) say(`  ${m.pattern} @ ${m.where}: ${m.match} | ${m.context.slice(0, 220)}`);
  writeEvidence("copy", out);
  writeLog("copy", log);
  await browser.close();
  console.log("copy sweep done");
}

main().catch((e) => {
  console.error(e);
  writeLog("copy-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});